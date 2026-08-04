// Dispatches to ingestion | synthesis | backfill | notion | embed worker based on WORKER_ROLE env var.
import { startIngestionWorker } from "./workers/ingestion.js";
import { startSynthesisWorker } from "./workers/synthesis.js";
import { startBackfillWorker } from "./workers/backfill.js";
import { startNotionWorker } from "./workers/connectors/notion.js";
import { startGoogleDocsWorker } from "./workers/connectors/google-docs.js";
import { startEmbeddingWorker } from "./workers/embedding.js";
import { validateDeploymentConfig } from "./lib/config/deployment.js";

const REQUIRED_ENV_BASE = ["DATABASE_URL", "REDIS_URL", "ENCRYPTION_KEY"];
const missing = REQUIRED_ENV_BASE.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// Workers run inference + embedding, so they enforce the same deployment policy.
const deployment = validateDeploymentConfig();
if (!deployment.ok) {
  console.error("[worker] Deployment configuration is invalid:");
  for (const e of deployment.errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`[worker] Deployment mode: ${deployment.config.mode} (inference=${deployment.config.inference}, embedding=${deployment.config.embedding})`);

const role = process.env.WORKER_ROLE;

switch (role) {
  case "ingestion":
    startIngestionWorker();
    console.log("[worker] ingestion worker started");
    break;
  case "synthesis":
    startSynthesisWorker();
    console.log("[worker] synthesis worker started");
    break;
  case "backfill":
    startBackfillWorker();
    console.log("[worker] backfill worker started");
    break;
  case "notion":
    startNotionWorker();
    console.log("[worker] notion sync worker started");
    break;
  case "google-docs":
    startGoogleDocsWorker();
    console.log("[worker] google-docs sync worker started");
    break;
  case "embed":
    startEmbeddingWorker();
    console.log("[worker] embedding worker started");
    break;
  default:
    console.error(`Unknown or missing WORKER_ROLE: "${role}". Expected: ingestion | synthesis | backfill | notion | google-docs | embed`);
    process.exit(1);
}
