import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { startIngestionWorker } from "./workers/ingestion.js";
import { startSynthesisWorker } from "./workers/synthesis.js";
import { startBackfillWorker } from "./workers/backfill.js";
import { startRetentionWorker } from "./workers/retention.js";
import { startEmbeddingWorker } from "./workers/embedding.js";
import { startNotionWorker } from "./workers/connectors/notion.js";
import { startGoogleDocsWorker } from "./workers/connectors/google-docs.js";
import { closePool } from "./lib/db/index.js";
import { runMigrationsLocked } from "./lib/db/migrate.js";
import { validateDeploymentConfig } from "./lib/config/deployment.js";

// Core vars always required
const REQUIRED_ENV = [
  "DATABASE_URL",
  "REDIS_URL",
  "ENCRYPTION_KEY",
  "CSRF_SIGNING_KEY",
  "QUERY_API_KEY",
  "API_KEY_HMAC_SECRET",
];

// Warn (not fatal) if FOUNDER_EMAIL is absent — the owner enterprise bypass won't be active.
if (!process.env.FOUNDER_EMAIL) {
  console.warn("[startup] FOUNDER_EMAIL is not set — owner enterprise bypass is inactive. Set FOUNDER_EMAIL=<your-email> in env.");
}

// Deployment mode: validate provider selection before serving. In local mode this
// FAILS FAST if any cloud content path (cloud LLM/embedding key, content-exporting
// telemetry) is configured — turning the privacy guarantee into an enforced invariant.
const deployment = validateDeploymentConfig();
if (!deployment.ok) {
  console.error("[startup] Deployment configuration is invalid:");
  for (const e of deployment.errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `[startup] Deployment mode: ${deployment.config.mode} ` +
    `(inference=${deployment.config.inference}, embedding=${deployment.config.embedding}, ` +
    `telemetry=${deployment.config.telemetryAllowed ? "allowed" : "off"})`
);

// LLM: a cloud-inference deployment needs a usable provider (llm.ts routes
// Cerebras → GitHub Models → Ollama). Local inference always uses Ollama (default
// localhost), so no cloud key is required there.
if (
  deployment.config.inference === "cloud" &&
  !process.env.CEREBRAS_API_KEY &&
  !process.env.GITHUB_TOKEN &&
  !process.env.OLLAMA_BASE_URL
) {
  console.error("Missing LLM provider: set CEREBRAS_API_KEY (Cerebras), GITHUB_TOKEN (GitHub Models), or OLLAMA_BASE_URL (local Ollama)");
  process.exit(1);
}

// Slack bot vars only required when Slack is configured
if (process.env.SLACK_SIGNING_SECRET || process.env.SLACK_CLIENT_ID) {
  const slackVars = ["SLACK_SIGNING_SECRET", "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"];
  REQUIRED_ENV.push(...slackVars.filter((v) => !REQUIRED_ENV.includes(v)));
}

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// Run DB migrations on startup (idempotent — drizzle tracks applied migrations),
// serialized under the same advisory lock the standalone job uses so a rolling
// deploy with several booting replicas never races the migration table.
//
// Managed production runs the explicit `pnpm db:migrate` step BEFORE rollout and
// sets RUN_MIGRATIONS_ON_STARTUP=false (ADR-0010). Default is true — self-host and
// local keep the zero-config single-node behavior.
if (process.env.RUN_MIGRATIONS_ON_STARTUP !== "false") {
  try {
    await runMigrationsLocked(process.env.DATABASE_URL!);
    console.log("[db] Migrations applied");
  } catch (err) {
    console.error("[db] Migration failed:", err);
    process.exit(1);
  }
} else {
  console.log("[db] RUN_MIGRATIONS_ON_STARTUP=false — skipping (expects an explicit migration job)");
}

const app = createApp();

// Always start core workers — capture handles for graceful shutdown.
// Typed as the minimal { close() } interface so connector workers (different
// BullMQ generics) can be pushed into the same array without type errors.
const workers: { close(): Promise<void> }[] = [
  startIngestionWorker(),
  startSynthesisWorker(),
  startBackfillWorker(),
  startRetentionWorker(),
  // The embed queue must always have a consumer: /v1/ingest inserts chunks
  // with NULL embeddings and relies on this worker to fill them in. It also
  // runs under worker-entry.js (WORKER_ROLE=embed) for scale-out; BullMQ
  // distributes jobs safely if both are running.
  startEmbeddingWorker(),
];

// Start connector sync workers (require their respective OAuth apps to be configured)
if (process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET) {
  workers.push(startNotionWorker());
} else {
  console.log("[startup] Notion connector disabled — set NOTION_CLIENT_ID + NOTION_CLIENT_SECRET to enable");
}

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  workers.push(startGoogleDocsWorker());
} else {
  console.log("[startup] Google Docs connector disabled — set GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET to enable");
}

const port = parseInt(process.env.PORT ?? "3000", 10);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Anansi API listening on http://0.0.0.0:${info.port}`);
});

// Graceful shutdown — Railway sends SIGTERM before SIGKILL.
// Close workers first so in-flight jobs complete, then release the DB pool.
async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] ${signal} received — draining workers`);
  await Promise.allSettled(workers.map((w) => w.close()));
  await closePool();
  console.log("[shutdown] Clean exit");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
