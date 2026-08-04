/*
 * `/console` is the browser-facing BFF contract. These tests deliberately use
 * the real app, Postgres-backed sessions, signed cookies, and the same double-
 * submit CSRF mechanism as the SPA — mocks here would not catch a route mount or
 * middleware ordering regression.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { closePool, db } from "../lib/db/index.js";
import { signCookieValue } from "../lib/utils/crypto.js";
import { createSession } from "../lib/identity/session.js";
import { auditEvents, organizations, memberships, users } from "../lib/db/schema.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "../lib/auth/console-middleware.js";
import { resetOrgState } from "./helpers/fixtures.js";

interface ConsoleIdentity {
  userId: string;
  organizationId: string;
  rawSession: string;
}

function cookieHeader(rawSession: string, csrf?: string): string {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(signCookieValue(rawSession))}`,
    ...(csrf ? [`${CSRF_COOKIE}=${encodeURIComponent(csrf)}`] : []),
  ].join("; ");
}

async function createConsoleIdentity(options: { edition?: string } = {}): Promise<ConsoleIdentity> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [user] = await db
    .insert(users)
    .values({ email: `console-${suffix}@test.local`, name: "Console Tester" })
    .returning({ id: users.id });
  const [organization] = await db
    .insert(organizations)
    .values({
      name: "Console Contract Org",
      slug: `console-contract-${suffix}`,
      edition: options.edition ?? "cloud",
    })
    .returning({ id: organizations.id });
  await db.insert(memberships).values({ userId: user.id, organizationId: organization.id, role: "owner" });
  return {
    userId: user.id,
    organizationId: organization.id,
    rawSession: await createSession(user.id, organization.id),
  };
}

function consoleRequest(
  path: string,
  rawSession: string,
  init: RequestInit = {},
  csrf?: { cookie?: string; header?: string }
): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookieHeader(rawSession, csrf?.cookie));
  if (csrf?.header) headers.set("x-csrf-token", csrf.header);
  return new Request(`http://localhost${path}`, { ...init, headers });
}

beforeEach(resetOrgState);
afterAll(closePool);

describe("/console contract — authentication and CSRF", () => {
  it("rejects missing or tampered session cookies with the stable unauthorized response", async () => {
    const app = createApp();
    const missing = await app.fetch(new Request("http://localhost/console/me"));
    expect(missing.status).toBe(401);
    await expect(missing.json()).resolves.toEqual({ error: "unauthorized" });

    const tampered = await app.fetch(
      new Request("http://localhost/console/me", {
        headers: { cookie: `${SESSION_COOKIE}=not-a-valid-signed-session` },
      })
    );
    expect(tampered.status).toBe(401);
    await expect(tampered.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns the SPA bootstrap shape and refreshes the readable CSRF cookie", async () => {
    const identity = await createConsoleIdentity();
    const response = await createApp().fetch(consoleRequest("/console/me", identity.rawSession));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`${CSRF_COOKIE}=`);
    await expect(response.json()).resolves.toEqual({
      user: {
        id: identity.userId,
        email: expect.stringMatching(/^console-.*@test\.local$/),
        name: "Console Tester",
        avatarUrl: null,
      },
      activeOrganization: {
        id: identity.organizationId,
        name: "Console Contract Org",
        slug: expect.stringMatching(/^console-contract-/),
        role: "owner",
      },
      organizations: [
        {
          id: identity.organizationId,
          name: "Console Contract Org",
          slug: expect.stringMatching(/^console-contract-/),
          role: "owner",
        },
      ],
    });
  });

  it("rejects missing and mismatched CSRF tokens before mutating state", async () => {
    const identity = await createConsoleIdentity();
    const app = createApp();
    const body = JSON.stringify({ name: "Changed name" });

    const missing = await app.fetch(
      consoleRequest("/console/me", identity.rawSession, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body,
      })
    );
    expect(missing.status).toBe(403);
    await expect(missing.json()).resolves.toEqual({ error: "invalid csrf token" });

    const mismatched = await app.fetch(
      consoleRequest(
        "/console/me",
        identity.rawSession,
        { method: "PATCH", headers: { "content-type": "application/json" }, body },
        { cookie: "expected-token", header: "different-token" }
      )
    );
    expect(mismatched.status).toBe(403);
    await expect(mismatched.json()).resolves.toEqual({ error: "invalid csrf token" });

    const [unchanged] = await db.select({ name: users.name }).from(users).where(eq(users.id, identity.userId));
    expect(unchanged.name).toBe("Console Tester");

    const csrf = "matching-contract-token";
    const updated = await app.fetch(
      consoleRequest(
        "/console/me",
        identity.rawSession,
        { method: "PATCH", headers: { "content-type": "application/json" }, body },
        { cookie: csrf, header: csrf }
      )
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toEqual({
      user: {
        id: identity.userId,
        email: expect.stringMatching(/^console-.*@test\.local$/),
        name: "Changed name",
        avatarUrl: null,
      },
    });
  });
});

describe("/console contract — audit pagination", () => {
  it("uses an ISO keyset cursor and rejects malformed pagination input", async () => {
    const identity = await createConsoleIdentity({ edition: "enterprise" });
    const oldest = new Date("2026-08-04T08:00:00.000Z");
    const newest = new Date("2026-08-04T09:00:00.000Z");
    await db.insert(auditEvents).values([
      { organizationId: identity.organizationId, actorUserId: identity.userId, action: "contract.old", createdAt: oldest },
      { organizationId: identity.organizationId, actorUserId: identity.userId, action: "contract.new", createdAt: newest },
    ]);
    const app = createApp();

    const firstPage = await app.fetch(
      consoleRequest("/console/enterprise/audit?limit=1", identity.rawSession)
    );
    expect(firstPage.status).toBe(200);
    const first = (await firstPage.json()) as {
      events: Array<{ action: string; createdAt: string }>;
      nextBefore: string | null;
    };
    expect(first.events).toHaveLength(1);
    expect(first.events[0]?.action).toBe("contract.new");
    expect(first.nextBefore).toBe(newest.toISOString());

    const secondPage = await app.fetch(
      consoleRequest(`/console/enterprise/audit?limit=1&before=${encodeURIComponent(first.nextBefore!)}`, identity.rawSession)
    );
    expect(secondPage.status).toBe(200);
    const second = (await secondPage.json()) as { events: Array<{ action: string }>; nextBefore: string | null };
    expect(second.events.map((event) => event.action)).toEqual(["contract.old"]);
    expect(second.nextBefore).toBeNull();

    for (const path of [
      "/console/enterprise/audit?limit=0",
      "/console/enterprise/audit?limit=1.5",
      "/console/enterprise/audit?limit=501",
      "/console/enterprise/audit?before=not-a-cursor",
    ]) {
      const response = await app.fetch(consoleRequest(path, identity.rawSession));
      expect(response.status, path).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: expect.any(String) });
    }
  });
});
