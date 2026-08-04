import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  embedBatch,
  embedOne,
  getEmbedStats,
  EmbeddingProviderUnavailableError,
  probeEmbeddingProvider,
} from "../lib/ai/embed.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockOllamaResponse(embeddings: number[][], prompt_eval_count?: number) {
  return {
    ok: true,
    text: () => Promise.resolve(""),
    json: () => Promise.resolve({ embeddings, prompt_eval_count }),
  } as unknown as Response;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("embed.ts — counters and validation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── test:1 ──────────────────────────────────────────────────────────────────

  it("increments calls and chunks correctly for a batch", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockOllamaResponse([[1, 2], [3, 4], [5, 6]])
    );

    const before = getEmbedStats();
    await embedBatch(["a", "b", "c"]);
    const after = getEmbedStats();

    expect(after.calls - before.calls).toBe(1);
    expect(after.chunks - before.chunks).toBe(3);
  });

  // ── test:2 ──────────────────────────────────────────────────────────────────

  it("accumulates tokens when prompt_eval_count is present", async () => {
    vi.mocked(fetch).mockResolvedValue(mockOllamaResponse([[1, 2]], 42));

    const before = getEmbedStats();
    await embedBatch(["hello"]);
    const after = getEmbedStats();

    expect(after.tokens - before.tokens).toBe(42);
  });

  // ── test:3 ──────────────────────────────────────────────────────────────────

  it("does not add to tokens when prompt_eval_count is absent", async () => {
    vi.mocked(fetch).mockResolvedValue(mockOllamaResponse([[1, 2]]));

    const before = getEmbedStats();
    await embedBatch(["hello"]);
    const after = getEmbedStats();

    expect(after.tokens - before.tokens).toBe(0);
  });

  // ── test:4 ──────────────────────────────────────────────────────────────────

  it("counts prompt_eval_count: 0 as a valid (zero) token observation", async () => {
    vi.mocked(fetch).mockResolvedValue(mockOllamaResponse([[1, 2]], 0));

    const before = getEmbedStats();
    await embedBatch(["hello"]);
    const after = getEmbedStats();

    // 0 tokens added — but the call should still succeed and increment calls/chunks
    expect(after.calls - before.calls).toBe(1);
    expect(after.tokens - before.tokens).toBe(0);
  });

  // ── test:5 ──────────────────────────────────────────────────────────────────

  it("throws on null embeddings response and does not increment counters", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({ embeddings: null }),
    } as unknown as Response);

    const before = getEmbedStats();
    await expect(embedBatch(["x"])).rejects.toThrow("unexpected embeddings shape");
    const after = getEmbedStats();

    // Counters must NOT have incremented — the null check fires before them
    expect(after.calls).toBe(before.calls);
    expect(after.chunks).toBe(before.chunks);
  });

  // ── test:6 ──────────────────────────────────────────────────────────────────

  it("throws when Ollama responds with a non-ok status", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    } as unknown as Response);

    await expect(embedBatch(["x"])).rejects.toThrow("Ollama embed failed: 500");
  });

  // ── test:7 ──────────────────────────────────────────────────────────────────

  it("embedOne returns the first embedding from a single-item batch", async () => {
    const expected = [0.1, 0.2, 0.3];
    vi.mocked(fetch).mockResolvedValue(mockOllamaResponse([expected]));

    const result = await embedOne("test");
    expect(result).toEqual(expected);
  });

  // ── test:8 ──────────────────────────────────────────────────────────────────

  /*
   * The default stack embeds through Ollama, which `docker compose up` does not
   * start. A first-run developer therefore hits a refused connection, and undici
   * reports it as a bare "fetch failed" — which reached the caller as an opaque
   * 500 and named neither the cause nor the fix.
   */
  it("reports an unreachable embedding backend instead of a bare fetch failure", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    vi.mocked(fetch).mockRejectedValue(refused);

    await expect(embedBatch(["a"])).rejects.toBeInstanceOf(EmbeddingProviderUnavailableError);
    await expect(embedBatch(["a"])).rejects.toThrow(/unreachable at .*\/api\/embed/);
    // Both remedies must be named — the message is the only diagnosis a
    // self-hoster gets.
    await expect(embedBatch(["a"])).rejects.toThrow(/ollama serve/);
    await expect(embedBatch(["a"])).rejects.toThrow(/NOMIC_API_KEY/);
  });

  // ── test:9 ──────────────────────────────────────────────────────────────────

  it("does not disguise a genuine HTTP error as an unreachable backend", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("model not found"),
      json: () => Promise.resolve({}),
    } as unknown as Response);

    await expect(embedBatch(["a"])).rejects.not.toBeInstanceOf(EmbeddingProviderUnavailableError);
    await expect(embedBatch(["a"])).rejects.toThrow(/Ollama embed failed: 500/);
  });
});

// ─── Status probe ─────────────────────────────────────────────────────────────

/*
 * /status previously reported "All systems operational" while /v1/context was
 * failing, because it probed Postgres, Redis, and the queue but not the
 * embedder. A status page that stays green through an outage is worse than none.
 */
describe("probeEmbeddingProvider — /status must not report green while embedding is down", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports not-ok when Ollama refuses the connection", async () => {
    vi.mocked(fetch).mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
      })
    );

    const probe = await probeEmbeddingProvider();

    expect(probe.ok).toBe(false);
    expect(probe.provider).toBe("ollama");
    // The address is the actionable part — it is what exposes a container
    // having inherited localhost:11434 from a host .env.
    expect(probe.detail).toMatch(/unreachable at http/);
  });

  it("reports not-ok when Ollama answers with an HTTP error", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as unknown as Response);

    const probe = await probeEmbeddingProvider();

    expect(probe.ok).toBe(false);
    expect(probe.detail).toMatch(/500/);
  });

  it("reports ok when Ollama answers", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as unknown as Response);

    const probe = await probeEmbeddingProvider();

    expect(probe.ok).toBe(true);
    expect(probe.provider).toBe("ollama");
  });

  it("does not spend quota probing a cloud provider on every status check", async () => {
    vi.stubEnv("EMBEDDING_LOCATION", "cloud");
    vi.stubEnv("NOMIC_API_KEY", "test-key");

    const probe = await probeEmbeddingProvider();

    if (probe.provider === "nomic") {
      expect(probe.ok).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
    }

    vi.unstubAllEnvs();
  });
});
