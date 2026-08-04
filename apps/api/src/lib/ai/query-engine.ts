import { sql, eq, inArray, and, isNull, desc, type SQL } from "drizzle-orm";
import type { QueryResult } from "pg";
import { db } from "../db/index.js";
import { staticDocuments, memoryUsers, channels, entityNodes, entityEdges, type TemporalFact } from "../db/schema.js";
import { embedOne } from "./embed.js";
import { chat, chatSynthesis } from "./llm.js";
import { getCachedWorkspaceProfile, setCachedWorkspaceProfile } from "../infra/cache.js";
import { neutralizePromptDelimiters } from "../utils/sanitize.js";

const VECTOR_SEARCH_TOP_K = 8;
const VECTOR_CANDIDATES = 20; // retrieve more candidates before RRF merge
const BM25_CANDIDATES = 20;
const RRF_K = 60; // standard RRF constant — balances rank contributions
const EXCERPT_MAX_CHARS = 200;
// Cosine distance threshold — chunks with distance >= this are too dissimilar to be useful.
// pgvector <=> returns 0 (identical) to 2 (opposite); for positive embeddings, range is 0-1.
const SIMILARITY_DISTANCE_THRESHOLD = 0.7;

// ─── Metadata filters (Moss/Supermemory-style) ────────────────────────────────
// Compiled to parameterized JSONB conditions via drizzle sql`` — values never
// interpolated into the SQL string.

export interface MetadataFilter {
  metadata?: Record<string, unknown>;
  $and?: MetadataFilter[];
  $or?: MetadataFilter[];
}

export class FilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FilterError";
  }
}

const FILTER_MAX_DEPTH = 5;
const FILTER_MAX_CONDITIONS = 50;
const NUMERIC_OPS: Record<string, string> = { $gte: ">=", $lte: "<=", $gt: ">", $lt: "<" };

// JSONB values are untyped: a caller can store metadata.x as 5 on one chunk and
// "n/a" on another. Casting a non-numeric text to ::float aborts the ENTIRE query
// with "invalid input syntax for type double precision" (500), because Postgres
// evaluates the cast per scanned row. Guard every numeric/boolean cast behind a
// CASE that only casts when the text is actually numeric/boolean; rows that don't
// match are excluded (FALSE) instead of crashing the search. See BUG_AUDIT M1.
const NUMERIC_TEXT_RE = "^-?[0-9]+(\\.[0-9]+)?$";

function numericCompare(key: string, sqlOp: string, operand: number): SQL {
  return sql`(CASE WHEN metadata->>${key} ~ ${NUMERIC_TEXT_RE} THEN (metadata->>${key})::float ${sql.raw(sqlOp)} ${operand} ELSE false END)`;
}

function buildMetadataCondition(key: string, value: unknown): SQL {
  // Operator object: { $gte: 5, $contains: "x", ... }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const parts: SQL[] = [];
    for (const [op, operand] of Object.entries(value as Record<string, unknown>)) {
      if (NUMERIC_OPS[op]) {
        if (typeof operand !== "number" || !Number.isFinite(operand)) {
          throw new FilterError(`${op} requires a finite number for key "${key}"`);
        }
        parts.push(numericCompare(key, NUMERIC_OPS[op], operand));
      } else if (op === "$contains") {
        parts.push(sql`metadata->${key} @> ${JSON.stringify(operand)}::jsonb`);
      } else {
        throw new FilterError(`Unsupported filter operator "${op}"`);
      }
    }
    if (parts.length === 0) throw new FilterError(`Empty operator object for key "${key}"`);
    return sql`(${sql.join(parts, sql` AND `)})`;
  }

  if (value === null) return sql`metadata->>${key} IS NULL`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FilterError(`Non-finite number for key "${key}"`);
    return numericCompare(key, "=", value);
  }
  if (typeof value === "boolean") {
    return sql`(CASE WHEN metadata->>${key} IN ('true','false') THEN (metadata->>${key})::boolean = ${value} ELSE false END)`;
  }
  if (typeof value === "string") return sql`metadata->>${key} = ${value}`;
  throw new FilterError(`Unsupported filter value type for key "${key}"`);
}

export function buildFilterSQL(
  filter: MetadataFilter,
  depth = 0,
  counter: { n: number } = { n: 0 }
): SQL {
  if (depth > FILTER_MAX_DEPTH) throw new FilterError(`Filters nested deeper than ${FILTER_MAX_DEPTH} levels`);
  if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
    throw new FilterError("Filter must be an object");
  }

  const parts: SQL[] = [];

  if (filter.metadata !== undefined) {
    if (typeof filter.metadata !== "object" || filter.metadata === null || Array.isArray(filter.metadata)) {
      throw new FilterError("filter.metadata must be an object");
    }
    for (const [key, value] of Object.entries(filter.metadata)) {
      if ((counter.n += 1) > FILTER_MAX_CONDITIONS) throw new FilterError(`Filters exceed ${FILTER_MAX_CONDITIONS} conditions`);
      parts.push(buildMetadataCondition(key, value));
    }
  }

  for (const [op, combine] of [["$and", " AND "], ["$or", " OR "]] as const) {
    const sub = filter[op];
    if (sub === undefined) continue;
    if (!Array.isArray(sub) || sub.length === 0) throw new FilterError(`${op} must be a non-empty array`);
    parts.push(sql`(${sql.join(sub.map((f) => buildFilterSQL(f, depth + 1, counter)), sql.raw(combine))})`);
  }

  if (parts.length === 0) return sql`TRUE`;
  return sql`(${sql.join(parts, sql` AND `)})`;
}

// Reciprocal Rank Fusion — merges multiple ranked lists into one.
// score(chunk) = Σ 1/(RRF_K + rank_i) for each list the chunk appears in.
function reciprocalRankFusion<T extends { id: string }>(rankedLists: T[][]): T[] {
  const scores = new Map<string, number>();
  const items = new Map<string, T>();

  for (const list of rankedLists) {
    list.forEach((row, rank) => {
      scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1));
      if (!items.has(row.id)) items.set(row.id, row);
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => items.get(id)!);
}

// ─── Core hybrid search ───────────────────────────────────────────────────────
// One search path shared by GET /v1/context (relevant[]), POST /v1/search, and
// GET /v1/memories?q=. Supports semantic / keyword / hybrid modes, tunable
// alpha-weighted merging, per-request thresholds, metadata filters, and
// document / session scoping.

export interface RetrievalOptions {
  alpha?: number; // 0 = pure BM25, 1 = pure vector; omitted = RRF merge (default)
  threshold?: number; // cosine distance ceiling, default 0.7
  filters?: MetadataFilter;
  sessionId?: string;
  // Point-in-time (valid-time) query: return the profile/graph as it was valid at
  // this instant. Filters entity edges and temporal facts to those active at asOf,
  // and computes `current` relative to it. Omitted = now (full current state).
  asOf?: Date;
  // Transaction-time (knowledge-time) query: reconstruct what we KNEW about the
  // entity graph as of this instant — edges recorded after it are excluded, and an
  // edge's end is only applied if we had learned of it by then. Combine with asOf
  // for a full bi-temporal point query. Omitted = latest knowledge.
  asOfKnowledge?: Date;
}

export interface SearchOptions extends RetrievalOptions {
  workspaceId: string;
  memoryUserId?: string;
  query: string;
  searchMode?: "semantic" | "hybrid" | "keyword";
  limit?: number;
  sourceId?: string; // scope search to one ingested document
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  similarity: number; // cosine similarity; 0 for BM25-only hits
  sourceId: string;
  sourceType: string;
  metadata: Record<string, unknown>;
  synthesized: boolean;
  expiresAt: string | null;
  createdAt: string;
}

interface SearchRow {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  source_id: string;
  source_type: string;
  synthesized: boolean;
  expires_at: string | null;
  created_at: string;
  similarity: number;
  rank: number;
}

function buildSearchConditions(opts: SearchOptions): SQL {
  const conditions: SQL[] = [
    sql`workspace_id = ${opts.workspaceId}`,
    sql`(expires_at IS NULL OR expires_at > now())`,
  ];
  if (opts.memoryUserId) conditions.push(sql`memory_user_id = ${opts.memoryUserId}`);
  if (opts.sessionId) conditions.push(sql`metadata->>'sessionId' = ${opts.sessionId}`);
  if (opts.sourceId) {
    // Multi-chunk ingests store chunks as "<sourceId>:<idx>" — match both forms.
    // Escape LIKE wildcards (_ and %) in the sourceId so a literal underscore in
    // the id doesn't act as a single-character wildcard in the LIKE pattern.
    const escapedSourceId = opts.sourceId.replace(/%/g, "\\%").replace(/_/g, "\\_");
    conditions.push(sql`(source_id = ${opts.sourceId} OR source_id LIKE ${escapedSourceId + ":%"} ESCAPE '\\')`);
  }
  if (opts.filters) conditions.push(buildFilterSQL(opts.filters));
  return sql.join(conditions, sql` AND `);
}

function toSearchResult(row: SearchRow, score: number): SearchResult {
  return {
    id: row.id,
    content: row.content,
    score,
    similarity: row.similarity ?? 0,
    sourceId: row.source_id,
    sourceType:
      typeof row.metadata?.sourceType === "string" ? (row.metadata.sourceType as string) : row.source_type,
    metadata: row.metadata ?? {},
    synthesized: row.synthesized,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

export async function searchChunks(opts: SearchOptions): Promise<SearchResult[]> {
  const limit = opts.limit ?? VECTOR_SEARCH_TOP_K;
  const threshold = opts.threshold ?? SIMILARITY_DISTANCE_THRESHOLD;
  const mode = opts.searchMode ?? "hybrid";
  const candidates = Math.max(limit, VECTOR_CANDIDATES);
  const where = buildSearchConditions(opts);

  // alpha collapses hybrid to a single list at the extremes
  const useVector = mode !== "keyword" && opts.alpha !== 0;
  const useBm25 = mode !== "semantic" && opts.alpha !== 1;

  const emptyResult = { rows: [] as SearchRow[] };

  const vectorPromise = (async () => {
    if (!useVector) return emptyResult;
    const queryEmbedding = await embedOne(opts.query);
    if (!queryEmbedding.every((v) => Number.isFinite(v))) {
      throw new Error("embedOne returned non-finite values — cannot construct vector literal");
    }
    const embeddingLiteral = `[${queryEmbedding.join(",")}]`;
    return db.execute(sql`
      SELECT id, content, metadata, source_id, source_type, synthesized, expires_at, created_at,
             1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity,
             0.0::float AS rank
      FROM memory_chunks
      WHERE ${where}
        AND embedding IS NOT NULL
        AND embedding <=> ${embeddingLiteral}::vector < ${threshold}
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT ${candidates}
    `) as unknown as Promise<QueryResult<SearchRow>>;
  })();

  const bm25Promise = (async () => {
    if (!useBm25) return emptyResult;
    return (db.execute(sql`
      SELECT id, content, metadata, source_id, source_type, synthesized, expires_at, created_at,
             0.0::float AS similarity,
             ts_rank(content_tsv, plainto_tsquery('english', ${opts.query}))::float AS rank
      FROM memory_chunks
      WHERE ${where}
        AND content_tsv @@ plainto_tsquery('english', ${opts.query})
      ORDER BY ts_rank(content_tsv, plainto_tsquery('english', ${opts.query})) DESC
      LIMIT ${candidates}
    `) as unknown as Promise<QueryResult<SearchRow>>).catch((err) => {
      if ((err as Error).message?.includes("content_tsv")) {
        console.warn("[query] content_tsv column not found — run migration 0009 to enable hybrid search");
      }
      return emptyResult;
    });
  })();

  const [vectorRes, bm25Res] = await Promise.all([vectorPromise, bm25Promise]);

  // Normalize BM25 ts_rank to 0–1 within the result set
  const maxRank = bm25Res.rows.reduce((m, r) => Math.max(m, r.rank), 0);
  const bm25Score = (row: SearchRow) => (maxRank > 0 ? row.rank / maxRank : 0);

  // Single-list modes: score directly
  if (!useBm25) {
    return vectorRes.rows.slice(0, limit).map((r) => toSearchResult(r, r.similarity));
  }
  if (!useVector) {
    return bm25Res.rows.slice(0, limit).map((r) => toSearchResult(r, bm25Score(r)));
  }

  if (opts.alpha === undefined) {
    // Default hybrid: RRF merge (existing behavior)
    const scores = new Map<string, number>();
    const items = new Map<string, SearchRow>();
    for (const list of [vectorRes.rows, bm25Res.rows]) {
      list.forEach((row, rank) => {
        scores.set(row.id, (scores.get(row.id) ?? 0) + 1 / (RRF_K + rank + 1));
        if (!items.has(row.id)) items.set(row.id, row);
        else if (row.similarity > 0) items.set(row.id, row); // prefer the row carrying cosine similarity
      });
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => toSearchResult(items.get(id)!, score));
  }

  // Weighted hybrid: finalScore = alpha * vectorScore + (1 - alpha) * bm25Score
  const alpha = opts.alpha;
  const merged = new Map<string, { row: SearchRow; vector: number; bm25: number }>();
  for (const row of vectorRes.rows) {
    merged.set(row.id, { row, vector: row.similarity, bm25: 0 });
  }
  for (const row of bm25Res.rows) {
    const existing = merged.get(row.id);
    if (existing) existing.bm25 = bm25Score(row);
    else merged.set(row.id, { row, vector: 0, bm25: bm25Score(row) });
  }
  return [...merged.values()]
    .map((e) => ({ ...e, score: alpha * e.vector + (1 - alpha) * e.bm25 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => toSearchResult(e.vector > 0 ? { ...e.row, similarity: e.vector } : e.row, e.score));
}

export interface QueryResponse {
  answer: string;
  sources: Array<{
    channel: string;
    author: string;
    timestamp: string | null;
    excerpt: string;
  }>;
  citedSf: number[]; // 0-based indices into static_facts
  citedDc: number[]; // 0-based indices into dynamic_context
}

interface ChunkRow {
  id: string;
  content: string;
  metadata: {
    author: string;
    authorId: string;
    timestamp: string;
    channelName: string;
    threadTs?: string;
  } | null;
}

export async function queryWorkspace(
  workspaceId: string,
  question: string
): Promise<QueryResponse> {
  const queryEmbedding = await embedOne(question);

  if (!queryEmbedding.every((v) => Number.isFinite(v))) {
    throw new Error("embedOne returned non-finite values — cannot construct vector literal");
  }

  // Drizzle sql`` parameterizes ${embeddingLiteral} as $N; ::vector cast is applied server-side
  const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

  // Run vector search and BM25 in parallel, then merge with RRF.
  // BM25 is a soft dependency — if content_tsv column doesn't exist yet (pre-migration 0009),
  // fall back gracefully to vector-only results.
  const vectorPromise = db.execute(sql`
    SELECT id, content, metadata
    FROM memory_chunks
    WHERE workspace_id = ${workspaceId}
      AND embedding IS NOT NULL
      AND (expires_at IS NULL OR expires_at > now())
      AND embedding <=> ${embeddingLiteral}::vector < ${SIMILARITY_DISTANCE_THRESHOLD}
    ORDER BY embedding <=> ${embeddingLiteral}::vector
    LIMIT ${VECTOR_CANDIDATES}
  `) as unknown as Promise<QueryResult<ChunkRow>>;

  const bm25Promise = (db.execute(sql`
    SELECT id, content, metadata
    FROM memory_chunks
    WHERE workspace_id = ${workspaceId}
      AND (expires_at IS NULL OR expires_at > now())
      AND content_tsv @@ plainto_tsquery('english', ${question})
    ORDER BY ts_rank(content_tsv, plainto_tsquery('english', ${question})) DESC
    LIMIT ${BM25_CANDIDATES}
  `) as unknown as Promise<QueryResult<ChunkRow>>).catch((err) => {
    if ((err as Error).message?.includes("content_tsv")) {
      console.warn("[query] content_tsv column not found — run migration 0009 to enable hybrid search");
    }
    return { rows: [] as ChunkRow[] };
  });

  const [vectorResult, bm25Result] = await Promise.all([vectorPromise, bm25Promise]);
  const merged = reciprocalRankFusion([vectorResult.rows, bm25Result.rows]);
  const chunks = merged.slice(0, VECTOR_SEARCH_TOP_K);

  if (chunks.length === 0) {
    console.warn(`[query] No chunks found for workspace ${workspaceId} (question length: ${question.length})`);
    return {
      answer: "I don't have enough context to answer that yet.",
      sources: [],
      citedSf: [],
      citedDc: [],
    };
  }

  // Static document may be null before first synthesis run
  const staticDoc = await db.query.staticDocuments.findFirst({
    where: eq(staticDocuments.workspaceId, workspaceId),
  });

  const blocks: string[] = [];

  // Trust boundary: profile facts, chunk content/metadata, and the question are
  // all end-user derived. Neutralize forged `--- BEGIN/END … ---` fences and
  // `CITED:` control lines before interpolation so untrusted text can't escape
  // its prompt block or spoof the citation parser below.
  // Number each fact/context item so the LLM can cite them (SF1, DC1, …)
  if (staticDoc?.staticFacts?.length) {
    blocks.push(
      `Static facts:\n${staticDoc.staticFacts.map((f, i) => `[SF${i + 1}] ${neutralizePromptDelimiters(f)}`).join("\n")}`
    );
  }
  if (staticDoc?.dynamicContext?.length) {
    blocks.push(
      `Current context:\n${staticDoc.dynamicContext.map((d, i) => `[DC${i + 1}] ${neutralizePromptDelimiters(d)}`).join("\n")}`
    );
  }

  const chunksBlock = neutralizePromptDelimiters(
    chunks
      .map((c) => {
        const m = c.metadata;
        return `[#${m?.channelName ?? "?"}][${m?.author ?? "?"}][${m?.timestamp ?? "?"}]\n${c.content}`;
      })
      .join("\n---\n")
  );

  blocks.push(`Relevant messages:\n${chunksBlock}`);
  // Explicit delimiter so the LLM has a clear trust boundary for the user's question
  blocks.push(`--- BEGIN QUESTION (untrusted user input) ---\n${neutralizePromptDelimiters(question)}\n--- END QUESTION ---`);

  const rawAnswer = await chat([
    {
      role: "system",
      content: `You are the internal knowledge assistant for this workspace. Answer questions by synthesizing information from company memory.

RESPONSE RULES:
1. Answer the question directly and concisely first.
2. Synthesize across sources — never quote raw message fragments verbatim.
3. Use headings and bullet points when listing multiple items or categories.
4. Never show Slack user IDs (e.g. U0B7EEXGPRV) — use real names only.
5. Never expose channel IDs, timestamps, or retrieval metadata in your answer.
6. If multiple sources agree on a fact, state it once as a single confident statement.
7. End with a brief confidence note, e.g. "Based on 4 engineering discussions."
8. If context is insufficient, say so clearly rather than guessing.

After your answer, on a new line write exactly: CITED: SF1 DC2 (space-separated IDs from the numbered facts/context you drew from; omit the line entirely if you used none from those sections).`,
    },
    { role: "user", content: blocks.join("\n\n") },
  ]);

  // Strip the CITED: line and parse cited indices (convert to 0-based)
  const citedMatch = rawAnswer.match(/\nCITED:\s*([^\n]*)/);
  const answer = rawAnswer.replace(/\nCITED:[^\n]*/g, "").trim();
  const citedIds = citedMatch ? citedMatch[1].trim().split(/\s+/).filter(Boolean) : [];
  const citedSf = citedIds
    .filter((id) => /^SF\d+$/i.test(id))
    .map((id) => parseInt(id.slice(2), 10) - 1);
  const citedDc = citedIds
    .filter((id) => /^DC\d+$/i.test(id))
    .map((id) => parseInt(id.slice(2), 10) - 1);

  // Resolve Slack channel IDs (C0B...) to human-readable names from the channels table
  const rawChannelIds = [...new Set(chunks.map((c) => c.metadata?.channelName).filter(Boolean))] as string[];
  const channelRows = rawChannelIds.length
    ? await db.query.channels.findMany({
        // Scope by workspace — never resolve names across tenants. (Safe even though
        // Slack channel IDs are globally unique; upholds the isolation invariant.)
        where: and(eq(channels.workspaceId, workspaceId), inArray(channels.slackChannelId, rawChannelIds)),
        columns: { slackChannelId: true, name: true },
      })
    : [];
  const channelNameMap = new Map(channelRows.map((r) => [r.slackChannelId, r.name]));

  const sources = chunks.map((c) => {
    const rawChannel = c.metadata?.channelName ?? "unknown";
    return {
      channel: channelNameMap.get(rawChannel) ?? rawChannel,
      author: c.metadata?.author ?? "unknown",
      timestamp: c.metadata?.timestamp ?? null,
      excerpt: c.content.slice(0, EXCERPT_MAX_CHARS),
    };
  });

  return { answer, sources, citedSf, citedDc };
}

export interface EntityRelationship {
  relationship: string;
  target: { id: string; type: string; name: string };
  validFrom: string;
  validUntil: string | null;
  current: boolean; // active at the query instant (asOf, or now)
}

export interface EntitySummary {
  id: string;
  type: string;
  name: string;
  relationships: EntityRelationship[];
  firstSeen: string;
  lastSeen: string;
}

// A temporal fact annotated with whether it was valid at the query instant.
export interface TemporalFactView extends TemporalFact {
  current: boolean;
}

export interface UserContextResponse {
  static: string[];
  dynamic: string[];
  temporal: TemporalFactView[];
  relevant: Array<{ content: string; similarity: number; metadata: object }>;
  entities: EntitySummary[];
}

export interface EntityQueryOptions {
  // Point-in-time snapshot: only relationships valid at this instant are returned,
  // each with current=true. Omitted = full history (active + closed edges).
  asOf?: Date;
  // Knowledge-time: reconstruct the graph as we knew it at this instant. Edges
  // recorded later are excluded; an edge's end is applied only if we'd learned of
  // it by then. Combine with asOf for a bi-temporal point query.
  asOfKnowledge?: Date;
}

// Parse a temporal-fact boundary ("YYYY-MM", "YYYY-MM-DD", or ISO) to epoch ms.
// Unparseable boundaries are treated as open (null) so a malformed date never
// silently hides a fact.
function boundaryMs(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// A temporal fact is valid at `at` when validFrom <= at < validUntil (open bounds
// when null). Used for both asOf filtering and computing `current`.
function temporalFactActiveAt(fact: TemporalFact, at: Date): boolean {
  const from = boundaryMs(fact.validFrom);
  const until = boundaryMs(fact.validUntil);
  const t = at.getTime();
  if (from !== null && from > t) return false;
  if (until !== null && until <= t) return false;
  return true;
}

// Safety bounds on graph reads. History is unbounded by design (closed edges are
// preserved forever), but a single read/response must not be — a long-lived user
// would otherwise force an ever-growing query and payload. The most recently seen
// nodes and most recently recorded edges are returned; older history beyond these
// caps is omitted. See BUG_AUDIT M5.
const MAX_ENTITY_NODES = 500;
const MAX_ENTITY_EDGES = 5000;

// All entities for a memory user with their relationships.
// Without asOf: full history (active + closed edges), current = active now.
// With asOf: snapshot of edges valid at that instant, current relative to it.
// Used by GET /v1/entities and embedded in the GET /v1/context response.
export async function getEntitiesForUser(
  memoryUserId: string,
  opts: EntityQueryOptions = {}
): Promise<EntitySummary[]> {
  const nodes = await db
    .select()
    .from(entityNodes)
    .where(eq(entityNodes.memoryUserId, memoryUserId))
    .orderBy(desc(entityNodes.lastSeenAt))
    .limit(MAX_ENTITY_NODES);

  if (nodes.length === 0) return [];

  const nodeIds = nodes.map((n) => n.id);

  // Read edges for the user's nodes (bounded), then project them through the
  // bi-temporal filter in JS. Drizzle reads these `timestamp` columns back as the
  // exact UTC instants they were written (verified), so getTime() comparisons are
  // tz-safe — unlike binding a raw Date into SQL, which node-pg serializes in local time.
  const allEdges = await db
    .select()
    .from(entityEdges)
    .where(inArray(entityEdges.fromEntityId, nodeIds))
    .orderBy(desc(entityEdges.recordedAt))
    .limit(MAX_ENTITY_EDGES);

  const V = opts.asOf?.getTime();          // valid-time instant
  const K = opts.asOfKnowledge?.getTime(); // knowledge-time instant

  type ProjectedEdge = (typeof allEdges)[number] & { effectiveUntil: Date | null; current: boolean };
  const projected: ProjectedEdge[] = [];

  for (const e of allEdges) {
    // Knowledge-time: skip edges we hadn't recorded yet, and treat an edge's end as
    // unknown unless we'd learned of it by K.
    let effectiveUntil = e.validUntil;
    if (K !== undefined) {
      if (e.recordedAt.getTime() > K) continue;
      effectiveUntil =
        e.validUntilRecordedAt && e.validUntilRecordedAt.getTime() <= K ? e.validUntil : null;
    }

    // Valid-time: keep only edges active at V (half-open [validFrom, effectiveUntil)).
    if (V !== undefined) {
      if (e.validFrom.getTime() > V) continue;
      if (effectiveUntil && effectiveUntil.getTime() <= V) continue;
    }

    // current: when querying a valid-time instant, every kept edge was active then;
    // otherwise it means no (effective) end is known.
    const current = V !== undefined ? true : effectiveUntil === null;
    projected.push({ ...e, effectiveUntil, current });
  }

  // Edge targets may belong to the same user set or be shared org/tech nodes
  const targetIds = [...new Set(projected.map((e) => e.toEntityId))];
  const missingTargetIds = targetIds.filter((id) => !nodeIds.includes(id));
  const targetNodes = missingTargetIds.length
    ? await db.select().from(entityNodes).where(inArray(entityNodes.id, missingTargetIds))
    : [];
  const nodeById = new Map([...nodes, ...targetNodes].map((n) => [n.id, n]));

  return nodes.map((node) => ({
    id: node.id,
    type: node.entityType,
    name: node.name,
    relationships: projected
      .filter((e) => e.fromEntityId === node.id)
      .map((e) => {
        const target = nodeById.get(e.toEntityId);
        return {
          relationship: e.relationship,
          target: {
            id: e.toEntityId,
            type: target?.entityType ?? "unknown",
            name: target?.name ?? "unknown",
          },
          validFrom: e.validFrom.toISOString(),
          // effectiveUntil reflects the knowledge-time view: an end we hadn't yet
          // learned of at asOfKnowledge reads as still-open (null).
          validUntil: e.effectiveUntil?.toISOString() ?? null,
          current: e.current,
        };
      }),
    firstSeen: node.firstSeenAt.toISOString(),
    lastSeen: node.lastSeenAt.toISOString(),
  }));
}

export async function queryUser(
  workspaceId: string,
  memoryUserId: string,
  question?: string,
  options: RetrievalOptions = {}
): Promise<UserContextResponse> {
  const [staticDoc, entities] = await Promise.all([
    db.query.staticDocuments.findFirst({
      where: eq(staticDocuments.memoryUserId, memoryUserId),
    }),
    getEntitiesForUser(memoryUserId, { asOf: options.asOf, asOfKnowledge: options.asOfKnowledge }),
  ]);

  let relevant: Array<{ content: string; similarity: number; metadata: object }> = [];

  if (question) {
    const results = await searchChunks({
      workspaceId,
      memoryUserId,
      query: question,
      limit: VECTOR_SEARCH_TOP_K,
      alpha: options.alpha,
      threshold: options.threshold,
      filters: options.filters,
      sessionId: options.sessionId,
    });
    relevant = results.map((r) => ({
      content: r.content,
      similarity: r.similarity,
      metadata: r.metadata,
    }));
  }

  // Temporal facts: annotate each with validity at the reference instant; when
  // asOf is set, return only the facts that were valid then (the snapshot).
  const refTime = options.asOf ?? new Date();
  let temporal: TemporalFactView[] = (staticDoc?.temporalFacts ?? []).map((f) => ({
    ...f,
    current: temporalFactActiveAt(f, refTime),
  }));
  if (options.asOf) temporal = temporal.filter((f) => temporalFactActiveAt(f, options.asOf!));

  return {
    static: staticDoc?.staticFacts ?? [],
    dynamic: staticDoc?.dynamicContext ?? [],
    temporal,
    relevant,
    entities,
  };
}

// ─── Workspace-level context (GET /v1/context?scope=workspace) ────────────────
// Synthesizes a team-wide profile across all memory_users for a developer.
// The synthesized profile is cached for 5 minutes (keyed on developerId);
// relevant[] is computed per request so it always reflects the query.

const MAX_WORKSPACE_PROFILE_DOCS = 100;
const MAX_STATIC_FACTS = 30;
const MAX_DYNAMIC_CONTEXT = 15;

export interface WorkspaceProfile {
  static: string[];
  dynamic: string[];
}

function parseProfileResponse(raw: string): WorkspaceProfile | null {
  const candidates = [
    raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim(),
    raw.match(/\{[\s\S]*\}/)?.[0] ?? "",
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as { static_facts?: unknown; dynamic_context?: unknown };
      if (
        Array.isArray(parsed.static_facts) &&
        Array.isArray(parsed.dynamic_context) &&
        parsed.static_facts.every((f) => typeof f === "string") &&
        parsed.dynamic_context.every((f) => typeof f === "string")
      ) {
        return { static: parsed.static_facts, dynamic: parsed.dynamic_context };
      }
    } catch {
      // Candidate isn't valid JSON — try the next extraction strategy; null is returned after the loop.
    }
  }
  return null;
}

// Deterministic fallback when the LLM merge fails: dedupe and cap.
function mergeProfiles(docs: Array<{ staticFacts: string[]; dynamicContext: string[] }>): WorkspaceProfile {
  const staticFacts = [...new Set(docs.flatMap((d) => d.staticFacts))];
  const dynamicContext = [...new Set(docs.flatMap((d) => d.dynamicContext))];
  return {
    static: staticFacts.slice(0, MAX_STATIC_FACTS),
    dynamic: dynamicContext.slice(0, MAX_DYNAMIC_CONTEXT),
  };
}

async function synthesizeWorkspaceProfile(
  developerId: string,
  workspaceId: string
): Promise<WorkspaceProfile> {
  const cached = await getCachedWorkspaceProfile(developerId);
  if (cached) return cached;

  // Per-user synthesized profiles for this developer (most recently updated first)
  const userDocs = await db
    .select({
      staticFacts: staticDocuments.staticFacts,
      dynamicContext: staticDocuments.dynamicContext,
    })
    .from(staticDocuments)
    .innerJoin(memoryUsers, eq(staticDocuments.memoryUserId, memoryUsers.id))
    .where(eq(memoryUsers.developerId, developerId))
    .orderBy(desc(staticDocuments.lastSynthesizedAt))
    .limit(MAX_WORKSPACE_PROFILE_DOCS);

  // Workspace-scoped profile (from Slack/connector synthesis), if one exists
  const workspaceDoc = await db.query.staticDocuments.findFirst({
    where: and(eq(staticDocuments.workspaceId, workspaceId), isNull(staticDocuments.memoryUserId)),
  });

  const docs = [
    ...(workspaceDoc ? [{ staticFacts: workspaceDoc.staticFacts, dynamicContext: workspaceDoc.dynamicContext }] : []),
    ...userDocs,
  ].filter((d) => d.staticFacts.length > 0 || d.dynamicContext.length > 0);

  if (docs.length === 0) return { static: [], dynamic: [] };

  let profile: WorkspaceProfile;
  if (docs.length === 1) {
    // Single source — nothing to merge
    profile = {
      static: docs[0].staticFacts.slice(0, MAX_STATIC_FACTS),
      dynamic: docs[0].dynamicContext.slice(0, MAX_DYNAMIC_CONTEXT),
    };
  } else {
    // Profile facts are synthesized from untrusted end-user content — neutralize
    // forged fences so one user's poisoned profile can't break out of the
    // PROFILES block below and steer the merge that is served to every other
    // user of this developer. (JSON.stringify escapes newlines, but the
    // `--- END PROFILES ---` marker itself would survive it.)
    const docsText = neutralizePromptDelimiters(
      docs
        .map((d, i) => `Profile ${i + 1}:\nFacts: ${JSON.stringify(d.staticFacts)}\nContext: ${JSON.stringify(d.dynamicContext)}`)
        .join("\n---\n")
    );

    try {
      const raw = await chatSynthesis([
        {
          role: "system",
          content:
            "You are a team knowledge manager. Your only job is to output a JSON object. No explanations. No preamble. Output only the JSON.",
        },
        {
          role: "user",
          content: `Below are synthesized memory profiles for individual users of one team/workspace.
Distill them into ONE team-wide profile that reflects shared patterns, common preferences, and what the team as a whole is working on. Drop facts that apply to only a single person unless they matter to the whole team.

--- BEGIN PROFILES ---
${docsText}
--- END PROFILES ---

Output this JSON (rules: static_facts = stable team-wide facts/preferences/processes max ${MAX_STATIC_FACTS}; dynamic_context = what the team is currently working on max ${MAX_DYNAMIC_CONTEXT}; merge duplicates):
{"static_facts":["..."],"dynamic_context":["..."]}`,
        },
      ]);
      const parsed = parseProfileResponse(raw);
      profile = parsed
        ? {
            static: parsed.static.slice(0, MAX_STATIC_FACTS),
            dynamic: parsed.dynamic.slice(0, MAX_DYNAMIC_CONTEXT),
          }
        : mergeProfiles(docs);
    } catch (err) {
      console.error("[query] Workspace profile synthesis failed, using merged fallback:", err);
      profile = mergeProfiles(docs);
    }
  }

  await setCachedWorkspaceProfile(developerId, profile);
  return profile;
}

export async function queryWorkspaceContext(
  developerId: string,
  workspaceId: string,
  question?: string,
  options: RetrievalOptions = {}
): Promise<UserContextResponse> {
  const profile = await synthesizeWorkspaceProfile(developerId, workspaceId);

  let relevant: Array<{ content: string; similarity: number; metadata: object }> = [];

  if (question) {
    // Same hybrid search as queryUser, but across every chunk in the workspace
    const results = await searchChunks({
      workspaceId,
      query: question,
      limit: VECTOR_SEARCH_TOP_K,
      alpha: options.alpha,
      threshold: options.threshold,
      filters: options.filters,
      sessionId: options.sessionId,
    });
    relevant = results.map((r) => ({
      content: r.content,
      similarity: r.similarity,
      metadata: r.metadata,
    }));
  }

  return { static: profile.static, dynamic: profile.dynamic, temporal: [], relevant, entities: [] };
}
