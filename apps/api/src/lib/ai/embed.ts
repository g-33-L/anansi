import { createHash } from "crypto";
import { redis } from "../infra/queue.js";
// Provider selection is governed by the deployment config: embedding=local forces
// Ollama and ignores NOMIC_API_KEY; embedding=cloud uses Nomic when the key is set.
import { getDeploymentConfig, type DeploymentConfig } from "../config/deployment.js";

const NOMIC_API_KEY = process.env.NOMIC_API_KEY;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const NOMIC_MODEL = "nomic-embed-text-v1.5";

const EMBED_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h — query embeddings change rarely

function embedCacheKey(text: string): string {
  return `emb:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`;
}

let _totalCalls = 0;
let _totalChunks = 0;
let _totalTokens = 0;

export function getEmbedStats() {
  return { calls: _totalCalls, chunks: _totalChunks, tokens: _totalTokens };
}

const NOMIC_ENDPOINT = "https://api-atlas.nomic.ai/v1/embedding/text";

async function embedBatchNomic(texts: string[], taskType: "search_document" | "search_query"): Promise<number[][]> {
  let res: Response;
  try {
    res = await fetch(NOMIC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NOMIC_API_KEY}`,
      },
      body: JSON.stringify({ model: NOMIC_MODEL, texts, task_type: taskType }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (isConnectionFailure(err)) throw new EmbeddingProviderUnavailableError("nomic", NOMIC_ENDPOINT, err);
    throw err;
  }

  if (!res.ok) throw new Error(`Nomic embed failed: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as { embeddings: number[][]; usage?: { total_tokens?: number } };
  _totalCalls += 1;
  _totalChunks += texts.length;
  if (data.usage?.total_tokens) _totalTokens += data.usage.total_tokens;

  console.log(JSON.stringify({ event: "embed_batch", model: NOMIC_MODEL, inputs: texts.length, tokens: data.usage?.total_tokens ?? null }));
  return data.embeddings;
}

/*
 * Raised when the configured embedding backend cannot be reached at all.
 *
 * This is the single most common first-run failure. The default stack embeds
 * via Ollama, which `docker compose up` does NOT start — it runs on the host.
 * Undici surfaces the refused connection as a bare "fetch failed", which
 * propagates to the caller as an opaque 500 and tells the operator nothing.
 * Distinguishing "backend is missing" from "backend returned an error" is what
 * makes the difference actionable.
 */
export class EmbeddingProviderUnavailableError extends Error {
  readonly provider: EmbeddingProvider;
  readonly endpoint: string;

  constructor(provider: EmbeddingProvider, endpoint: string, cause: unknown) {
    super(
      `Embedding provider "${provider}" is unreachable at ${endpoint}. ` +
        `Nothing can be embedded or searched until it responds. Either start Ollama ` +
        `on the host (\`ollama serve\` plus \`ollama pull ${OLLAMA_EMBED_MODEL}\`), or ` +
        `switch to a hosted embedder by setting EMBEDDING_LOCATION=cloud and NOMIC_API_KEY.`
    );
    this.name = "EmbeddingProviderUnavailableError";
    this.provider = provider;
    this.endpoint = endpoint;
    this.cause = cause;
  }

  /*
   * What is safe to return over HTTP.
   *
   * For Ollama the endpoint is always an operator-controlled private address
   * (localhost / host.docker.internal / an internal host), and printing it is
   * the single most useful clue — it is what reveals the compose trap where a
   * container inherits `localhost:11434` from a host .env. For a hosted
   * provider the URL belongs to a third party and says nothing the caller can
   * act on, so it is withheld.
   */
  publicMessage(): string {
    return this.provider === "ollama"
      ? this.message
      : `Embedding provider "${this.provider}" is unavailable. Retrieval and ingestion cannot proceed until it recovers.`;
  }
}

/*
 * Raised when Ollama answers normally but the configured embedding model has
 * not been pulled. Distinct from EmbeddingProviderUnavailableError (backend
 * unreachable) — this is Ollama responding and saying "no such model." Both
 * are dependency outages from the caller's perspective and both map to 503,
 * but conflating them would blur the fix: "start Ollama" vs. "pull the model."
 * Without this, the request fell through to a bare 500 with no indication
 * that `ollama pull` was the fix — the exact failure a first-run install hits
 * if step 2 of the quickstart (pulling the embedding model) is skipped.
 */
export class EmbeddingModelNotFoundError extends Error {
  readonly provider: EmbeddingProvider;
  readonly model: string;

  constructor(provider: EmbeddingProvider, model: string) {
    super(`Embedding model "${model}" is not available on the "${provider}" backend. Pull it with \`ollama pull ${model}\` and retry.`);
    this.name = "EmbeddingModelNotFoundError";
    this.provider = provider;
    this.model = model;
  }

  publicMessage(): string {
    return this.message;
  }
}

/** A refused/reset/timed-out connection, as opposed to an HTTP error response. */
function isConnectionFailure(err: unknown): boolean {
  const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code;
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    (err as Error)?.name === "TimeoutError"
  );
}

async function embedBatchOllama(texts: string[]): Promise<number[][]> {
  const start = Date.now();
  const endpoint = `${OLLAMA_BASE_URL}/api/embed`;

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    if (isConnectionFailure(err)) throw new EmbeddingProviderUnavailableError("ollama", endpoint, err);
    throw err;
  }

  if (!res.ok) {
    const body = await res.text();
    // Ollama's /api/embed returns 404 specifically for "no such model" — any other
    // non-ok status is a genuine backend error, not a missing-model condition.
    if (res.status === 404) throw new EmbeddingModelNotFoundError("ollama", OLLAMA_EMBED_MODEL);
    throw new Error(`Ollama embed failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { embeddings: number[][]; prompt_eval_count?: number };
  if (!Array.isArray(data.embeddings))
    throw new Error(`Ollama returned unexpected embeddings shape: ${JSON.stringify(data).slice(0, 200)}`);

  _totalCalls += 1;
  _totalChunks += texts.length;
  if (data.prompt_eval_count != null) _totalTokens += data.prompt_eval_count;

  console.log(JSON.stringify({ event: "embed_batch", model: OLLAMA_EMBED_MODEL, inputs: texts.length, tokens: data.prompt_eval_count ?? null, durationMs: Date.now() - start }));
  return data.embeddings;
}

export type EmbeddingProvider = "nomic" | "ollama";

// Pure provider selection. Under local embedding, NOMIC_API_KEY is ignored (Ollama
// only) — content never reaches a cloud embedding service.
export function resolveEmbeddingProvider(
  cfg: Pick<DeploymentConfig, "embedding">,
  env: NodeJS.ProcessEnv = process.env
): EmbeddingProvider {
  if (cfg.embedding === "local") return "ollama";
  return env.NOMIC_API_KEY ? "nomic" : "ollama";
}

export type EmbeddingProbe = {
  provider: EmbeddingProvider;
  ok: boolean;
  detail: string;
};

/*
 * Reachability of the configured embedding backend, for /status.
 *
 * Without this, /status reported "All systems operational" while /v1/context
 * was returning errors — it probed Postgres, Redis, and the queue, none of
 * which notice a missing embedder. A status page that is green during an
 * outage is worse than no status page.
 *
 * Ollama is probed for real: it is local, the call is free, and it is the one
 * that actually goes missing. Nomic is only reported as configured — probing it
 * would spend quota on every status check, and a third-party outage is not
 * something the operator can act on from here.
 */
export async function probeEmbeddingProvider(): Promise<EmbeddingProbe> {
  const provider = resolveEmbeddingProvider(getDeploymentConfig());

  if (provider === "nomic") {
    return { provider, ok: true, detail: "cloud (not probed)" };
  }

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    if (!res.ok) {
      return { provider, ok: false, detail: `${OLLAMA_BASE_URL} returned ${res.status}` };
    }

    // Reachability alone is not enough — Ollama serving requests while the
    // configured embedding model isn't pulled previously reported "ok" here,
    // then failed on the very next /v1/context call with no warning.
    const data = (await res.json()) as { models?: { name: string }[] };
    const hasModel = (data.models ?? []).some(
      (m) => m.name === OLLAMA_EMBED_MODEL || m.name.startsWith(`${OLLAMA_EMBED_MODEL}:`)
    );
    return hasModel
      ? { provider, ok: true, detail: OLLAMA_BASE_URL }
      : {
          provider,
          ok: false,
          detail: `${OLLAMA_BASE_URL} is reachable but "${OLLAMA_EMBED_MODEL}" is not pulled — run \`ollama pull ${OLLAMA_EMBED_MODEL}\``,
        };
  } catch {
    return { provider, ok: false, detail: `unreachable at ${OLLAMA_BASE_URL}` };
  }
}

export async function embedBatch(texts: string[], taskType: "search_document" | "search_query" = "search_document"): Promise<number[][]> {
  return resolveEmbeddingProvider(getDeploymentConfig()) === "nomic"
    ? embedBatchNomic(texts, taskType)
    : embedBatchOllama(texts);
}

export async function embedOne(text: string): Promise<number[]> {
  // Cache search-query embeddings in Redis — same question from different sessions hits cache
  const cacheKey = embedCacheKey(text);
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as number[];
  } catch {
    // Cache read failure is non-fatal
  }

  const [embedding] = await embedBatch([text], "search_query");
  if (!embedding) throw new Error("No embedding returned for input");

  try {
    await redis.set(cacheKey, JSON.stringify(embedding), "EX", EMBED_CACHE_TTL_SECONDS);
  } catch {
    // Cache write failure is non-fatal
  }

  return embedding;
}
