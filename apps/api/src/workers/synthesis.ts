import { Worker } from "bullmq";
import { eq, and, or, gt, asc, inArray, isNull } from "drizzle-orm";
import { redis, synthesisQueue, type SynthesisJobData, type UserSynthesisJobData } from "../lib/infra/queue.js";
import { captureError } from "../lib/infra/error-reporting.js";
import { db, pool } from "../lib/db/index.js";
import {
  memoryChunks,
  staticDocuments,
  synthesisJobs,
  developerAccounts,
  memoryUsers,
} from "../lib/db/schema.js";
import { chatSynthesis as chat } from "../lib/ai/llm.js";
import { invalidateUserCache } from "../lib/infra/cache.js";
import { fireWebhook } from "../lib/infra/outbound-webhook.js";
import { neutralizePromptDelimiters } from "../lib/utils/sanitize.js";
import { persistEntityGraph } from "../lib/ai/entity-graph.js";
// Prompt text, response parsing, and the temporal merge live in a pure module
// (no DB/Redis imports) so the offline eval harness scores the exact
// production prompt. See scripts/eval/README.md.
import {
  MAX_STATIC_FACTS,
  MAX_DYNAMIC_CONTEXT,
  WORKSPACE_SYNTHESIS_SYSTEM_PROMPT,
  USER_SYNTHESIS_SYSTEM_PROMPT,
  buildWorkspaceSynthesisPrompt,
  buildUserSynthesisPrompt,
  mergeTemporalFacts,
  parseSynthesisResponse,
  type SynthesisResult,
} from "../lib/ai/synthesis-prompt.js";

const SYNTHESIS_BATCH_SIZE = 50;

export async function synthesize(workspaceId: string): Promise<void> {
  // Dedicated client ensures pg_advisory_lock and pg_advisory_unlock run on the
  // same backend connection — session-scoped locks are silently no-ops if the
  // unlock runs on a different pool connection.
  const client = await pool.connect();
  let acquired = false;
  let jobId: string | undefined;

  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired",
      [workspaceId]
    );
    acquired = lockResult.rows[0]?.acquired ?? false;

    if (!acquired) {
      console.log(`[synthesis] Lock busy for workspace ${workspaceId}, skipping`);
      return;
    }

    const [job] = await db
      .insert(synthesisJobs)
      .values({ workspaceId, status: "running" })
      .returning({ id: synthesisJobs.id });
    jobId = job.id;

    // Pull up to SYNTHESIS_BATCH_SIZE oldest unsynthesized workspace chunks. Slack
    // chunks now carry a memoryUserId (per-person memory) but still belong to the
    // team profile, so this is tracked by `synthesized` independently of the
    // per-user `userSynthesized` flag — one chunk feeds both passes.
    const chunks = await db
      .select()
      .from(memoryChunks)
      .where(and(
        eq(memoryChunks.workspaceId, workspaceId),
        eq(memoryChunks.synthesized, false),
        // Skip chunks whose TTL has elapsed — expired memories must not enter the profile
        or(isNull(memoryChunks.expiresAt), gt(memoryChunks.expiresAt, new Date())),
      ))
      .orderBy(asc(memoryChunks.createdAt))
      .limit(SYNTHESIS_BATCH_SIZE);

    if (chunks.length === 0) {
      await db
        .update(synthesisJobs)
        .set({ status: "complete", chunksProcessed: 0 })
        .where(eq(synthesisJobs.id, jobId));
      return;
    }

    // Pull current static document (workspace-scoped)
    const staticDoc = await db.query.staticDocuments.findFirst({
      where: and(eq(staticDocuments.workspaceId, workspaceId), isNull(staticDocuments.memoryUserId)),
    });

    // Chunk content and metadata are untrusted end-user input — neutralize forged
    // `--- BEGIN/END … ---` fences so a message can't escape the MESSAGES block in
    // the prompt below and inject instructions into the shared workspace profile.
    const chunksText = neutralizePromptDelimiters(
      chunks
        .map((c) => {
          const meta = c.metadata as { author: string; timestamp: string; channelName: string } | null;
          return `[${meta?.channelName ?? "?"}][${meta?.author ?? "?"}]\n${c.content}`;
        })
        .join("\n---\n")
    );

    const buildPrompt = (retry: boolean) =>
      buildWorkspaceSynthesisPrompt({
        staticFacts: staticDoc?.staticFacts ?? [],
        dynamicContext: staticDoc?.dynamicContext ?? [],
        chunksText,
        retry,
      });

    // Two attempts — second pass prefixes a hard retry instruction
    let result: SynthesisResult | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await chat([
        { role: "system", content: WORKSPACE_SYNTHESIS_SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(attempt > 0) },
      ]);
      result = parseSynthesisResponse(raw);
      if (result) break;
    }

    if (!result) {
      throw new Error("LLM returned invalid JSON after 2 attempts");
    }

    const newStaticFacts = result.static_facts.slice(0, MAX_STATIC_FACTS);
    const newDynamicContext = result.dynamic_context.slice(0, MAX_DYNAMIC_CONTEXT);
    const chunkIds = chunks.map((c) => c.id);

    await db.transaction(async (tx) => {
      if (staticDoc) {
        await tx
          .update(staticDocuments)
          .set({
            staticFacts: newStaticFacts,
            dynamicContext: newDynamicContext,
            version: staticDoc.version + 1,
            chunksSynthesizedCount: staticDoc.chunksSynthesizedCount + chunks.length,
            lastSynthesizedAt: new Date(),
          })
          .where(eq(staticDocuments.id, staticDoc.id));
      } else {
        await tx.insert(staticDocuments).values({
          workspaceId,
          staticFacts: newStaticFacts,
          dynamicContext: newDynamicContext,
          version: 1,
          chunksSynthesizedCount: chunks.length,
          lastSynthesizedAt: new Date(),
        });
      }

      await tx
        .update(memoryChunks)
        .set({ synthesized: true })
        .where(inArray(memoryChunks.id, chunkIds));

      await tx
        .update(synthesisJobs)
        .set({ status: "complete", chunksProcessed: chunks.length })
        .where(eq(synthesisJobs.id, jobId!));
    });

    console.log(`[synthesis] workspace ${workspaceId}: ${chunks.length} chunks synthesized`);

    // Full batch → more chunks likely remain; re-enqueue so the backlog drains
    // rather than waiting for the next ingest. Serialized by the workspace advisory
    // lock; the backlog strictly shrinks each pass, so this can't loop.
    if (chunks.length === SYNTHESIS_BATCH_SIZE) {
      const contJob: SynthesisJobData = { workspaceId };
      await synthesisQueue.add("synthesize", contJob);
    }

    // Fire outbound webhook if the developer registered one
    const devAccount = await db.query.developerAccounts.findFirst({
      where: eq(developerAccounts.workspaceId, workspaceId),
      columns: { webhookUrl: true, id: true },
    });
    if (devAccount?.webhookUrl) {
      const newVersion = staticDoc ? staticDoc.version + 1 : 1;
      fireWebhook(devAccount.webhookUrl, {
        event: "memory.updated",
        workspaceId,
        version: newVersion,
        synthesizedAt: new Date().toISOString(),
      }).catch((err) => console.error("[webhook] Workspace delivery error:", err));
    }
  } catch (err) {
    console.error(`[synthesis] Failed for workspace ${workspaceId}:`, err);
    if (jobId) {
      await db
        .update(synthesisJobs)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        })
        .where(eq(synthesisJobs.id, jobId));
    }
    throw err;
  } finally {
    if (acquired) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [workspaceId]);
    }
    client.release();
  }
}

export async function synthesizeUser(memoryUserId: string, workspaceId: string): Promise<void> {
  const client = await pool.connect();
  let acquired = false;
  let jobId: string | undefined;

  try {
    const lockResult = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired",
      [`user:${memoryUserId}`]
    );
    acquired = lockResult.rows[0]?.acquired ?? false;

    if (!acquired) {
      console.log(`[synthesis] Lock busy for user ${memoryUserId}, skipping`);
      return;
    }

    const [job] = await db
      .insert(synthesisJobs)
      .values({ workspaceId, status: "running" })
      .returning({ id: synthesisJobs.id });
    jobId = job.id;

    // Privacy enforcement point: if the user has opted out, build nothing and
    // detach any chunks a stale attribution cache may have tagged (they stay in the
    // team profile). This guarantees opt-out even across worker processes.
    const memUserRow = await db.query.memoryUsers.findFirst({
      where: eq(memoryUsers.id, memoryUserId),
      columns: { optedOut: true },
    });
    if (memUserRow?.optedOut) {
      await db
        .update(memoryChunks)
        .set({ memoryUserId: null, userSynthesized: true })
        .where(eq(memoryChunks.memoryUserId, memoryUserId));
      await db.update(synthesisJobs).set({ status: "complete", chunksProcessed: 0 }).where(eq(synthesisJobs.id, jobId));
      return;
    }

    const chunks = await db
      .select()
      .from(memoryChunks)
      .where(and(
        eq(memoryChunks.memoryUserId, memoryUserId),
        // Per-user pass tracks its own flag, so a chunk already counted toward the
        // team profile (`synthesized`) is still synthesized into the personal one.
        eq(memoryChunks.userSynthesized, false),
        // Skip chunks whose TTL has elapsed — expired memories must not enter the profile
        or(isNull(memoryChunks.expiresAt), gt(memoryChunks.expiresAt, new Date())),
      ))
      .orderBy(asc(memoryChunks.createdAt))
      .limit(SYNTHESIS_BATCH_SIZE);

    if (chunks.length === 0) {
      await db.update(synthesisJobs).set({ status: "complete", chunksProcessed: 0 }).where(eq(synthesisJobs.id, jobId));
      return;
    }

    const staticDoc = await db.query.staticDocuments.findFirst({
      where: eq(staticDocuments.memoryUserId, memoryUserId),
    });

    // Chunk content and metadata are untrusted end-user input — neutralize forged
    // `--- BEGIN/END … ---` fences so content can't escape the CONTENT block in
    // the prompt below and inject instructions into the user profile.
    const chunksText = neutralizePromptDelimiters(
      chunks
        .map((c) => {
          const meta = c.metadata as { author: string; timestamp: string; entityContext?: string } | null;
          // entityContext is a caller-supplied extraction hint — surfaces what the chunk is about
          const ecTag = typeof meta?.entityContext === "string" ? `[entityContext: ${JSON.stringify(meta.entityContext)}]` : "";
          return `[${meta?.author ?? "?"}][${meta?.timestamp ?? "?"}]${ecTag}\n${c.content}`;
        })
        .join("\n---\n")
    );

    const buildPrompt = (retry: boolean) =>
      buildUserSynthesisPrompt({
        staticFacts: staticDoc?.staticFacts ?? [],
        dynamicContext: staticDoc?.dynamicContext ?? [],
        temporalFacts: staticDoc?.temporalFacts ?? [],
        chunksText,
        retry,
      });

    let result: SynthesisResult | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await chat([
        { role: "system", content: USER_SYNTHESIS_SYSTEM_PROMPT },
        { role: "user", content: buildPrompt(attempt > 0) },
      ]);
      result = parseSynthesisResponse(raw);
      if (result) break;
    }

    if (!result) throw new Error("LLM returned invalid JSON after 2 attempts");

    const newStaticFacts = result.static_facts.slice(0, MAX_STATIC_FACTS);
    const newDynamicContext = result.dynamic_context.slice(0, MAX_DYNAMIC_CONTEXT);
    // Merge (never replace) temporal facts so an empty/partial LLM response can't
    // erase recorded history — facts are appended or closed, not dropped.
    const newTemporalFacts = mergeTemporalFacts(staticDoc?.temporalFacts ?? [], result.temporal_facts);
    const chunkIds = chunks.map((c) => c.id);

    await db.transaction(async (tx) => {
      if (staticDoc) {
        await tx
          .update(staticDocuments)
          .set({
            staticFacts: newStaticFacts,
            dynamicContext: newDynamicContext,
            temporalFacts: newTemporalFacts,
            version: staticDoc.version + 1,
            chunksSynthesizedCount: staticDoc.chunksSynthesizedCount + chunks.length,
            lastSynthesizedAt: new Date(),
          })
          .where(eq(staticDocuments.id, staticDoc.id));
      } else {
        await tx.insert(staticDocuments).values({
          memoryUserId,
          staticFacts: newStaticFacts,
          dynamicContext: newDynamicContext,
          temporalFacts: newTemporalFacts,
          version: 1,
          chunksSynthesizedCount: chunks.length,
          lastSynthesizedAt: new Date(),
        });
      }

      await tx.update(memoryChunks).set({ userSynthesized: true }).where(inArray(memoryChunks.id, chunkIds));
      await tx.update(synthesisJobs).set({ status: "complete", chunksProcessed: chunks.length }).where(eq(synthesisJobs.id, jobId!));
    });

    // Entity graph upserts run outside the profile transaction — a graph failure
    // must not roll back the synthesized profile
    if (result.entities?.length) {
      const memUser = await db.query.memoryUsers.findFirst({
        where: eq(memoryUsers.id, memoryUserId),
        columns: { developerId: true },
      });
      if (memUser) {
        try {
          await persistEntityGraph(memUser.developerId, memoryUserId, result.entities);
        } catch (err) {
          console.error(`[synthesis] Entity graph persistence failed for user ${memoryUserId}:`, err);
        }
      }
    }

    console.log(`[synthesis] user ${memoryUserId}: ${chunks.length} chunks synthesized`);
    await invalidateUserCache(memoryUserId);

    // A full batch means more unsynthesized chunks likely remain. Re-enqueue so the
    // backlog drains instead of waiting for the next ingest to trigger synthesis
    // (which may never come). No fixed jobId: the current job still holds
    // `synthesis-user-${id}` until it completes, so a same-id add would be a no-op;
    // an auto-id continuation is serialized by the per-user advisory lock and
    // no-ops cheaply if nothing is left. The backlog strictly shrinks, so no loop.
    if (chunks.length === SYNTHESIS_BATCH_SIZE) {
      const contJob: UserSynthesisJobData = { memoryUserId, workspaceId };
      await synthesisQueue.add("synthesize-user", contJob as never);
    }

    // Fire outbound webhook if the developer registered one
    const devAccount = await db.query.developerAccounts.findFirst({
      where: eq(developerAccounts.workspaceId, workspaceId),
      columns: { webhookUrl: true },
    });
    if (devAccount?.webhookUrl) {
      const newVersion = staticDoc ? staticDoc.version + 1 : 1;
      fireWebhook(devAccount.webhookUrl, {
        event: "memory.updated",
        workspaceId,
        memoryUserId,
        version: newVersion,
        synthesizedAt: new Date().toISOString(),
      }).catch((err) => console.error("[webhook] User delivery error:", err));
    }
  } catch (err) {
    console.error(`[synthesis] Failed for user ${memoryUserId}:`, err);
    if (jobId) {
      await db
        .update(synthesisJobs)
        .set({ status: "failed", error: err instanceof Error ? err.message : String(err) })
        .where(eq(synthesisJobs.id, jobId));
    }
    throw err;
  } finally {
    if (acquired) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [`user:${memoryUserId}`]);
    }
    client.release();
  }
}

export function startSynthesisWorker() {
  const worker = new Worker<SynthesisJobData | UserSynthesisJobData>(
    "synthesis",
    async (job) => {
      if (job.name === "synthesize-user") {
        const { memoryUserId, workspaceId } = job.data as UserSynthesisJobData;
        await synthesizeUser(memoryUserId, workspaceId);
      } else {
        await synthesize((job.data as SynthesisJobData).workspaceId);
      }
    },
    { connection: redis, concurrency: 2 }
  );

  worker.on("failed", (job, err) => {
    console.error(`[synthesis] Job ${job?.id} failed:`, err.message);
    captureError(err, { jobId: job?.id, jobName: job?.name });
  });

  worker.on("completed", (job) => {
    console.log(`[synthesis] Job ${job.id} completed`);
  });

  console.log("[synthesis] Worker started");
  return worker;
}
