/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

/*
 * Edition gating + signed-license validation (Phase 7).
 *
 * Two independent sources of "is this org enterprise?":
 *   1. organizations.edition — authoritative for cloud (set by billing/admin).
 *   2. a signed license — authoritative for self-host/air-gapped, where there is
 *      no billing backend. Licenses are ed25519-signed by the vendor's offline
 *      key; the server verifies with the PUBLIC key in LICENSE_PUBLIC_KEY.
 *
 * Format (compact, copy-pasteable): base64url(payloadJSON).base64url(signature)
 * The signature covers the payloadJSON bytes. No key configured ⇒ no license is
 * ever accepted (fail-closed), so cloud stays gated purely by the edition column.
 */
import crypto from "crypto";
import type { Context, Next } from "hono";
import type { ConsoleEnv } from "../auth/console-middleware.js";
import { desc, eq } from "drizzle-orm";
import { licenses } from "../db/schema.js";
import { getDeploymentConfig, type DeploymentMode } from "../config/deployment.js";

export type Edition = "community" | "self_hosted" | "cloud" | "enterprise";

export interface LicensePayload {
  organizationId: string;
  edition: Edition;
  seats?: number;
  expiresAt?: string; // ISO-8601; absent = perpetual
}

const EDITIONS: readonly Edition[] = ["community", "self_hosted", "cloud", "enterprise"];

const b64urlDecode = (s: string): Buffer => Buffer.from(s, "base64url");

function getPublicKey(): crypto.KeyObject | null {
  const pem = process.env.LICENSE_PUBLIC_KEY;
  if (!pem) return null;
  try {
    // Accept a raw PEM or a base64-encoded PEM (env-var friendly).
    const text = pem.includes("BEGIN") ? pem : Buffer.from(pem, "base64").toString("utf8");
    return crypto.createPublicKey(text);
  } catch (err) {
    console.error("[license] LICENSE_PUBLIC_KEY is not a valid public key:", err);
    return null;
  }
}

/**
 * Verify a signed license token. Returns the payload only if the signature is
 * valid AND the license has not expired. Returns null on any failure (fail-closed).
 */
export function verifyLicense(token: string): LicensePayload | null {
  const key = getPublicKey();
  if (!key) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  let payloadBytes: Buffer;
  let signature: Buffer;
  try {
    payloadBytes = b64urlDecode(payloadPart);
    signature = b64urlDecode(sigPart);
  } catch {
    return null;
  }
  // ed25519 verify passes algorithm=null (the key type selects EdDSA).
  const ok = crypto.verify(null, payloadBytes, key, signature);
  if (!ok) return null;

  let payload: LicensePayload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8")) as LicensePayload;
  } catch {
    return null;
  }
  if (
    !payload ||
    typeof payload.organizationId !== "string" ||
    !payload.organizationId ||
    !EDITIONS.includes(payload.edition) ||
    (payload.seats !== undefined && (!Number.isInteger(payload.seats) || payload.seats < 1)) ||
    (payload.expiresAt !== undefined && (!Number.isFinite(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) < Date.now()))
  ) {
    return null;
  }
  return payload;
}

/** Whether an edition string unlocks enterprise capabilities. */
export function editionAllowsEnterprise(edition: string | null | undefined): boolean {
  return edition === "enterprise";
}

/** Whether a verified license grants this exact organization enterprise access. */
export function licenseAllowsEnterprise(
  license: LicensePayload | null | undefined,
  organizationId: string
): boolean {
  return Boolean(
    license &&
      license.organizationId === organizationId &&
      license.edition === "enterprise"
  );
}

/**
 * Cloud organizations are entitled through the billing-managed edition column.
 * Self-hosted and hybrid deployments additionally need a currently verifiable,
 * organization-bound enterprise license. This remains fail-closed if the latest
 * stored token is expired, malformed, signed by an unknown key, or missing.
 */
export function hasEnterpriseEntitlement(input: {
  organizationId: string;
  organizationEdition: string | null | undefined;
  deploymentMode: DeploymentMode;
  license?: LicensePayload | null;
}): boolean {
  if (!editionAllowsEnterprise(input.organizationEdition)) return false;
  return input.deploymentMode === "cloud" || licenseAllowsEnterprise(input.license, input.organizationId);
}

/**
 * Returns the latest stored license only when it can still be verified. We do
 * not fall back to an older row: a newer installation is the active intent, and
 * accepting a previous token after a replacement would weaken revocation.
 */
export async function getVerifiedOrganizationLicense(organizationId: string): Promise<LicensePayload | null> {
  // Keep the database dependency lazy: signature verification remains usable in
  // offline/unit-test contexts where DATABASE_URL is intentionally absent.
  try {
    const { db } = await import("../db/index.js");
    const [row] = await db
      .select({ signedPayload: licenses.signedPayload })
      .from(licenses)
      .where(eq(licenses.organizationId, organizationId))
      .orderBy(desc(licenses.createdAt))
      .limit(1);
    if (!row) return null;
    const payload = verifyLicense(row.signedPayload);
    return payload?.organizationId === organizationId ? payload : null;
  } catch (err) {
    console.error(`[license] failed to resolve license for org ${organizationId}:`, err);
    return null;
  }
}

/**
 * Console middleware: gate an entire enterprise route group behind the active
 * org's edition. Cheap — reads the edition already resolved onto the session, no
 * extra query. Returns 402 (payment/upgrade required) with an actionable hint.
 */
export async function requireEnterprise(
  c: Context<ConsoleEnv>,
  next: Next
): Promise<Response | void> {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization selected" }, 403);
  const deployment = getDeploymentConfig();
  const license = deployment.mode === "cloud"
    ? null
    : await getVerifiedOrganizationLicense(organization.id);
  if (!hasEnterpriseEntitlement({
    organizationId: organization.id,
    organizationEdition: organization.edition,
    deploymentMode: deployment.mode,
    license,
  })) {
    return c.json(
      {
        error: deployment.mode === "cloud" ? "enterprise edition required" : "valid enterprise license required",
        edition: organization.edition,
        upgrade: "/pricing",
      },
      402
    );
  }
  await next();
}
