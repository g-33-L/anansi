// Single source of truth for deployment mode and provider selection.
//
// Anansi supports three deployment modes, chosen by DEPLOYMENT_MODE:
//   - local  : air-gapped. Company content never leaves the box. Local inference
//              (Ollama) and local embeddings only; content-exporting telemetry off.
//              Startup FAILS if any cloud content path is configured.
//   - cloud  : today's behavior (default). Cloud LLM/embeddings when keys are set,
//              local fallback otherwise. Backwards compatible — no config change
//              needed for existing deployments.
//   - hybrid : explicit per-capability mix (e.g. local embeddings + cloud
//              reasoning) via INFERENCE_LOCATION / EMBEDDING_LOCATION.
//
// Provider modules (llm.ts, embed.ts, error-reporting.ts) consult this config
// instead of checking env vars directly, so provider selection lives in one place.

export type DeploymentMode = "local" | "cloud" | "hybrid";
export type ProviderLocation = "local" | "cloud";

export interface DeploymentConfig {
  mode: DeploymentMode;
  inference: ProviderLocation; // where LLM reasoning runs
  embedding: ProviderLocation; // where embeddings run
  telemetryAllowed: boolean; // may error/analytics telemetry that can carry content leave the box?
}

// Env vars that activate a cloud content path. Each is forbidden under local mode.
export const CLOUD_LLM_KEYS = ["CEREBRAS_API_KEY", "GITHUB_TOKEN"] as const;
export const CLOUD_EMBEDDING_KEYS = ["NOMIC_API_KEY"] as const;
export const TELEMETRY_KEYS = ["SENTRY_DSN"] as const;

const MODES: readonly DeploymentMode[] = ["local", "cloud", "hybrid"];
const LOCATIONS: readonly ProviderLocation[] = ["local", "cloud"];

type Env = Record<string, string | undefined>;

function parseLocation(value: string | undefined, fallback: ProviderLocation): ProviderLocation {
  return value === "local" || value === "cloud" ? value : fallback;
}

// Total function — always returns a config. Policy violations are reported
// separately by validateDeploymentConfig (enforced at startup). An unknown mode
// resolves to the safe default (cloud) but is flagged as an error by validation.
export function resolveDeploymentConfig(env: Env = process.env): DeploymentConfig {
  const raw = env.DEPLOYMENT_MODE?.trim().toLowerCase();
  const mode: DeploymentMode = (MODES as readonly string[]).includes(raw ?? "")
    ? (raw as DeploymentMode)
    : "cloud";

  if (mode === "local") {
    return { mode, inference: "local", embedding: "local", telemetryAllowed: false };
  }
  if (mode === "hybrid") {
    return {
      mode,
      inference: parseLocation(env.INFERENCE_LOCATION, "cloud"),
      embedding: parseLocation(env.EMBEDDING_LOCATION, "local"),
      telemetryAllowed: true,
    };
  }
  // cloud (default) — unchanged behavior.
  return { mode: "cloud", inference: "cloud", embedding: "cloud", telemetryAllowed: true };
}

export interface ValidationResult {
  ok: boolean;
  config: DeploymentConfig;
  errors: string[];
}

// Strict policy check for startup. Errors are actionable: they name the exact env
// var that violates the mode and how to fix it.
export function validateDeploymentConfig(env: Env = process.env): ValidationResult {
  const errors: string[] = [];

  const raw = env.DEPLOYMENT_MODE?.trim().toLowerCase();
  if (raw !== undefined && raw !== "" && !(MODES as readonly string[]).includes(raw)) {
    errors.push(
      `DEPLOYMENT_MODE="${env.DEPLOYMENT_MODE}" is invalid. Use one of: local, cloud, hybrid (default: cloud).`
    );
  }

  const config = resolveDeploymentConfig(env);

  if (config.mode === "local") {
    const forbidden: Array<{ keys: readonly string[]; label: string }> = [
      { keys: CLOUD_LLM_KEYS, label: "cloud LLM providers" },
      { keys: CLOUD_EMBEDDING_KEYS, label: "cloud embedding providers" },
      { keys: TELEMETRY_KEYS, label: "content-exporting telemetry" },
    ];
    for (const { keys, label } of forbidden) {
      for (const key of keys) {
        if (env[key]) {
          errors.push(
            `DEPLOYMENT_MODE=local forbids ${label}, but ${key} is set. ` +
              `Unset ${key} for an air-gapped install, or use DEPLOYMENT_MODE=hybrid (with explicit ` +
              `INFERENCE_LOCATION/EMBEDDING_LOCATION) or DEPLOYMENT_MODE=cloud.`
          );
        }
      }
    }
  }

  if (config.mode === "hybrid") {
    for (const key of ["INFERENCE_LOCATION", "EMBEDDING_LOCATION"] as const) {
      const v = env[key];
      if (v !== undefined && v !== "" && !(LOCATIONS as readonly string[]).includes(v)) {
        errors.push(`${key}="${v}" is invalid. Use "local" or "cloud".`);
      }
    }
  }

  return { ok: errors.length === 0, config, errors };
}

let cached: DeploymentConfig | undefined;

// Memoized accessor for provider modules. Reads process.env once.
export function getDeploymentConfig(): DeploymentConfig {
  if (!cached) cached = resolveDeploymentConfig(process.env);
  return cached;
}

// Test-only: clear the memoized config so a test can resolve a fresh env.
export function _resetDeploymentConfigForTest(): void {
  cached = undefined;
}
