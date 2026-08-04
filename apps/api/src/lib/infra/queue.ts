import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { SlackRawEvent } from "../../routes/slack.js";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redis.on("error", (err: Error) => {
  console.error("[redis] connection error:", err.message);
});

export interface IngestionJobData {
  workspaceId: string;
  teamId: string;
  event: SlackRawEvent;
}

export interface SynthesisJobData {
  workspaceId: string;
}

export interface UserSynthesisJobData {
  memoryUserId: string;
  workspaceId: string;
}

export interface BackfillJobData {
  workspaceId: string;
}

export const ingestionQueue = new Queue<IngestionJobData>("ingestion", {
  connection: redis,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
});

export const synthesisQueue = new Queue<SynthesisJobData>("synthesis", {
  connection: redis,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
});

export const backfillQueue = new Queue<BackfillJobData>("backfill", {
  connection: redis,
  // One attempt — backfill is resumable via backfilled_through_ts cursor
  defaultJobOptions: { attempts: 1 },
});

export interface NotionSyncJobData {
  workspaceId: string;
  tokenId: string;
}

export const notionSyncQueue = new Queue<NotionSyncJobData>("notion-sync", {
  connection: redis,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10_000 } },
});

export interface GoogleDocsSyncJobData {
  workspaceId: string;
  tokenId: string;
}

export const googleDocsSyncQueue = new Queue<GoogleDocsSyncJobData>("google-docs-sync", {
  connection: redis,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 10_000 } },
});

// Retention sweep — runs daily, TTLs chunks past their plan's retention window.
export interface RetentionJobData {
  // Empty payload — the worker iterates all workspaces. Kept as an interface so
  // future per-tenant retention runs (compliance flushes) can be enqueued ad hoc.
  trigger?: "cron" | "manual";
}

export const retentionQueue = new Queue<RetentionJobData>("retention", {
  connection: redis,
  defaultJobOptions: { attempts: 1, removeOnComplete: 10, removeOnFail: 50 },
});

// Embedding back-fill — used by v1 ingest to decouple embedding computation from
// the request path. Each job embeds a single memory_chunk by its UUID and updates
// the embedding column. The chunk is invisible to search until embedded because
// searchChunks filters `embedding IS NOT NULL`.
export interface EmbedJobData {
  chunkId: string;
}

export const embedQueue = new Queue<EmbedJobData>("embed", {
  connection: redis,
  defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 2000 } },
});
