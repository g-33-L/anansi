// Enqueue a Slack history backfill job for a workspace.
// Usage: node scripts/trigger-backfill.mjs <workspaceId>
import { Queue } from "bullmq";
import IORedis from "ioredis";

const workspaceId = process.argv[2];
if (!workspaceId) {
  console.error("Usage: node scripts/trigger-backfill.mjs <workspaceId>");
  process.exit(1);
}

const redis = new IORedis({ host: "localhost", port: 6379, maxRetriesPerRequest: null });
const backfillQueue = new Queue("backfill", { connection: redis });

await backfillQueue.add(
  "backfill",
  { workspaceId },
  { jobId: `backfill-${workspaceId}-${Date.now()}` }
);

console.log("Backfill job enqueued for workspace", workspaceId);
await redis.quit();
process.exit(0);
