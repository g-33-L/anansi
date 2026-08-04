import { describe, it, expect } from "vitest";
import { resolveDeploymentConfig, validateDeploymentConfig } from "../lib/config/deployment.js";
import { resolveLlmProvider } from "../lib/ai/llm.js";
import { resolveEmbeddingProvider } from "../lib/ai/embed.js";

// Deployment Modes: pure config resolution, startup validation, and provider
// selection. No DB, no network — the whole point is that policy is decidable
// before the app serves a single request.

describe("resolveDeploymentConfig", () => {
  it("defaults to cloud mode when DEPLOYMENT_MODE is unset (backwards compatible)", () => {
    const c = resolveDeploymentConfig({});
    expect(c).toEqual({ mode: "cloud", inference: "cloud", embedding: "cloud", telemetryAllowed: true });
  });

  it("local mode forces local inference + embeddings and disables telemetry", () => {
    const c = resolveDeploymentConfig({ DEPLOYMENT_MODE: "local" });
    expect(c).toEqual({ mode: "local", inference: "local", embedding: "local", telemetryAllowed: false });
  });

  it("local mode is case/whitespace tolerant", () => {
    expect(resolveDeploymentConfig({ DEPLOYMENT_MODE: "  LOCAL " }).mode).toBe("local");
  });

  it("hybrid mode reads explicit per-capability locations", () => {
    const c = resolveDeploymentConfig({ DEPLOYMENT_MODE: "hybrid", INFERENCE_LOCATION: "cloud", EMBEDDING_LOCATION: "local" });
    expect(c.mode).toBe("hybrid");
    expect(c.inference).toBe("cloud");
    expect(c.embedding).toBe("local");
  });

  it("hybrid defaults to local embeddings + cloud reasoning", () => {
    const c = resolveDeploymentConfig({ DEPLOYMENT_MODE: "hybrid" });
    expect(c.inference).toBe("cloud");
    expect(c.embedding).toBe("local");
  });

  it("an unknown mode resolves to the safe default (cloud)", () => {
    expect(resolveDeploymentConfig({ DEPLOYMENT_MODE: "banana" }).mode).toBe("cloud");
  });
});

describe("validateDeploymentConfig — local mode enforcement", () => {
  it("passes for a clean air-gapped config", () => {
    const r = validateDeploymentConfig({ DEPLOYMENT_MODE: "local", OLLAMA_BASE_URL: "http://localhost:11434" });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("fails when a cloud LLM key is present, and names it", () => {
    const r = validateDeploymentConfig({ DEPLOYMENT_MODE: "local", CEREBRAS_API_KEY: "sk-x" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("CEREBRAS_API_KEY"))).toBe(true);
  });

  it("fails when GITHUB_TOKEN (GitHub Models) is present", () => {
    const r = validateDeploymentConfig({ DEPLOYMENT_MODE: "local", GITHUB_TOKEN: "ghp_x" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("GITHUB_TOKEN"))).toBe(true);
  });

  it("fails when a cloud embedding key is present", () => {
    const r = validateDeploymentConfig({ DEPLOYMENT_MODE: "local", NOMIC_API_KEY: "nk-x" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("NOMIC_API_KEY"))).toBe(true);
  });

  it("fails when content-exporting telemetry is configured", () => {
    const r = validateDeploymentConfig({ DEPLOYMENT_MODE: "local", SENTRY_DSN: "https://k@sentry.io/1" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("SENTRY_DSN"))).toBe(true);
  });

  it("reports every violation at once with actionable messages", () => {
    const r = validateDeploymentConfig({ DEPLOYMENT_MODE: "local", CEREBRAS_API_KEY: "x", NOMIC_API_KEY: "y", SENTRY_DSN: "z" });
    expect(r.errors).toHaveLength(3);
    expect(r.errors.every((e) => e.includes("Unset"))).toBe(true);
  });
});

describe("validateDeploymentConfig — cloud & hybrid", () => {
  it("cloud mode with every cloud key set is valid (no regression for hosted users)", () => {
    const r = validateDeploymentConfig({ CEREBRAS_API_KEY: "x", GITHUB_TOKEN: "y", NOMIC_API_KEY: "z", SENTRY_DSN: "w" });
    expect(r.ok).toBe(true);
  });

  it("rejects an invalid DEPLOYMENT_MODE", () => {
    const r = validateDeploymentConfig({ DEPLOYMENT_MODE: "prod" });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain("DEPLOYMENT_MODE");
  });

  it("rejects an invalid hybrid location", () => {
    const r = validateDeploymentConfig({ DEPLOYMENT_MODE: "hybrid", INFERENCE_LOCATION: "onprem" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("INFERENCE_LOCATION"))).toBe(true);
  });
});

describe("provider selection honors the config", () => {
  it("local inference ignores cloud keys and uses Ollama", () => {
    expect(resolveLlmProvider({ inference: "local" }, { CEREBRAS_API_KEY: "x", GITHUB_TOKEN: "y" })).toBe("ollama");
  });

  it("cloud inference prefers Cerebras, then GitHub, then Ollama", () => {
    expect(resolveLlmProvider({ inference: "cloud" }, { CEREBRAS_API_KEY: "x" })).toBe("cerebras");
    expect(resolveLlmProvider({ inference: "cloud" }, { GITHUB_TOKEN: "y" })).toBe("github");
    expect(resolveLlmProvider({ inference: "cloud" }, {})).toBe("ollama");
  });

  it("local embedding ignores NOMIC_API_KEY and uses Ollama", () => {
    expect(resolveEmbeddingProvider({ embedding: "local" }, { NOMIC_API_KEY: "x" })).toBe("ollama");
  });

  it("cloud embedding uses Nomic when the key is set, else Ollama", () => {
    expect(resolveEmbeddingProvider({ embedding: "cloud" }, { NOMIC_API_KEY: "x" })).toBe("nomic");
    expect(resolveEmbeddingProvider({ embedding: "cloud" }, {})).toBe("ollama");
  });
});
