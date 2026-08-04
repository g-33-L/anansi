// anansi-memory — The memory layer for AI apps
// Two calls: ingest content, retrieve synthesized context.

export interface AnansiMemoryOptions {
  apiKey: string;
  baseUrl?: string;
}

// Moss/Supermemory-style metadata filter. Plain keys are equality matches;
// operator objects support $gte/$lte/$gt/$lt (numeric) and $contains (JSONB).
export interface MetadataFilter {
  metadata?: Record<
    string,
    unknown | { $gte?: number; $lte?: number; $gt?: number; $lt?: number; $contains?: unknown }
  >;
  $and?: MetadataFilter[];
  $or?: MetadataFilter[];
}

export interface IngestOptions {
  userId: string;
  content: string;
  sourceType?: "conversation" | "document" | "note" | "meeting" | "custom";
  sourceId?: string;
  sessionId?: string;
  agentId?: string;
  /** Time-to-live in seconds; omitted = never expires */
  ttl?: number;
  /** Bring-your-own vector — must match the API's embedding dimension (768) */
  embedding?: number[];
  /** Model that produced the custom embedding, stored for provenance */
  embeddingModel?: string;
  /** Extraction hint passed to the synthesis LLM, e.g. "conversation about Alex's role change" */
  entityContext?: string;
  metadata?: {
    title?: string;
    author?: string;
    timestamp?: string;
    [key: string]: unknown;
  };
}

export interface IngestResult {
  id: string;
  queued: boolean;
}

export interface RetrievalOptions {
  /** Hybrid weight: 1 = pure vector, 0 = pure keyword; omitted = RRF merge */
  alpha?: number;
  /** Cosine distance ceiling 0–1 (default 0.7); higher = more results */
  threshold?: number;
  filters?: MetadataFilter;
  /** Restrict relevant[] to chunks ingested with this sessionId */
  sessionId?: string;
  /**
   * Valid-time point-in-time query: return entities and temporal facts as they were
   * *true* at this instant ("YYYY-MM", "YYYY-MM-DD", or ISO 8601). Omitted = now.
   */
  asOf?: string;
  /**
   * Knowledge-time (bi-temporal) query: reconstruct the entity graph as we *knew* it
   * at this instant — edges recorded later are excluded and an edge's end is applied
   * only if we'd learned of it by then. Combine with asOf for a full bi-temporal
   * point query. ("YYYY-MM", "YYYY-MM-DD", or ISO 8601.)
   */
  asOfKnowledge?: string;
}

export interface ContextOptions extends RetrievalOptions {
  userId?: string;
  q?: string;
  /** "user" (default) or "workspace" for the team-wide profile */
  scope?: "user" | "workspace";
}

export interface RelevantChunk {
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface TemporalFact {
  fact: string;
  validFrom?: string | null;
  validUntil?: string | null;
  /** Whether the fact was valid at the query instant (asOf, or now) */
  current?: boolean;
}

export interface EntityRelationship {
  relationship: string;
  target: { id: string; type: string; name: string };
  validFrom: string;
  validUntil: string | null;
  current: boolean;
}

export interface Entity {
  id: string;
  type: string;
  name: string;
  relationships: EntityRelationship[];
  firstSeen: string;
  lastSeen: string;
}

export interface ContextResult {
  static: string[];
  dynamic: string[];
  temporal: TemporalFact[];
  relevant: RelevantChunk[];
  entities: Entity[];
}

export interface SearchOptions extends RetrievalOptions {
  userId: string;
  query: string;
  searchMode?: "semantic" | "hybrid" | "keyword";
  /** Default 10, max 50 */
  limit?: number;
  /** Scope search to a single ingested document */
  sourceId?: string;
}

export interface SearchResult {
  content: string;
  score: number;
  sourceId: string;
  metadata: Record<string, unknown>;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export interface ListMemoriesOptions {
  userId: string;
  sourceType?: string;
  limit?: number;
  offset?: number;
  /** Rank results by hybrid search instead of recency */
  q?: string;
}

export interface Memory {
  id: string;
  content: string;
  sourceType: string;
  sourceId: string;
  metadata: Record<string, unknown>;
  similarity: number | null;
  synthesized: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface ListMemoriesResponse {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

export class AnansiMemory {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: AnansiMemoryOptions) {
    if (!options.apiKey) throw new Error("AnansiMemory: apiKey is required");
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://anansimemory.com").replace(/\/$/, "");
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      let message = `Anansi API error ${res.status}`;
      try {
        const err = (await res.json()) as { error?: string };
        if (err.error) message = err.error;
      } catch {}
      throw new AnansiError(message, res.status);
    }

    return res.json() as Promise<T>;
  }

  async ingest(options: IngestOptions): Promise<IngestResult> {
    return this.request<IngestResult>("POST", "/v1/ingest", {
      userId: options.userId,
      content: options.content,
      sourceType: options.sourceType,
      sourceId: options.sourceId,
      sessionId: options.sessionId,
      agentId: options.agentId,
      ttl: options.ttl,
      embedding: options.embedding,
      embeddingModel: options.embeddingModel,
      entityContext: options.entityContext,
      metadata: options.metadata,
    });
  }

  async context(options: ContextOptions): Promise<ContextResult> {
    const params = new URLSearchParams();
    if (options.userId) params.set("userId", options.userId);
    if (options.q) params.set("q", options.q);
    if (options.scope) params.set("scope", options.scope);
    if (options.alpha !== undefined) params.set("alpha", String(options.alpha));
    if (options.threshold !== undefined) params.set("threshold", String(options.threshold));
    if (options.filters !== undefined) params.set("filters", JSON.stringify(options.filters));
    if (options.sessionId) params.set("sessionId", options.sessionId);
    if (options.asOf) params.set("asOf", options.asOf);
    if (options.asOfKnowledge) params.set("asOfKnowledge", options.asOfKnowledge);
    return this.request<ContextResult>("GET", `/v1/context?${params}`);
  }

  /** Raw hybrid search without synthesis — returns scored chunks, not a profile. */
  async search(options: SearchOptions): Promise<SearchResponse> {
    return this.request<SearchResponse>("POST", "/v1/search", {
      userId: options.userId,
      query: options.query,
      searchMode: options.searchMode,
      threshold: options.threshold,
      alpha: options.alpha,
      limit: options.limit,
      filters: options.filters,
      sourceId: options.sourceId,
      sessionId: options.sessionId,
    });
  }

  /** List raw memory chunks with pagination; pass q for ranked listing. */
  async listMemories(options: ListMemoriesOptions): Promise<ListMemoriesResponse> {
    const params = new URLSearchParams({ userId: options.userId });
    if (options.sourceType) params.set("sourceType", options.sourceType);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    if (options.q) params.set("q", options.q);
    return this.request<ListMemoriesResponse>("GET", `/v1/memories?${params}`);
  }

  /**
   * All extracted entities and their (temporal) relationships for a user.
   * - asOf: graph snapshot as it was *valid* at that instant
   * - asOfKnowledge: graph as we *knew* it at that instant (bi-temporal)
   * Both accept "YYYY-MM", "YYYY-MM-DD", or ISO 8601; omitted = full current history.
   */
  async listEntities(options: { userId: string; asOf?: string; asOfKnowledge?: string }): Promise<{ entities: Entity[] }> {
    const params = new URLSearchParams({ userId: options.userId });
    if (options.asOf) params.set("asOf", options.asOf);
    if (options.asOfKnowledge) params.set("asOfKnowledge", options.asOfKnowledge);
    return this.request<{ entities: Entity[] }>("GET", `/v1/entities?${params}`);
  }

  /**
   * GDPR hard-delete: removes the user's memory profile and all associated data
   * (chunks, synthesized facts, entity graph). The developer's own records remain.
   * This operation is irreversible and idempotent — a second call returns `{ deleted: true }`.
   */
  async deleteUser(userId: string): Promise<{ deleted: boolean }> {
    const params = new URLSearchParams({ userId });
    return this.request<{ deleted: boolean }>("DELETE", `/v1/user?${params}`);
  }

  formatForPrompt(ctx: ContextResult): string {
    const lines: string[] = [];

    if (ctx.static.length > 0) {
      lines.push("## User — Stable facts");
      ctx.static.forEach((f) => lines.push(`- ${f}`));
    }

    if (ctx.dynamic.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("## User — Current context");
      ctx.dynamic.forEach((d) => lines.push(`- ${d}`));
    }

    if (ctx.relevant.length > 0) {
      if (lines.length > 0) lines.push("");
      lines.push("## Relevant history");
      ctx.relevant.forEach((r) => lines.push(`- ${r.content}`));
    }

    return lines.join("\n");
  }
}

export class AnansiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "AnansiError";
    this.statusCode = statusCode;
  }
}

export default AnansiMemory;
