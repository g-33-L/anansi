import { Worker } from "bullmq";
import { eq, and, or } from "drizzle-orm";
import { redis, ingestionQueue, type BackfillJobData } from "../lib/infra/queue.js";
import { db } from "../lib/db/index.js";
import { channels, workspaces } from "../lib/db/schema.js";
import { decrypt } from "../lib/utils/crypto.js";
import type { SlackRawEvent } from "../routes/slack.js";

// ─── Slack API helpers ────────────────────────────────────────────────────────

interface SlackChannel {
  id: string;
  name: string;
}

interface SlackMessage {
  type: string;
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  subtype?: string;
  files?: Array<{ id: string; name: string; mimetype: string; url_private: string }>;
}

async function slackGet<T extends { ok: boolean; error?: string }>(
  path: string,
  params: Record<string, string>,
  botToken: string
): Promise<T> {
  const url = new URL(`https://slack.com/api/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Slack API ${path} HTTP ${res.status}`);

  const data = (await res.json()) as T;
  if (!data.ok) throw new Error(`Slack API ${path}: ${data.error ?? "unknown error"}`);
  return data;
}

async function listChannels(botToken: string): Promise<SlackChannel[]> {
  const all: SlackChannel[] = [];
  let cursor: string | undefined;

  do {
    const data = await slackGet<{
      ok: boolean;
      error?: string;
      channels: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    }>("conversations.list", {
      types: "public_channel",
      limit: "200",
      exclude_archived: "true",
      ...(cursor ? { cursor } : {}),
    }, botToken);

    all.push(...data.channels);
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return all;
}

async function fetchHistoryPage(
  channelId: string,
  botToken: string,
  cursor?: string,
  latest?: string
): Promise<{ messages: SlackMessage[]; nextCursor?: string }> {
  const params: Record<string, string> = {
    channel: channelId,
    limit: "100",
    inclusive: "false",
  };
  if (cursor) params.cursor = cursor;
  if (latest) params.latest = latest;

  const data = await slackGet<{
    ok: boolean;
    error?: string;
    messages: SlackMessage[];
    has_more: boolean;
    response_metadata?: { next_cursor?: string };
  }>("conversations.history", params, botToken);

  return {
    messages: data.messages,
    nextCursor: data.has_more ? data.response_metadata?.next_cursor : undefined,
  };
}

// ─── Per-channel backfill ─────────────────────────────────────────────────────

async function backfillChannel(
  workspaceId: string,
  channel: { id: string; slackChannelId: string; backfilledThroughTs: string | null },
  botToken: string
): Promise<void> {
  await db
    .update(channels)
    .set({ backfillStatus: "running" })
    .where(eq(channels.id, channel.id));

  try {
    let cursor: string | undefined;
    // Resume: latest = oldest ts we reached last time; skip messages older than that
    const latest = channel.backfilledThroughTs ?? undefined;
    let totalQueued = 0;

    do {
      const { messages, nextCursor } = await fetchHistoryPage(
        channel.slackChannelId,
        botToken,
        cursor,
        latest
      );

      // Filter out bot posts, joins/leaves, and any message without a ts
      const userMessages = messages.filter(
        (m) => m.type === "message" && !m.subtype && m.ts
      );

      if (userMessages.length > 0) {
        await ingestionQueue.addBulk(
          userMessages.map((msg) => ({
            name: "backfill" as const,
            data: {
              workspaceId,
              teamId: "",
              event: {
                type: "message",
                channel: channel.slackChannelId,
                ts: msg.ts,
                user: msg.user ?? "unknown",
                text: msg.text ?? "",
                ...(msg.thread_ts ? { thread_ts: msg.thread_ts } : {}),
                ...(msg.files ? { files: msg.files } : {}),
              } as SlackRawEvent,
            },
          }))
        );
        totalQueued += userMessages.length;
      }

      // Track the oldest ts in this batch so we can resume if interrupted
      // Slack returns messages newest-first, so last element = oldest in batch
      if (messages.length > 0) {
        const oldestTs = messages[messages.length - 1].ts;
        await db
          .update(channels)
          .set({ backfilledThroughTs: oldestTs })
          .where(eq(channels.id, channel.id));
      }

      cursor = nextCursor;
    } while (cursor);

    await db
      .update(channels)
      .set({ backfillStatus: "complete" })
      .where(eq(channels.id, channel.id));

    console.log(`[backfill] #${channel.slackChannelId}: ${totalQueued} messages queued`);
  } catch (err) {
    await db
      .update(channels)
      .set({ backfillStatus: "failed" })
      .where(eq(channels.id, channel.id));
    // Log but don't rethrow — continue with remaining channels
    console.error(`[backfill] #${channel.slackChannelId} failed:`, err);
  }
}

// ─── Per-workspace backfill ───────────────────────────────────────────────────

async function backfillWorkspace(workspaceId: string): Promise<void> {
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { slackBotToken: true },
  });

  if (!workspace) {
    console.error(`[backfill] Workspace ${workspaceId} not found`);
    return;
  }

  if (!workspace.slackBotToken) return;
  const botToken = decrypt(workspace.slackBotToken);

  // Discover all public channels via conversations.list
  const slackChannels = await listChannels(botToken);

  // Upsert newly discovered channels — existing rows keep their backfill_status
  for (const ch of slackChannels) {
    await db
      .insert(channels)
      .values({
        workspaceId,
        slackChannelId: ch.id,
        name: ch.name,
        backfillStatus: "pending",
      })
      .onConflictDoUpdate({
        target: [channels.workspaceId, channels.slackChannelId],
        set: { name: ch.name },
      });
  }

  // Find channels that still need backfilling (pending = new, failed = retryable)
  const pending = await db.query.channels.findMany({
    where: and(
      eq(channels.workspaceId, workspaceId),
      or(eq(channels.backfillStatus, "pending"), eq(channels.backfillStatus, "failed"))
    ),
    columns: { id: true, slackChannelId: true, backfilledThroughTs: true },
  });

  console.log(`[backfill] workspace ${workspaceId}: ${pending.length} channels to backfill`);

  for (const ch of pending) {
    await backfillChannel(workspaceId, ch, botToken);
  }

  console.log(`[backfill] workspace ${workspaceId}: done`);
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startBackfillWorker() {
  const worker = new Worker<BackfillJobData>(
    "backfill",
    async (job) => {
      await backfillWorkspace(job.data.workspaceId);
    },
    { connection: redis, concurrency: 1 }
  );

  worker.on("failed", (job, err) => {
    console.error(`[backfill] Job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[backfill] Job ${job.id} completed`);
  });

  console.log("[backfill] Worker started");
  return worker;
}
