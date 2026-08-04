import { createHmac } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { developerAccounts, developerApiKeys, subscriptions } from "../db/schema.js";
import { resolveDefaultPlan, type PlanName } from "../billing/plans.js";

export interface DeveloperContext {
  developerId: string;
  workspaceId: string;
  plan: PlanName;
  /*
   * Scopes attached to this key, or [] meaning unrestricted.
   *
   * The console has always let an operator narrow a key to a subset of
   * ["ingest","read","admin","entities","ledger"] and wrote the rows to
   * api_key_scopes — but nothing ever read them back, so a key the UI showed as
   * restricted carried full access. An empty array still means full access, as
   * the console's back-compat rule requires; the difference is that a non-empty
   * one is now actually enforced.
   */
  scopes: string[];
}

export type ApiScope = "ingest" | "read" | "admin" | "entities" | "ledger";

/** Empty scope set = unrestricted key (keys minted before scoping existed). */
export function hasScope(ctx: DeveloperContext, scope: ApiScope): boolean {
  return ctx.scopes.length === 0 || ctx.scopes.includes(scope);
}

function getHmacSecret(): string {
  const s = process.env.API_KEY_HMAC_SECRET;
  if (!s) throw new Error("API_KEY_HMAC_SECRET environment variable is required — cannot share key material with ENCRYPTION_KEY");
  return s;
}

export function hashApiKey(rawKey: string): string {
  return createHmac("sha256", getHmacSecret()).update(rawKey).digest("hex");
}

// Keys are minted as `ans_` + 32+ hex chars — reject anything that doesn't
// match before touching HMAC or the DB. This eliminates all non-ans_ probes
// (old bearer tokens, JWTs, etc.) with a single regex comparison.
const VALID_KEY_RE = /^ans_[A-Za-z0-9]{32,}$/;

export async function validateApiKey(rawKey: string): Promise<DeveloperContext | null> {
  if (!VALID_KEY_RE.test(rawKey)) return null;

  const hash = hashApiKey(rawKey);

  const rows = await db
    .select({
      developerId: developerApiKeys.developerId,
      workspaceId: developerAccounts.workspaceId,
      plan: subscriptions.plan,
      // Correlated array() subquery rather than a join + second round trip:
      // this runs on every authenticated /v1 request, and a join against a
      // one-to-many table would multiply the result rows.
      scopes: sql<string[]>`array(select scope from api_key_scopes where api_key_id = ${developerApiKeys.id})`,
    })
    .from(developerApiKeys)
    .innerJoin(developerAccounts, eq(developerApiKeys.developerId, developerAccounts.id))
    .leftJoin(subscriptions, eq(subscriptions.workspaceId, developerAccounts.workspaceId))
    .where(eq(developerApiKeys.keyHash, hash))
    .limit(1);

  if (!rows[0] || !rows[0].workspaceId) return null;

  // Non-blocking lastUsedAt update
  db.update(developerApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(developerApiKeys.keyHash, hash))
    .catch((err) => console.error("[api-auth] lastUsedAt update failed:", err));

  return {
    developerId: rows[0].developerId,
    workspaceId: rows[0].workspaceId,
    plan: (rows[0].plan as PlanName | null) ?? resolveDefaultPlan(),
    scopes: rows[0].scopes ?? [],
  };
}
