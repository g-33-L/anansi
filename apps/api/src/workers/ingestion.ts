import { Worker } from "bullmq";
import { eq, and, sql } from "drizzle-orm";
import pdf from "pdf-parse";
import mammoth from "mammoth";
import { redis, synthesisQueue, type IngestionJobData, type UserSynthesisJobData } from "../lib/infra/queue.js";
import { db } from "../lib/db/index.js";
import { channels, memoryChunks, workspaces } from "../lib/db/schema.js";
import { chunkBySourceType } from "../lib/ai/chunker.js";
import { decrypt } from "../lib/utils/crypto.js";
import { downloadSlackFile } from "../lib/integrations/slack-client.js";
import { resolveSlackMemoryUserId } from "../lib/integrations/slack-memory-user.js";
import { redactForWorkspace } from "../lib/enterprise/redaction.js";
import { embedAndInsert, type ChunkInput } from "../lib/ai/ingest-core.js";
import type { SlackRawEvent } from "../routes/slack.js";

const _st = parseInt(process.env.SYNTHESIS_THRESHOLD ?? "25", 10);
if (!Number.isFinite(_st) || _st < 1) throw new Error("SYNTHESIS_THRESHOLD must be a positive integer");
const SYNTHESIS_THRESHOLD = _st;

// Per-person profiles build from fewer signals than a whole team's — a lower
// default keeps personal memory fresh without re-synthesizing on every message.
const _ust = parseInt(process.env.USER_SYNTHESIS_THRESHOLD ?? "10", 10);
if (!Number.isFinite(_ust) || _ust < 1) throw new Error("USER_SYNTHESIS_THRESHOLD must be a positive integer");
const USER_SYNTHESIS_THRESHOLD = _ust;

// Bounded in-process cache: "workspaceId:userId" → display name.
// Max 10_000 entries; oldest 25% evicted when full to prevent unbounded growth
// in long-running workers with many unique Slack users.
const USERNAME_CACHE_MAX = 10_000;
const userNameCache = new Map<string, string>();

function cachedUsername(key: string): string | undefined {
  return userNameCache.get(key);
}

function setCachedUsername(key: string, name: string): void {
  if (userNameCache.size >= USERNAME_CACHE_MAX) {
    let evict = Math.ceil(USERNAME_CACHE_MAX * 0.25);
    for (const k of userNameCache.keys()) {
      if (evict-- <= 0) break;
      userNameCache.delete(k);
    }
  }
  userNameCache.set(key, name);
}

async function resolveUsername(userId: string, botToken: string, workspaceId: string): Promise<string> {
  if (!userId || userId === "unknown") return "unknown";
  const key = `${workspaceId}:${userId}`;
  const cached = cachedUsername(key);
  if (cached !== undefined) return cached;
  try {
    const res = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
    const data = (await res.json()) as { ok: boolean; user?: { real_name?: string; name?: string } };
    const name = data.user?.real_name ?? data.user?.name ?? userId;
    setCachedUsername(key, name);
    return name;
  } catch {
    return userId;
  }
}

// ─── Channel upsert ───────────────────────────────────────────────────────────

async function upsertChannel(workspaceId: string, slackChannelId: string) {
  const rows = await db
    .insert(channels)
    .values({ workspaceId, slackChannelId, name: slackChannelId })
    .onConflictDoUpdate({
      target: [channels.workspaceId, channels.slackChannelId],
      set: { slackChannelId },
    })
    .returning({ id: channels.id });

  if (rows[0]) return rows[0].id;

  // onConflictDoUpdate returned no row (no-op update) — look up existing
  const existing = await db.query.channels.findFirst({
    where: and(eq(channels.workspaceId, workspaceId), eq(channels.slackChannelId, slackChannelId)),
    columns: { id: true },
  });
  if (!existing) throw new Error(`Channel not found after upsert: ${slackChannelId}`);
  return existing.id;
}

// ─── Synthesis trigger ────────────────────────────────────────────────────────

export async function maybeTriggerSynthesis(workspaceId: string): Promise<void> {
  // Count all unsynthesized workspace chunks — Slack chunks now carry a
  // memoryUserId (per-person memory) but still feed the team profile, so the count
  // must not exclude them.
  const [{ value }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(memoryChunks)
    .where(
      and(
        eq(memoryChunks.workspaceId, workspaceId),
        eq(memoryChunks.synthesized, false),
      )
    );

  if (value >= SYNTHESIS_THRESHOLD) {
    await synthesisQueue.add(
      "synthesize",
      { workspaceId },
      { jobId: `synthesis-${workspaceId}` } // BullMQ dedup by jobId
    );
  }
}

// Per-user synthesis trigger (Slack-native per-person memory). Fires once a user
// has accumulated enough new chunks; jobId dedup coalesces bursts of messages.
export async function maybeTriggerUserSynthesis(workspaceId: string, memoryUserId: string): Promise<void> {
  const [{ value }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(memoryChunks)
    .where(
      and(
        eq(memoryChunks.memoryUserId, memoryUserId),
        eq(memoryChunks.userSynthesized, false),
      )
    );

  if (value >= USER_SYNTHESIS_THRESHOLD) {
    const job: UserSynthesisJobData = { memoryUserId, workspaceId };
    await synthesisQueue.add("synthesize-user", job as never, { jobId: `synthesis-user-${memoryUserId}` });
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

// Returns the author's memoryUserId (if resolvable) so the caller can trigger
// per-user synthesis for them.
async function handleNewMessage(
  workspaceId: string,
  channelId: string,
  channelSlackId: string,
  channelName: string,
  botToken: string,
  event: SlackRawEvent,
  teamName?: string | null,
): Promise<string | null> {
  const rawText = event.text ?? "";
  const ts = event.ts ?? "";
  const userId = event.user ?? "unknown";
  const threadTs = event.thread_ts;

  if (!rawText.trim()) return null;

  const { text, secretsRedacted: redactedCount } = await redactForWorkspace(workspaceId, rawText);
  if (redactedCount > 0) {
    console.log(`[ingestion] Redacted ${redactedCount} secret(s) from message ${ts}`);
  }

  const isThreadReply = threadTs && threadTs !== ts;
  const sourceId = `msg:${channelSlackId}:${ts}`;
  const sourceType = isThreadReply ? "thread" : "message";

  // Attribute the message to its author's per-user memory (Slack-native per-person
  // memory) while keeping it workspace-scoped for the team profile.
  const [authorName, memoryUserId] = await Promise.all([
    resolveUsername(userId, botToken, workspaceId),
    resolveSlackMemoryUserId(workspaceId, userId, teamName),
  ]);
  const chunks = chunkBySourceType(text, sourceType);

  const inputs: ChunkInput[] = chunks.map((chunk, idx) => ({
    workspaceId,
    channelId,
    memoryUserId,
    sourceType,
    sourceId: chunks.length > 1 ? `${sourceId}:${idx}` : sourceId,
    content: chunk,
    metadata: {
      author: authorName,
      authorId: userId,
      timestamp: ts,
      channelName,
      ...(threadTs ? { threadTs } : {}),
    },
  }));

  await embedAndInsert(inputs);
  return memoryUserId;
}

async function handleMessageChanged(
  workspaceId: string,
  channelSlackId: string,
  event: SlackRawEvent
): Promise<void> {
  const message = event.message as SlackRawEvent | undefined;
  if (!message) return;

  const ts = message.ts ?? "";
  const { text: newText } = await redactForWorkspace(workspaceId, message.text ?? "");
  const sourceIdPrefix = `msg:${channelSlackId}:${ts}`;
  // thread_ts lives on the outer event envelope in message_changed, not on event.message
  const threadTs = event.thread_ts as string | undefined;
  const isThreadReply = threadTs && threadTs !== ts;

  if (!newText.trim()) {
    await db
      .delete(memoryChunks)
      .where(
        and(
          eq(memoryChunks.workspaceId, workspaceId),
          sql`source_id LIKE ${sourceIdPrefix + "%"}`
        )
      );
    return;
  }

  // Delete old chunks then re-insert with new content
  await db
    .delete(memoryChunks)
    .where(
      and(
        eq(memoryChunks.workspaceId, workspaceId),
        sql`source_id LIKE ${sourceIdPrefix + "%"}`
      )
    );

  const channelRecord = await db.query.channels.findFirst({
    where: and(
      eq(channels.workspaceId, workspaceId),
      eq(channels.slackChannelId, channelSlackId)
    ),
    columns: { id: true },
  });

  if (!channelRecord) return;

  const editedSourceType = isThreadReply ? "thread" : "message";
  const chunks = chunkBySourceType(newText, editedSourceType);
  const inputs: ChunkInput[] = chunks.map((chunk, idx) => ({
    workspaceId,
    channelId: channelRecord.id,
    sourceType: editedSourceType,
    sourceId: chunks.length > 1 ? `${sourceIdPrefix}:${idx}` : sourceIdPrefix,
    content: chunk,
    metadata: {
      author: message.user ?? "unknown",
      authorId: message.user ?? "unknown",
      timestamp: ts,
      channelName: channelSlackId,
      ...(threadTs ? { threadTs } : {}),
    },
  }));

  await embedAndInsert(inputs);
}

async function handleMessageDeleted(
  workspaceId: string,
  channelSlackId: string,
  event: SlackRawEvent
): Promise<void> {
  const deletedTs = (event.deleted_ts ?? event.ts ?? "") as string;
  const sourceIdPrefix = `msg:${channelSlackId}:${deletedTs}`;

  await db
    .delete(memoryChunks)
    .where(
      and(
        eq(memoryChunks.workspaceId, workspaceId),
        sql`source_id LIKE ${sourceIdPrefix + "%"}`
      )
    );
}

async function handleFiles(
  workspaceId: string,
  channelId: string,
  channelSlackId: string,
  event: SlackRawEvent,
  botToken: string,
  channelName?: string
): Promise<void> {
  const files = event.files ?? [];
  const ts = event.ts ?? "";
  const userId = event.user ?? "unknown";
  const authorName = await resolveUsername(userId, botToken, workspaceId);
  const resolvedChannelName = channelName ?? channelSlackId;

  for (const file of files) {
    const { id: fileId, mimetype, url_private } = file;
    const sourceId = `file:${channelSlackId}:${ts}:${fileId}`;

    let text: string;
    let sourceType: "file_pdf" | "file_doc";

    try {
      const buffer = await downloadSlackFile(url_private, botToken);

      if (mimetype === "application/pdf") {
        sourceType = "file_pdf";
        const parsed = await pdf(buffer);
        text = parsed.text;
      } else if (
        mimetype ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        sourceType = "file_doc";
        const parsed = await mammoth.extractRawText({ buffer });
        text = parsed.value;
      } else {
        continue; // unsupported file type
      }
    } catch (err) {
      console.error(`[ingestion] Failed to parse file ${fileId}:`, err);
      continue;
    }

    const { text: cleanText, secretsRedacted: fileRedacted } = await redactForWorkspace(workspaceId, text);
    if (fileRedacted > 0) {
      console.log(`[ingestion] Redacted ${fileRedacted} secret(s) from file ${fileId}`);
    }

    if (!cleanText.trim()) continue;

    const chunks = chunkBySourceType(cleanText, sourceType);
    const inputs: ChunkInput[] = chunks.map((chunk, idx) => ({
      workspaceId,
      channelId,
      sourceType,
      sourceId: chunks.length > 1 ? `${sourceId}:${idx}` : sourceId,
      content: chunk,
      metadata: {
        author: authorName,
        authorId: userId,
        timestamp: ts,
        channelName: resolvedChannelName,
      },
    }));

    await embedAndInsert(inputs);
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startIngestionWorker() {
  const worker = new Worker<IngestionJobData>(
    "ingestion",
    async (job) => {
      const { workspaceId, event } = job.data;
      const channelSlackId = event.channel;

      if (!channelSlackId) return;

      const subtype = event.subtype as string | undefined;

      // Skip bot messages (Anansi's own replies and any other bot) — they're not company knowledge
      if (subtype === "bot_message" || (event as Record<string, unknown>).bot_id) return;

      if (subtype === "message_changed") {
        await handleMessageChanged(workspaceId, channelSlackId, event);
        await maybeTriggerSynthesis(workspaceId);
        return;
      }

      if (subtype === "message_deleted") {
        await handleMessageDeleted(workspaceId, channelSlackId, event);
        return;
      }

      // Fetch bot token once — used for user name resolution and file downloads
      const workspace = await db.query.workspaces.findFirst({
        where: eq(workspaces.id, workspaceId),
        columns: { slackBotToken: true, slackTeamName: true },
      });
      if (!workspace) return;
      if (!workspace.slackBotToken) return;
  const botToken = decrypt(workspace.slackBotToken);

      // Upsert channel and resolve its human-readable name
      const channelId = await upsertChannel(workspaceId, channelSlackId);
      const channelRecord = await db.query.channels.findFirst({
        where: and(eq(channels.workspaceId, workspaceId), eq(channels.slackChannelId, channelSlackId)),
        columns: { name: true },
      });
      const channelName = channelRecord?.name ?? channelSlackId;

      const hasFiles = Array.isArray(event.files) && event.files.length > 0;

      let authorMemoryUserId: string | null = null;
      if (event.text?.trim()) {
        authorMemoryUserId = await handleNewMessage(
          workspaceId, channelId, channelSlackId, channelName, botToken, event, workspace.slackTeamName,
        );
      }

      if (hasFiles) {
        await handleFiles(workspaceId, channelId, channelSlackId, event, botToken, channelName);
      }

      await maybeTriggerSynthesis(workspaceId);
      if (authorMemoryUserId) await maybeTriggerUserSynthesis(workspaceId, authorMemoryUserId);
    },
    { connection: redis, concurrency: 5 }
  );

  worker.on("failed", (job, err) => {
    console.error(`[ingestion] Job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[ingestion] Job ${job.id} completed`);
  });

  console.log("[ingestion] Worker started");
  return worker;
}
