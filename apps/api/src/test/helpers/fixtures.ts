/*
 * Hermetic test fixtures (Phase 11.0). Seeds the identity → engine chain
 * (organization → workspace → developer_account) that Phase 5+ code queries, so
 * DB-backed suites don't hand-roll inserts. Pair with cleanDatabase() (setup.ts),
 * which TRUNCATEs workspaces CASCADE between tests.
 */
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "../../lib/db/index.js";
import {
  organizations,
  workspaces,
  developerAccounts,
  redactionRules,
  featureFlags,
} from "../../lib/db/schema.js";

/**
 * Reset the identity + ops tables between tests. `cleanDatabase()` only TRUNCATEs
 * `workspaces CASCADE`, which leaves `organizations` and GLOBAL `feature_flags`
 * (null org) behind — so suites that seed those must reset them explicitly or state
 * leaks across files. TRUNCATE is table-level, so truncating organizations CASCADE
 * clears the whole feature_flags / redaction_rules / operator_audit_events tables;
 * adding workspaces catches org-less (orphan) rows too. Guarded to a local DB.
 */
export async function resetOrgState(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes("localhost") && !dbUrl.includes("127.0.0.1") && !dbUrl.includes("::1")) {
    throw new Error(`[test] Refusing to TRUNCATE against non-local database`);
  }
  await db.execute(sql`TRUNCATE workspaces, organizations CASCADE`);
}

export interface SeededOrg {
  organizationId: string;
  workspaceId: string;
  developerId: string;
}

/** Create an org + its workspace + a developer_account (the engine tenant). */
export async function seedOrg(opts: { name?: string } = {}): Promise<SeededOrg> {
  const name = opts.name ?? "Test Org";
  const [org] = await db
    .insert(organizations)
    .values({ name, slug: `test-${randomUUID().slice(0, 8)}` })
    .returning({ id: organizations.id });
  const [ws] = await db
    .insert(workspaces)
    .values({ organizationId: org.id, slackTeamName: name })
    .returning({ id: workspaces.id });
  const [dev] = await db
    .insert(developerAccounts)
    .values({ name, email: `dev-${randomUUID().slice(0, 8)}@test.local`, workspaceId: ws.id })
    .returning({ id: developerAccounts.id });
  return { organizationId: org.id, workspaceId: ws.id, developerId: dev.id };
}

/** A workspace with NO organization (legacy / self-host, org rules N/A). */
export async function seedOrphanWorkspace(): Promise<{ workspaceId: string }> {
  const [ws] = await db
    .insert(workspaces)
    .values({ slackTeamName: "Orphan" })
    .returning({ id: workspaces.id });
  return { workspaceId: ws.id };
}

export async function seedRedactionRule(
  organizationId: string,
  pattern: string,
  action: "mask" | "drop" | "hash" = "mask",
  enabled = true
): Promise<void> {
  await db.insert(redactionRules).values({ organizationId, pattern, action, enabled });
}

export async function seedFlag(input: {
  key: string;
  scope: "global" | "org";
  organizationId?: string | null;
  enabled: boolean;
  expiresAt?: Date | null;
}): Promise<void> {
  await db.insert(featureFlags).values({
    key: input.key,
    scope: input.scope,
    organizationId: input.scope === "org" ? (input.organizationId ?? null) : null,
    enabled: input.enabled,
    owner: "test@anansi.local",
    expiresAt: input.expiresAt ?? null,
  });
}
