import { Worker } from "bullmq";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import { developerAccounts, entityNodes, memoryChunks, staticDocuments, subscriptions } from "../lib/db/schema.js";
import { redis, retentionQueue, type RetentionJobData } from "../lib/infra/queue.js";
import { getLimits, type PlanName } from "../lib/billing/plans.js";

const SWEEP_REPEAT_JOB_ID = "retention-daily-sweep";
const SWEEP_REPEAT_EVERY_MS = 24 * 60 * 60 * 1000;

// Hard-delete any chunk whose row-level expires_at has already lapsed.
// This is independent of plan retention — callers can set `ttl` on /v1/ingest
// to schedule their own deletes, and this sweep collects what their TTL marked.
async function purgeExpired(): Promise<number> {
  const deleted = await db
    .delete(memoryChunks)
    .where(sql`${memoryChunks.expiresAt} IS NOT NULL AND ${memoryChunks.expiresAt} < now()`)
    .returning({ id: memoryChunks.id });
  return deleted.length;
}

// For each plan with a finite memoryRetentionDays, delete chunks older than the
// window in workspaces on that plan. Workspaces without a subscription row are
// treated as the free plan via the LEFT JOIN; Pro/Scale/Enterprise have
// Infinity retention and are skipped here.
async function purgePastRetention(): Promise<{ plan: PlanName; deleted: number }[]> {
  // Group workspaces by plan in one pass. Free plans are implicit when no
  // subscription row exists; coalesce that NULL into 'free'.
  const rows = await db
    .select({
      workspaceId: developerAccounts.workspaceId,
      plan: sql<PlanName>`coalesce(${subscriptions.plan}, 'free')`,
    })
    .from(developerAccounts)
    .leftJoin(subscriptions, eq(subscriptions.workspaceId, developerAccounts.workspaceId));

  const byPlan = new Map<PlanName, string[]>();
  for (const row of rows) {
    if (!row.workspaceId) continue;
    const list = byPlan.get(row.plan) ?? [];
    list.push(row.workspaceId);
    byPlan.set(row.plan, list);
  }

  const results: { plan: PlanName; deleted: number }[] = [];
  for (const [plan, workspaceIds] of byPlan.entries()) {
    const retentionDays = getLimits(plan).memoryRetentionDays;
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) continue;
    if (workspaceIds.length === 0) continue;

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const deleted = await db
      .delete(memoryChunks)
      .where(
        and(
          sql`${memoryChunks.workspaceId} = ANY(${workspaceIds}::uuid[])`,
          lt(memoryChunks.createdAt, cutoff),
          // All chunks (including synthesized ones) are deleted past the retention
          // window. The derived staticDocuments profile is cleaned up separately
          // by purgeOrphanedStaticDocuments to satisfy GDPR right-to-erasure.
        ),
      )
      .returning({ id: memoryChunks.id });
    results.push({ plan, deleted: deleted.length });
  }
  return results;
}

// Delete staticDocuments entries for memoryUsers that have no remaining chunks.
// Runs after the main chunk purge so derived profiles don't outlive their source
// data — required for GDPR right-to-erasure compliance.
// Only targets user-scoped documents (memoryUserId IS NOT NULL); workspace-level
// profiles are unaffected since other users in that workspace may still have data.
async function purgeOrphanedStaticDocuments(): Promise<number> {
  const deleted = await db
    .delete(staticDocuments)
    .where(
      and(
        isNotNull(staticDocuments.memoryUserId),
        sql`${staticDocuments.memoryUserId} NOT IN (
          SELECT DISTINCT memory_user_id FROM memory_chunks WHERE memory_user_id IS NOT NULL
        )`,
      ),
    )
    .returning({ id: staticDocuments.id });
  return deleted.length;
}

// Delete entity graph nodes for memory users that have no remaining chunks. The
// graph is derived PII and must not outlive its source data (GDPR right-to-erasure);
// without this, edges survive their source chunk (sourceChunkId is ON DELETE SET
// NULL) and the retention/TTL path — unlike DELETE /v1/user — never removed them.
// Every node (entities and relationship targets) is created scoped to a
// memoryUserId, so scoping by orphaned memory_user_id is safe; deleting a node
// cascades to its edges. Runs after the chunk purges above. See BUG_AUDIT M4.
async function purgeOrphanedEntityNodes(): Promise<number> {
  const deleted = await db
    .delete(entityNodes)
    .where(
      and(
        isNotNull(entityNodes.memoryUserId),
        sql`${entityNodes.memoryUserId} NOT IN (
          SELECT DISTINCT memory_user_id FROM memory_chunks WHERE memory_user_id IS NOT NULL
        )`,
      ),
    )
    .returning({ id: entityNodes.id });
  return deleted.length;
}

export function startRetentionWorker(): { close(): Promise<void> } {
  const worker = new Worker<RetentionJobData>(
    "retention",
    async (job) => {
      const t0 = Date.now();
      const [expired, perPlan] = await Promise.all([purgeExpired(), purgePastRetention()]);
      // Derived data cleanup runs after chunk deletes so orphan detection is correct.
      const orphanedDocs = await purgeOrphanedStaticDocuments();
      const orphanedEntities = await purgeOrphanedEntityNodes();
      const total = expired + perPlan.reduce((s, p) => s + p.deleted, 0);
      console.log(
        JSON.stringify({
          event: "retention_sweep",
          trigger: job.data?.trigger ?? "cron",
          expired,
          perPlan,
          orphanedDocs,
          orphanedEntities,
          total,
          durationMs: Date.now() - t0,
        }),
      );
      return { expired, perPlan, orphanedDocs, orphanedEntities, total };
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[retention] sweep failed (job ${job?.id}): ${err.message}`);
  });

  // Schedule the daily cron — repeated jobs are idempotent by name, so calling
  // .add on every startup is safe (BullMQ no-ops a duplicate repeat).
  retentionQueue
    .add("daily-sweep", { trigger: "cron" }, { repeat: { every: SWEEP_REPEAT_EVERY_MS }, jobId: SWEEP_REPEAT_JOB_ID })
    .catch((err) => console.error("[retention] failed to schedule daily sweep:", err));

  return { close: () => worker.close() };
}
