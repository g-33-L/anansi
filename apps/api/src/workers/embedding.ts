import { Worker } from "bullmq";
import { redis, type EmbedJobData } from "../lib/infra/queue.js";
import { embedChunk } from "../lib/ai/ingest-core.js";

// ─── Embedding worker ─────────────────────────────────────────────────────────
// Processes embed jobs enqueued by v1 /ingest and /ingest/batch.
// Each job embeds a single memory_chunk by UUID and updates the embedding column.
// The chunk is invisible to search until this worker runs because searchChunks
// filters `embedding IS NOT NULL`.

export function startEmbeddingWorker() {
  const worker = new Worker<EmbedJobData>(
    "embed",
    async (job) => {
      const { chunkId } = job.data;
      await embedChunk(chunkId);
    },
    {
      connection: redis,
      // Concurrency 3: embedding calls are I/O-bound network requests; some
      // parallelism helps throughput without overloading the embedding provider.
      concurrency: 3,
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[embed-worker] Job ${job?.id} (chunkId=${job?.data?.chunkId}) failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[embed-worker] Job ${job.id} completed (chunkId=${job.data.chunkId})`);
  });

  console.log("[embed-worker] Embedding worker started");
  return worker;
}
