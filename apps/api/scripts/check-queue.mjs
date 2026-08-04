import { Queue } from "bullmq";
import IORedis from "ioredis";

const redis = new IORedis({ host: "localhost", port: 6379, maxRetriesPerRequest: null });
const backfillQueue = new Queue("backfill", { connection: redis });

const waiting = await backfillQueue.getWaiting();
const active = await backfillQueue.getActive();
const failed = await backfillQueue.getFailed();
const completed = await backfillQueue.getCompleted();

console.log("Waiting:", waiting.map(j => ({ id: j.id, data: j.data })));
console.log("Active:", active.map(j => ({ id: j.id, data: j.data })));
console.log("Failed:", failed.map(j => ({ id: j.id, failedReason: j.failedReason })));
console.log("Completed:", completed.map(j => ({ id: j.id })));

await redis.quit();
process.exit(0);
