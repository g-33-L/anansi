/*
 * /console/api-keys — manage the active org's bearer keys for the public /v1 API.
 * Keys are minted `ans_…`, hashed at rest (HMAC), shown once. Optional scopes
 * (api_key_scopes) narrow a key; NO scope rows = full access (back-compat).
 */
import { Hono } from "hono";
import { randomBytes } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requirePermission, type ConsoleEnv } from "../../lib/auth/console-middleware.js";
import { getOrProvisionEngineTenant } from "../../lib/identity/provisioning.js";
import { hashApiKey } from "../../lib/auth/api-auth.js";
import { recordAuditEvent } from "../../lib/enterprise/audit.js";
import { db } from "../../lib/db/index.js";
import { apiKeyScopes, developerApiKeys } from "../../lib/db/schema.js";

export const apiKeyRoutes = new Hono<ConsoleEnv>();

const VALID_SCOPES = ["ingest", "read", "admin", "entities", "ledger"];

apiKeyRoutes.get("/", requirePermission("apikey:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { developerId } = await getOrProvisionEngineTenant(organization);

  const keys = await db
    .select({
      id: developerApiKeys.id,
      name: developerApiKeys.name,
      lastUsedAt: developerApiKeys.lastUsedAt,
      createdAt: developerApiKeys.createdAt,
    })
    .from(developerApiKeys)
    .where(eq(developerApiKeys.developerId, developerId))
    .orderBy(desc(developerApiKeys.createdAt));

  const ids = keys.map((k) => k.id);
  const scopeRows = ids.length
    ? await db.select().from(apiKeyScopes).where(inArray(apiKeyScopes.apiKeyId, ids))
    : [];
  const byKey = new Map<string, string[]>();
  for (const s of scopeRows) {
    const arr = byKey.get(s.apiKeyId) ?? [];
    arr.push(s.scope);
    byKey.set(s.apiKeyId, arr);
  }

  return c.json({ keys: keys.map((k) => ({ ...k, scopes: byKey.get(k.id) ?? [] })) });
});

apiKeyRoutes.post("/", requirePermission("apikey:write"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; scopes?: unknown };
  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : "Default";
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter((s): s is string => typeof s === "string" && VALID_SCOPES.includes(s))
    : [];

  const { developerId } = await getOrProvisionEngineTenant(organization);
  const rawKey = `ans_${randomBytes(32).toString("hex")}`;
  const [key] = await db
    .insert(developerApiKeys)
    .values({ developerId, keyHash: hashApiKey(rawKey), name })
    .returning({ id: developerApiKeys.id, name: developerApiKeys.name, createdAt: developerApiKeys.createdAt });

  if (scopes.length) {
    await db
      .insert(apiKeyScopes)
      .values(scopes.map((scope) => ({ apiKeyId: key.id, scope })))
      .onConflictDoNothing();
  }

  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: c.get("session").user.id,
    action: "apikey.create",
    targetType: "api_key",
    targetId: key.id,
    metadata: { name, scopes },
  });
  // secret is shown exactly once — never stored in plaintext.
  return c.json({ key: { ...key, lastUsedAt: null, scopes }, secret: rawKey }, 201);
});

apiKeyRoutes.delete("/:id", requirePermission("apikey:write"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { developerId } = await getOrProvisionEngineTenant(organization);
  const rows = await db
    .delete(developerApiKeys)
    .where(and(eq(developerApiKeys.id, c.req.param("id")!), eq(developerApiKeys.developerId, developerId)))
    .returning({ id: developerApiKeys.id });
  if (rows.length) {
    await recordAuditEvent({
      organizationId: organization.id,
      actorUserId: c.get("session").user.id,
      action: "apikey.revoke",
      targetType: "api_key",
      targetId: c.req.param("id")!,
    });
  }
  return rows.length ? c.json({ ok: true }) : c.json({ error: "key not found" }, 404);
});
