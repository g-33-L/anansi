// anansi-langchain — LangChain integration for Anansi memory.
//
// Exports:
//   AnansiRetriever   — BaseRetriever backed by POST /v1/search
//   AnansiMemoryTool  — agent tool that saves facts (remember)
//   AnansiContextTool — agent tool that recalls context (recall)
//
// LangGraph helpers live in the "anansi-langchain/langgraph" subpath.

import { BaseRetriever, type BaseRetrieverInput } from "@langchain/core/retrievers";
import { Document } from "@langchain/core/documents";
import { Tool } from "@langchain/core/tools";
import {
  anansiRequest,
  formatContext,
  type AnansiConfig,
  type AnansiContextResponse,
  type AnansiSearchHit,
} from "./client.js";

export type { AnansiConfig } from "./client.js";

// ─── AnansiRetriever ──────────────────────────────────────────────────────────

export interface AnansiRetrieverInput extends BaseRetrieverInput, AnansiConfig {
  userId: string;
  /** Max results per query (default 10) */
  limit?: number;
  searchMode?: "semantic" | "hybrid" | "keyword";
  /** Hybrid weight: 1 = pure vector, 0 = pure keyword; omitted = RRF merge */
  alpha?: number;
  /** Cosine distance ceiling 0–1 (default 0.7) */
  threshold?: number;
  filters?: Record<string, unknown>;
}

export class AnansiRetriever extends BaseRetriever {
  static lc_name() {
    return "AnansiRetriever";
  }

  lc_namespace = ["anansi", "retrievers"];

  private readonly config: AnansiConfig;
  private readonly userId: string;
  private readonly limit: number;
  private readonly searchMode?: "semantic" | "hybrid" | "keyword";
  private readonly alpha?: number;
  private readonly threshold?: number;
  private readonly filters?: Record<string, unknown>;

  constructor(fields: AnansiRetrieverInput) {
    super(fields);
    if (!fields.apiKey) throw new Error("AnansiRetriever: apiKey is required");
    if (!fields.userId) throw new Error("AnansiRetriever: userId is required");
    this.config = { apiKey: fields.apiKey, baseUrl: fields.baseUrl };
    this.userId = fields.userId;
    this.limit = fields.limit ?? 10;
    this.searchMode = fields.searchMode;
    this.alpha = fields.alpha;
    this.threshold = fields.threshold;
    this.filters = fields.filters;
  }

  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const { results } = await anansiRequest<{ results: AnansiSearchHit[] }>(
      this.config,
      "POST",
      "/v1/search",
      {
        userId: this.userId,
        query,
        limit: this.limit,
        searchMode: this.searchMode,
        alpha: this.alpha,
        threshold: this.threshold,
        filters: this.filters,
      }
    );
    return results.map(
      (r) =>
        new Document({
          pageContent: r.content,
          metadata: { ...r.metadata, score: r.score, sourceId: r.sourceId },
        })
    );
  }
}

// ─── Agent tools ──────────────────────────────────────────────────────────────

export interface AnansiToolInput extends AnansiConfig {
  userId: string;
  /** Tag ingested memories with a session for session-scoped retrieval */
  sessionId?: string;
}

/** Saves a fact to the user's long-term memory ("remember"). */
export class AnansiMemoryTool extends Tool {
  static lc_name() {
    return "AnansiMemoryTool";
  }

  name = "remember";
  description =
    "Save an important fact, preference, or event about the user to long-term memory. " +
    "Input should be the fact phrased as a standalone statement.";

  private readonly config: AnansiConfig;
  private readonly userId: string;
  private readonly sessionId?: string;

  constructor(fields: AnansiToolInput) {
    super();
    if (!fields.apiKey) throw new Error("AnansiMemoryTool: apiKey is required");
    if (!fields.userId) throw new Error("AnansiMemoryTool: userId is required");
    this.config = { apiKey: fields.apiKey, baseUrl: fields.baseUrl };
    this.userId = fields.userId;
    this.sessionId = fields.sessionId;
  }

  async _call(input: string): Promise<string> {
    if (!input.trim()) return "Nothing to remember — input was empty.";
    await anansiRequest(this.config, "POST", "/v1/ingest", {
      userId: this.userId,
      content: input,
      sourceType: "conversation",
      ...(this.sessionId ? { sessionId: this.sessionId } : {}),
    });
    return "Saved to memory.";
  }
}

/** Recalls synthesized context from the user's long-term memory ("recall"). */
export class AnansiContextTool extends Tool {
  static lc_name() {
    return "AnansiContextTool";
  }

  name = "recall";
  description =
    "Search the user's long-term memory for facts, preferences, and past context relevant to a query. " +
    "Input should be the question to look up.";

  private readonly config: AnansiConfig;
  private readonly userId: string;

  constructor(fields: AnansiToolInput) {
    super();
    if (!fields.apiKey) throw new Error("AnansiContextTool: apiKey is required");
    if (!fields.userId) throw new Error("AnansiContextTool: userId is required");
    this.config = { apiKey: fields.apiKey, baseUrl: fields.baseUrl };
    this.userId = fields.userId;
  }

  async _call(input: string): Promise<string> {
    const params = new URLSearchParams({ userId: this.userId });
    if (input.trim()) params.set("q", input);
    const ctx = await anansiRequest<AnansiContextResponse>(
      this.config,
      "GET",
      `/v1/context?${params}`
    );
    return formatContext(ctx) || "No memories found for that query.";
  }
}
