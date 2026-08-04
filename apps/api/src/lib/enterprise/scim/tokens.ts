/*
 * SCIM bearer tokens (Phase 7). Minted `scim_…`, HMAC-hashed at rest (reusing the
 * developer-API-key HMAC), shown once. The IdP's SCIM client presents the token as
 * `Authorization: Bearer scim_…`; validateScimToken resolves it to an org.
 */
import { randomBytes } from "crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { scimTokens, type ScimToken } from "../../db/schema.js";
import { hashApiKey } from "../../auth/api-auth.js";

const VALID_TOKEN_RE = /^scim_[A-Za-z0-9]{32,}$/;

export async function mintScimToken(
  organizationId: string,
  name: string
): Promise<{ token: ScimToken; secret: string }> {
  const rawKey = `scim_${randomBytes(32).toString("hex")}`;
  const [token] = await db
    .insert(scimTokens)
    .values({ organizationId, name: name.slice(0, 100) || "SCIM", tokenHash: hashApiKey(rawKey) })
    .returning();
  return { token, secret: rawKey };
}

export async function listScimTokens(organizationId: string): Promise<ScimToken[]> {
  return db
    .select()
    .from(scimTokens)
    .where(eq(scimTokens.organizationId, organizationId))
    .orderBy(desc(scimTokens.createdAt));
}

export async function revokeScimToken(id: string, organizationId: string): Promise<boolean> {
  const rows = await db
    .delete(scimTokens)
    .where(eq(scimTokens.id, id))
    .returning({ id: scimTokens.id, org: scimTokens.organizationId });
  return rows.some((r) => r.org === organizationId);
}

/** Resolve a raw SCIM bearer token → its org id, or null. Touches last_used_at. */
export async function validateScimToken(rawToken: string): Promise<{ organizationId: string } | null> {
  if (!VALID_TOKEN_RE.test(rawToken)) return null;
  const [row] = await db
    .select({ id: scimTokens.id, organizationId: scimTokens.organizationId })
    .from(scimTokens)
    .where(eq(scimTokens.tokenHash, hashApiKey(rawToken)))
    .limit(1);
  if (!row) return null;
  db.update(scimTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(scimTokens.id, row.id))
    .catch((err) => console.error("[scim] lastUsedAt touch failed:", (err as Error).message));
  return { organizationId: row.organizationId };
}
