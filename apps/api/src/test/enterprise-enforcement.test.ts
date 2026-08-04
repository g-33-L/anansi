/*
 * M11/M12 integration coverage: an approval must actively authorize a governed
 * action, and a self-hosted enterprise surface must actively verify its signed
 * license. These exercise the real console middleware, DB rows, CSRF, and audit
 * trail instead of merely unit-testing the helper predicates.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { closePool, db } from "../lib/db/index.js";
import { signCookieValue } from "../lib/utils/crypto.js";
import { createSession } from "../lib/identity/session.js";
import { _resetDeploymentConfigForTest } from "../lib/config/deployment.js";
import { AUDIT_EXPORT_SUBJECT_REF } from "../lib/enterprise/governance.js";
import { auditEvents, approvalRequests, memberships, organizations, users } from "../lib/db/schema.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "../lib/auth/console-middleware.js";
import { resetOrgState } from "./helpers/fixtures.js";

interface Identity {
  userId: string;
  organizationId: string;
  rawSession: string;
}

const originalDeploymentMode = process.env.DEPLOYMENT_MODE;
const originalLicensePublicKey = process.env.LICENSE_PUBLIC_KEY;

function setDeployment(mode: "cloud" | "local"): void {
  process.env.DEPLOYMENT_MODE = mode;
  _resetDeploymentConfigForTest();
}

function restoreEnvironment(): void {
  if (originalDeploymentMode === undefined) delete process.env.DEPLOYMENT_MODE;
  else process.env.DEPLOYMENT_MODE = originalDeploymentMode;
  if (originalLicensePublicKey === undefined) delete process.env.LICENSE_PUBLIC_KEY;
  else process.env.LICENSE_PUBLIC_KEY = originalLicensePublicKey;
  _resetDeploymentConfigForTest();
}

function cookieHeader(rawSession: string, csrf?: string): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(signCookieValue(rawSession))}`,
    ...(csrf ? [`${CSRF_COOKIE}=${encodeURIComponent(csrf)}`] : []),
  ].join("; ");
}

function request(path: string, identity: Identity, init: RequestInit = {}, csrf?: string): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookieHeader(identity.rawSession, csrf));
  if (csrf) headers.set("x-csrf-token", csrf);
  return new Request(`http://localhost${path}`, { ...init, headers });
}

async function createIdentity(edition: "enterprise" | "self_hosted"): Promise<Identity> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [user] = await db
    .insert(users)
    .values({ email: `enterprise-${suffix}@test.local`, name: "Enterprise Tester" })
    .returning({ id: users.id });
  const [organization] = await db
    .insert(organizations)
    .values({ name: "Enterprise Enforcement Org", slug: `enterprise-enforcement-${suffix}`, edition })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ userId: user.id, organizationId: organization.id, role: "owner" });
  return {
    userId: user.id,
    organizationId: organization.id,
    rawSession: await createSession(user.id, organization.id),
  };
}

function signEnterpriseLicense(organizationId: string, privateKey: crypto.KeyObject): string {
  const payload = Buffer.from(JSON.stringify({ organizationId, edition: "enterprise", seats: 5 }), "utf8");
  const signature = crypto.sign(null, payload, privateKey);
  return `${payload.toString("base64url")}.${signature.toString("base64url")}`;
}

beforeEach(resetOrgState);
afterEach(restoreEnvironment);
afterAll(closePool);

describe("M11 governed audit exports", () => {
  it("denies and audits an export without the exact approved data_export request", async () => {
    setDeployment("cloud");
    const identity = await createIdentity("enterprise");
    const app = createApp();

    const denied = await app.fetch(request("/console/enterprise/audit/export", identity));
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toEqual({
      error: "approved data_export request required",
      requiredKind: "data_export",
      subjectRef: AUDIT_EXPORT_SUBJECT_REF,
    });

    const [denial] = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, identity.organizationId));
    expect(denial).toMatchObject({
      action: "governance.denied",
      targetType: "audit_export",
      metadata: expect.objectContaining({ reason: "approved_request_required" }),
    });
  });

  it("permits export only under an approved request bound to audit_export", async () => {
    setDeployment("cloud");
    const identity = await createIdentity("enterprise");
    const [approval] = await db
      .insert(approvalRequests)
      .values({
        organizationId: identity.organizationId,
        kind: "data_export",
        subjectRef: AUDIT_EXPORT_SUBJECT_REF,
        status: "approved",
        requestedBy: identity.userId,
        decidedBy: identity.userId,
        decidedAt: new Date(),
      })
      .returning({ id: approvalRequests.id });

    const exported = await createApp().fetch(
      request(`/console/enterprise/audit/export?approvalId=${approval.id}`, identity)
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("application/x-ndjson");
    await exported.text();

    const rows = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, identity.organizationId));
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "audit.export",
        targetId: approval.id,
        metadata: expect.objectContaining({ approvalId: approval.id }),
      }),
    ]));
  });
});

describe("M12 verified self-host license gate", () => {
  it("fails closed for an enterprise-marked self-hosted org without a verified license", async () => {
    setDeployment("local");
    const { publicKey } = crypto.generateKeyPairSync("ed25519");
    process.env.LICENSE_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
    const identity = await createIdentity("enterprise");

    const response = await createApp().fetch(request("/console/enterprise/audit", identity));
    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({ error: "valid enterprise license required" });
  });

  it("activates the real enterprise audit surface after a verified license installation", async () => {
    setDeployment("local");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    process.env.LICENSE_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
    const identity = await createIdentity("self_hosted");
    const csrf = "enterprise-license-csrf";
    const token = signEnterpriseLicense(identity.organizationId, privateKey);
    const app = createApp();

    const install = await app.fetch(
      request(
        "/console/enterprise/license",
        identity,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
        },
        csrf
      )
    );
    expect(install.status).toBe(200);
    await expect(install.json()).resolves.toMatchObject({ ok: true, edition: "enterprise" });

    const gatedFeature = await app.fetch(request("/console/enterprise/audit?limit=1", identity));
    expect(gatedFeature.status).toBe(200);
    await expect(gatedFeature.json()).resolves.toMatchObject({ events: expect.any(Array) });
  });
});
