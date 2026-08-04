import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { developerAccounts, memoryUsers, memoryChunks, staticDocuments, entityNodes } from "../db/schema.js";

// ─── Slack ⇄ per-user memory bridge ───────────────────────────────────────────
// Slack-native memory reuses the same per-user machinery as the developer API
// (memory_users → synthesizeUser → entity graph / temporal memory). To do that, a
// Slack workspace needs a developer_accounts row, and each Slack user maps to one
// memory_user under it. Both are provisioned idempotently and cached in-process.

// workspaceId → developerId
const workspaceDeveloperCache = new Map<string, string>();
// "workspaceId:slackUserId" → memoryUserId
const memoryUserCache = new Map<string, string>();

// Idempotently provision (and cache) the developer account backing a Slack
// workspace. Uses a synthetic unique email since OAuth doesn't grant an admin
// address — the account exists only to scope per-user memory.
export async function getWorkspaceDeveloperId(
  workspaceId: string,
  teamName?: string | null
): Promise<string> {
  const cached = workspaceDeveloperCache.get(workspaceId);
  if (cached) return cached;

  const existing = await db.query.developerAccounts.findFirst({
    where: eq(developerAccounts.workspaceId, workspaceId),
    columns: { id: true },
  });
  if (existing) {
    workspaceDeveloperCache.set(workspaceId, existing.id);
    return existing.id;
  }

  const [created] = await db
    .insert(developerAccounts)
    .values({
      workspaceId,
      name: teamName?.trim() || "Slack workspace",
      email: `slack:${workspaceId}@workspaces.anansi`,
    })
    .onConflictDoNothing({ target: developerAccounts.workspaceId })
    .returning({ id: developerAccounts.id });

  if (created) {
    workspaceDeveloperCache.set(workspaceId, created.id);
    return created.id;
  }

  // Lost an insert race — read the row the other writer created.
  const row = await db.query.developerAccounts.findFirst({
    where: eq(developerAccounts.workspaceId, workspaceId),
    columns: { id: true },
  });
  if (!row) throw new Error(`developer account missing after upsert for workspace ${workspaceId}`);
  workspaceDeveloperCache.set(workspaceId, row.id);
  return row.id;
}

// Map a Slack user id to its memory_user (externalId = Slack user id), creating it
// on first sight. Returns null for unknown/system authors AND for users who have
// opted out of personal memory — their messages still feed the team profile, but
// nothing is attributed to them. Opted-out users are never cached (so re-opting in
// takes effect on the next message); opt-out itself is also enforced at the
// synthesis boundary, which closes any stale-cache window across worker processes.
export async function resolveSlackMemoryUserId(
  workspaceId: string,
  slackUserId: string | undefined,
  teamName?: string | null
): Promise<string | null> {
  if (!slackUserId || slackUserId === "unknown") return null;

  const cacheKey = `${workspaceId}:${slackUserId}`;
  const cached = memoryUserCache.get(cacheKey);
  if (cached) return cached;

  const developerId = await getWorkspaceDeveloperId(workspaceId, teamName);

  const existing = await db.query.memoryUsers.findFirst({
    where: and(eq(memoryUsers.developerId, developerId), eq(memoryUsers.externalId, slackUserId)),
    columns: { id: true, optedOut: true },
  });
  if (existing) {
    if (existing.optedOut) return null;
    memoryUserCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const [created] = await db
    .insert(memoryUsers)
    .values({ developerId, externalId: slackUserId })
    .onConflictDoNothing({ target: [memoryUsers.developerId, memoryUsers.externalId] })
    .returning({ id: memoryUsers.id });

  if (created) {
    memoryUserCache.set(cacheKey, created.id);
    return created.id;
  }

  // Lost an insert race — read the row the other writer created (honoring opt-out).
  const row = await db.query.memoryUsers.findFirst({
    where: and(eq(memoryUsers.developerId, developerId), eq(memoryUsers.externalId, slackUserId)),
    columns: { id: true, optedOut: true },
  });
  if (!row) throw new Error(`memory user missing after upsert for slack user ${slackUserId}`);
  if (row.optedOut) return null;
  memoryUserCache.set(cacheKey, row.id);
  return row.id;
}

// Read-only lookup — resolve a Slack user's memory_user without creating one.
// Used by the `/memory me|about` views so merely looking doesn't provision a row.
export async function findSlackMemoryUser(
  workspaceId: string,
  slackUserId: string
): Promise<{ id: string; optedOut: boolean } | null> {
  const developer = await db.query.developerAccounts.findFirst({
    where: eq(developerAccounts.workspaceId, workspaceId),
    columns: { id: true },
  });
  if (!developer) return null;
  const row = await db.query.memoryUsers.findFirst({
    where: and(eq(memoryUsers.developerId, developer.id), eq(memoryUsers.externalId, slackUserId)),
    columns: { id: true, optedOut: true },
  });
  return row ?? null;
}

// Opt a Slack user in/out of personal memory. Opting out purges their personal
// profile + entity graph and detaches their chunks from per-user memory (they stay
// in the team profile). Returns the memoryUserId (or null if there was nothing to
// act on for an opt-in of an unseen user).
export async function setSlackUserOptOut(
  workspaceId: string,
  slackUserId: string,
  optedOut: boolean,
  teamName?: string | null
): Promise<{ memoryUserId: string }> {
  const developerId = await getWorkspaceDeveloperId(workspaceId, teamName);

  // Upsert the memory_user carrying the flag (opt-out can precede first message).
  const [row] = await db
    .insert(memoryUsers)
    .values({ developerId, externalId: slackUserId, optedOut })
    .onConflictDoUpdate({
      target: [memoryUsers.developerId, memoryUsers.externalId],
      set: { optedOut },
    })
    .returning({ id: memoryUsers.id });

  const memoryUserId = row.id;
  memoryUserCache.delete(`${workspaceId}:${slackUserId}`);

  if (optedOut) {
    // Purge personal memory; detach chunks so they remain in the team profile only.
    await db.transaction(async (tx) => {
      await tx.delete(staticDocuments).where(eq(staticDocuments.memoryUserId, memoryUserId));
      await tx.delete(entityNodes).where(eq(entityNodes.memoryUserId, memoryUserId));
      await tx
        .update(memoryChunks)
        .set({ memoryUserId: null, userSynthesized: true })
        .where(eq(memoryChunks.memoryUserId, memoryUserId));
    });
  }

  return { memoryUserId };
}

// Test seam — clear the in-process caches.
export function _clearSlackMemoryUserCaches(): void {
  workspaceDeveloperCache.clear();
  memoryUserCache.clear();
}
