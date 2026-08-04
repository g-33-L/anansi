import { Hono, type Context } from "hono";
import { randomUUID } from "crypto";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import { memoryUsers, memoryChunks, staticDocuments, entityNodes } from "../lib/db/schema.js";
import { validateApiKey, hasScope, type ApiScope, type DeveloperContext } from "../lib/auth/api-auth.js";
import { sanitizeText } from "../lib/utils/sanitize.js";
import {
  redactForWorkspace,
  getEnabledRulesForWorkspace,
  applyRedactionRules,
} from "../lib/enterprise/redaction.js";
import { chunkBySourceType } from "../lib/ai/chunker.js";
import { insertChunks, EMBEDDING_DIMENSIONS } from "../lib/ai/ingest-core.js";
import { synthesisQueue, embedQueue, type UserSynthesisJobData } from "../lib/infra/queue.js";
import {
  queryUser,
  queryWorkspaceContext,
  searchChunks,
  getEntitiesForUser,
  buildFilterSQL,
  FilterError,
  type MetadataFilter,
  type RetrievalOptions,
} from "../lib/ai/query-engine.js";
import { isUrlContent, fetchUrlContent, UrlIngestError } from "../lib/url-ingest.js";
import { reconstructLedger } from "../lib/ai/ledger.js";
import { computeDivergences, computeTimeline } from "../lib/ai/ledger-diff.js";
import {
  getCachedContext,
  setCachedContext,
  invalidateUserCache,
  invalidateWorkspaceProfileCache,
} from "../lib/infra/cache.js";
import { checkRateLimit } from "../lib/infra/rate-limit.js";
import { checkAndIncrementApiCall } from "../lib/billing/usage.js";
import { gateFeature } from "../lib/billing/feature-gate.js";
import { hasFeature } from "../lib/billing/plans.js";

export const v1Routes = new Hono();

const MAX_CONTENT_BYTES = 100 * 1024; // 100 KB
const MAX_Q_LENGTH = 2000;
const SOURCE_ID_RE = /^[a-zA-Z0-9:_./-]{1,256}$/;
const BATCH_MAX_ITEMS = 50;
const SEARCH_MAX_LIMIT = 50;
const MEMORIES_MAX_LIMIT = 100;
const MAX_ENTITY_CONTEXT_LENGTH = 500;

// Maps the public API sourceType string to the DB enum value used for chunking/storage.
// The original caller-supplied value is always preserved in metadata.sourceType.
const SOURCE_TYPE_MAP: Record<string, "api_text" | "meeting_transcript"> = {
  conversation:     "api_text",
  voice:            "api_text",
  action:           "api_text",
  agent_summary:    "api_text",
  onboarding:       "api_text",
  meeting:          "meeting_transcript",
  meeting_transcript: "meeting_transcript",
};

function resolveSourceType(t: unknown): "api_text" | "meeting_transcript" {
  if (typeof t !== "string") return "api_text";
  return SOURCE_TYPE_MAP[t] ?? "api_text";
}

// Optional ttl (seconds) → absolute expiry timestamp. Null = never expires.
const TTL_MAX_SECONDS = 10 * 365 * 24 * 60 * 60; // 10 years

function resolveExpiresAt(ttl: unknown):
  | { ok: true; expiresAt: Date | null }
  | { ok: false; error: string } {
  if (ttl === undefined || ttl === null) return { ok: true, expiresAt: null };
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 1 || ttl > TTL_MAX_SECONDS) {
    return { ok: false, error: `ttl must be an integer between 1 and ${TTL_MAX_SECONDS} seconds` };
  }
  return { ok: true, expiresAt: new Date(Date.now() + ttl * 1000) };
}

// ─── Retrieval param helpers ──────────────────────────────────────────────────
// Shared validation for alpha / threshold / filters across GET /v1/context and
// POST /v1/search. Values arrive as strings (query params) or raw JSON (body).

function parseUnitFloat(value: unknown, name: string):
  | { ok: true; value: number | undefined }
  | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  const n = typeof value === "number" ? value : Number(value);
  if (typeof value === "string" && value.trim() === "") return { ok: false, error: `${name} must be a number between 0.0 and 1.0` };
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    return { ok: false, error: `${name} must be a number between 0.0 and 1.0` };
  }
  return { ok: true, value: n };
}

// Accepts a filter as a JSON string (query param) or already-parsed object (body).
// Validates structure eagerly via buildFilterSQL so bad filters 400 instead of 500.
function parseFilters(value: unknown):
  | { ok: true; value: MetadataFilter | undefined }
  | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { ok: false, error: "filters must be valid JSON" };
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "filters must be a JSON object" };
  }
  try {
    buildFilterSQL(parsed as MetadataFilter);
  } catch (err) {
    if (err instanceof FilterError) return { ok: false, error: `Invalid filters: ${err.message}` };
    throw err;
  }
  return { ok: true, value: parsed as MetadataFilter };
}

// Point-in-time query boundary. Accepts "YYYY-MM", "YYYY-MM-DD", or full ISO 8601.
function parseAsOf(value: unknown):
  | { ok: true; value: Date | undefined }
  | { ok: false; error: string } {
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") return { ok: false, error: "asOf must be a date string" };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return { ok: false, error: "asOf must be a valid date (YYYY-MM, YYYY-MM-DD, or ISO 8601)" };
  }
  return { ok: true, value: d };
}

function parseRetrievalOptions(raw: {
  alpha?: unknown;
  threshold?: unknown;
  filters?: unknown;
  sessionId?: unknown;
  asOf?: unknown;
  asOfKnowledge?: unknown;
}):
  | { ok: true; opts: RetrievalOptions }
  | { ok: false; error: string } {
  const alpha = parseUnitFloat(raw.alpha, "alpha");
  if (!alpha.ok) return alpha;
  const threshold = parseUnitFloat(raw.threshold, "threshold");
  if (!threshold.ok) return threshold;
  const filters = parseFilters(raw.filters);
  if (!filters.ok) return filters;
  const asOf = parseAsOf(raw.asOf);
  if (!asOf.ok) return asOf;
  const asOfKnowledge = parseAsOf(raw.asOfKnowledge);
  if (!asOfKnowledge.ok) return { ok: false, error: asOfKnowledge.error.replace("asOf", "asOfKnowledge") };
  if (raw.sessionId !== undefined && raw.sessionId !== null && typeof raw.sessionId !== "string") {
    return { ok: false, error: "sessionId must be a string" };
  }
  return {
    ok: true,
    opts: {
      alpha: alpha.value,
      threshold: threshold.value,
      filters: filters.value,
      sessionId: typeof raw.sessionId === "string" ? raw.sessionId : undefined,
      asOf: asOf.value,
      asOfKnowledge: asOfKnowledge.value,
    },
  };
}

function hasRetrievalOptions(opts: RetrievalOptions): boolean {
  return (
    opts.alpha !== undefined ||
    opts.threshold !== undefined ||
    opts.filters !== undefined ||
    opts.sessionId !== undefined ||
    opts.asOf !== undefined ||
    opts.asOfKnowledge !== undefined
  );
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function authenticate(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  return validateApiKey(authHeader.slice(7));
}

/*
 * Scope check for an already-authenticated key.
 *
 * Returns a 403 response when the key is scoped and lacks `scope`, or null to
 * continue. A key with no scope rows is unrestricted, so existing keys are
 * unaffected — only keys an operator deliberately narrowed change behaviour,
 * and those were previously unrestricted despite the console saying otherwise.
 *
 * 403, not 401: the credential is valid, it just isn't permitted here, and a
 * 401 would send clients into a pointless re-authentication loop.
 */
function requireScope(c: Context, ctx: DeveloperContext, scope: ApiScope) {
  if (hasScope(ctx, scope)) return null;
  return c.json(
    {
      error: `This API key is not authorized for "${scope}" operations.`,
      code: "insufficient_scope",
      required_scope: scope,
      key_scopes: ctx.scopes,
    },
    403
  );
}

const INGEST_RATE_LIMIT = 100; // requests per minute per API key
const CONTEXT_RATE_LIMIT = 60; // requests per minute per API key

// ─── Metadata sanitization ────────────────────────────────────────────────────
// Limits user-supplied metadata to prevent storage bloat and unexpected keys
// from affecting filter behavior. System keys (author, timestamp, etc.) are
// set separately and always win on collision with user-supplied values.
const METADATA_MAX_KEYS = 20;
const METADATA_STRING_MAX = 1024;

function sanitizeUserMetadata(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (count >= METADATA_MAX_KEYS) break;
    if (typeof k !== "string" || k.length > 64) continue;
    if (v === null || typeof v === "boolean" || typeof v === "number") {
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      out[k] = v;
      count++;
    } else if (typeof v === "string") {
      out[k] = v.slice(0, METADATA_STRING_MAX);
      count++;
    }
    // Nested objects and arrays are dropped — they could bypass filter depth limits.
  }
  return out;
}

// ─── POST /v1/ingest ─────────────────────────────────────────────────────────

v1Routes.post("/ingest", async (c) => {
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "ingest");
  if (denied) return denied;

  // Per-minute rate limit
  const rl = await checkRateLimit(`ingest:${ctx.developerId}`, INGEST_RATE_LIMIT);
  if (!rl) return c.json({ error: "Rate limit exceeded — 100 ingest calls/minute" }, 429, { "Retry-After": "60" });

  // Monthly quota — 402 so clients can distinguish "slow down" (429) from "upgrade plan" (402)
  const quota = await checkAndIncrementApiCall(ctx.workspaceId, "ingest");
  if (!quota.allowed) return c.json({ error: "Monthly ingest quota exceeded — upgrade your plan" }, 402);

  let body: {
    userId?: unknown;
    content?: unknown;
    sourceType?: unknown;
    sourceId?: unknown;
    sessionId?: unknown;
    agentId?: unknown;
    ttl?: unknown;
    embedding?: unknown;
    embeddingModel?: unknown;
    entityContext?: unknown;
    metadata?: Record<string, unknown>;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { userId, content, sourceType, sourceId, sessionId, agentId, ttl, embedding, embeddingModel, entityContext, metadata: rawMetadata = {} } = body;
  const metadata = sanitizeUserMetadata(rawMetadata as Record<string, unknown>);

  if (!userId || typeof userId !== "string") return c.json({ error: "userId required" }, 400);
  if (!content || typeof content !== "string") return c.json({ error: "content required" }, 400);
  if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) return c.json({ error: "Content exceeds 100 KB limit" }, 413);
  if (typeof sourceId === "string" && !SOURCE_ID_RE.test(sourceId)) return c.json({ error: "Invalid sourceId format" }, 400);

  // Bring-your-own vector: must match the configured embedding dimension
  let precomputedEmbedding: number[] | undefined;
  if (embedding !== undefined && embedding !== null) {
    if (
      !Array.isArray(embedding) ||
      embedding.length !== EMBEDDING_DIMENSIONS ||
      !embedding.every((v) => typeof v === "number" && Number.isFinite(v))
    ) {
      return c.json({ error: `embedding must be an array of ${EMBEDDING_DIMENSIONS} finite numbers` }, 400);
    }
    precomputedEmbedding = embedding as number[];
  }
  if (embeddingModel !== undefined && typeof embeddingModel !== "string") {
    return c.json({ error: "embeddingModel must be a string" }, 400);
  }
  if (entityContext !== undefined && (typeof entityContext !== "string" || entityContext.length > MAX_ENTITY_CONTEXT_LENGTH)) {
    return c.json({ error: `entityContext must be a string of at most ${MAX_ENTITY_CONTEXT_LENGTH} characters` }, 400);
  }

  // Plan gates — entityContext feeds the entity graph (Pro+ only).
  if (entityContext !== undefined) {
    const gate = gateFeature(ctx.plan, "entityGraph", "entityContext");
    if (gate) return c.json(gate, 402);
  }

  const ttlResult = resolveExpiresAt(ttl);
  if (!ttlResult.ok) return c.json({ error: ttlResult.error }, 400);

  // URL ingestion: when content is a single http(s) URL, fetch it server-side
  // and ingest the extracted text instead (500 KB fetch cap, 10s timeout).
  // Skipped when a custom embedding is supplied — the vector corresponds to the
  // literal content string, so the content must be stored as-is.
  let effectiveContent = content;
  let urlMeta: { url: string; title?: string } | null = null;
  if (!precomputedEmbedding && isUrlContent(content)) {
    const urlGate = gateFeature(ctx.plan, "urlIngestion", "URL ingestion");
    if (urlGate) return c.json(urlGate, 402);
    try {
      const fetched = await fetchUrlContent(content);
      if (!fetched.text.trim()) return c.json({ error: "URL returned no extractable text" }, 400);
      // Keep extracted text within the same ceiling as direct content
      effectiveContent = fetched.text.slice(0, MAX_CONTENT_BYTES);
      urlMeta = { url: fetched.url, title: fetched.title };
    } catch (err) {
      if (err instanceof UrlIngestError) return c.json({ error: err.message }, 400);
      throw err;
    }
  }

  const resolvedSourceType = urlMeta ? ("url" as const) : resolveSourceType(sourceType);

  // Upsert memory user (idempotent)
  const [memUser] = await db
    .insert(memoryUsers)
    .values({ developerId: ctx.developerId, externalId: userId })
    .onConflictDoUpdate({
      target: [memoryUsers.developerId, memoryUsers.externalId],
      set: { externalId: userId },
    })
    .returning({ id: memoryUsers.id });

  // Static secret scrub + the owning org's configured PII redaction rules.
  const { text, secretsRedacted: redactedCount } = await redactForWorkspace(
    ctx.workspaceId,
    effectiveContent
  );
  if (redactedCount > 0) {
    console.log(`[v1/ingest] Redacted ${redactedCount} secret(s) from request`);
  }

  if (!text.trim()) return c.json({ error: "Content is empty after sanitization" }, 400);

  // A custom embedding maps to exactly one chunk — chunking would break the 1:1
  // content↔vector pairing, so the content is stored whole.
  const chunks = precomputedEmbedding ? [text] : chunkBySourceType(text, resolvedSourceType);
  const baseSourceId = typeof sourceId === "string" ? sourceId : `api:${ctx.workspaceId}:${userId}:${randomUUID()}`;

  // Insert chunks immediately with NULL embedding (invisible to search until embedded).
  // Embed jobs are enqueued after insert so the HTTP response returns without waiting
  // on the embedding provider. Chunks with a precomputedEmbedding bypass the queue.
  const chunkIds = await insertChunks(
    chunks.map((chunk, idx) => ({
      workspaceId: ctx.workspaceId,
      memoryUserId: memUser.id,
      sourceType: resolvedSourceType,
      sourceId: chunks.length > 1 ? `${baseSourceId}:${idx}` : baseSourceId,
      content: chunk,
      expiresAt: ttlResult.expiresAt,
      precomputedEmbedding,
      metadata: {
        // Caller metadata is stored as-is so metadata filters can target it;
        // system keys below take precedence on collision
        ...metadata,
        author: typeof metadata.author === "string" ? metadata.author : userId,
        authorId: userId,
        timestamp: typeof metadata.timestamp === "string" ? metadata.timestamp : new Date().toISOString(),
        channelName: "api",
        // Preserve original API sourceType so callers can filter on it
        sourceType: typeof sourceType === "string" ? sourceType : urlMeta ? "url" : "api_text",
        ...(urlMeta ? { url: urlMeta.url } : {}),
        ...(typeof metadata.title === "string"
          ? { title: metadata.title }
          : urlMeta?.title
            ? { title: urlMeta.title }
            : {}),
        ...(typeof sessionId === "string" ? { sessionId } : {}),
        ...(typeof agentId === "string" ? { agentId } : {}),
        ...(typeof metadata.actionType === "string" ? { actionType: metadata.actionType } : {}),
        ...(typeof metadata.resourceId === "string" ? { resourceId: metadata.resourceId } : {}),
        ...(typeof metadata.resourceType === "string" ? { resourceType: metadata.resourceType } : {}),
        ...(precomputedEmbedding ? { embedding_source: "custom" } : {}),
        ...(typeof embeddingModel === "string" ? { embeddingModel } : {}),
        ...(typeof entityContext === "string" ? { entityContext } : {}),
      },
    }))
  );

  // Enqueue one embed job per chunk that needs a computed embedding
  await Promise.all(
    chunkIds.map((chunkId) =>
      embedQueue.add("embed-chunk", { chunkId }, { jobId: `embed-${chunkId}` })
    )
  );

  // Trigger user-scoped synthesis (deduped by jobId)
  const userSynthJob: UserSynthesisJobData = { memoryUserId: memUser.id, workspaceId: ctx.workspaceId };
  await synthesisQueue.add(
    "synthesize-user",
    userSynthJob as never,
    { jobId: `synthesis-user-${memUser.id}` }
  );

  return c.json({ id: baseSourceId, queued: true }, 202);
});

// ─── POST /v1/ingest/batch ───────────────────────────────────────────────────
// Ingest up to 50 items in one request. Each item is independently chunked,
// embedded, and queued. Returns ids[] in the same order as the input array.
// Useful for onboarding flows where many facts are collected at once.

v1Routes.post("/ingest/batch", async (c) => {
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "ingest");
  if (denied) return denied;

  // Parse and validate the body before rate-limiting so the item count is known.
  // Rate limit cost = items.length so a 50-item batch consumes 50 units, not 1.
  let body: { items?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body.items)) return c.json({ error: "items must be an array" }, 400);
  if (body.items.length === 0) return c.json({ error: "items array is empty" }, 400);
  if (body.items.length > BATCH_MAX_ITEMS) return c.json({ error: `Batch limit is ${BATCH_MAX_ITEMS} items` }, 400);

  const rl = await checkRateLimit(`ingest:${ctx.developerId}`, INGEST_RATE_LIMIT, 60_000, body.items.length);
  if (!rl) return c.json({ error: "Rate limit exceeded — 100 ingest calls/minute" }, 429, { "Retry-After": "60" });

  // Charge the monthly ingest quota per item, not per request — a 50-item batch
  // is 50 ingest units, matching the rate-limit cost above. All-or-nothing: the
  // whole batch is rejected if it wouldn't fit under the cap, so batch ingest
  // can't be used to get 50x the metered volume for one quota unit.
  const quota = await checkAndIncrementApiCall(ctx.workspaceId, "ingest", body.items.length);
  if (!quota.allowed) return c.json({ error: "Monthly ingest quota exceeded — upgrade your plan" }, 402);

  const ids: string[] = [];
  const seenUsers = new Map<string, string>(); // externalId → memoryUserId
  // Resolve the org's redaction rules ONCE for the whole batch (all items share the
  // workspace), then apply per item alongside the static secret scrub.
  const orgRules = await getEnabledRulesForWorkspace(ctx.workspaceId);

  for (const item of body.items as Record<string, unknown>[]) {
    const { userId, content, sourceType, sourceId, sessionId, agentId, ttl, entityContext, metadata: rawItemMetadata = {} } = item as {
      userId?: unknown; content?: unknown; sourceType?: unknown; sourceId?: unknown;
      sessionId?: unknown; agentId?: unknown; ttl?: unknown; entityContext?: unknown;
      metadata?: Record<string, unknown>;
    };
    const metadata = sanitizeUserMetadata(rawItemMetadata as Record<string, unknown>);

    if (!userId || typeof userId !== "string") { ids.push(""); continue; }
    if (!content || typeof content !== "string" || !content.trim()) { ids.push(""); continue; }
    if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) { ids.push(""); continue; }
    if (entityContext !== undefined && (typeof entityContext !== "string" || entityContext.length > MAX_ENTITY_CONTEXT_LENGTH)) { ids.push(""); continue; }
    // Drop entityContext silently on plans without the entity graph — batch
    // items don't error per-item, so a quiet downgrade preserves progress.
    const effectiveEntityContext = hasFeature(ctx.plan, "entityGraph") ? entityContext : undefined;

    const ttlResult = resolveExpiresAt(ttl);
    if (!ttlResult.ok) { ids.push(""); continue; }

    // Upsert memory user (cache within the batch to avoid N round-trips)
    let memUserId = seenUsers.get(userId);
    if (!memUserId) {
      const [memUser] = await db
        .insert(memoryUsers)
        .values({ developerId: ctx.developerId, externalId: userId })
        .onConflictDoUpdate({
          target: [memoryUsers.developerId, memoryUsers.externalId],
          set: { externalId: userId },
        })
        .returning({ id: memoryUsers.id });
      memUserId = memUser.id;
      seenUsers.set(userId, memUserId);
    }

    const scrubbed = sanitizeText(content).text;
    const text = orgRules.length ? applyRedactionRules(scrubbed, orgRules) : scrubbed;
    if (!text.trim()) { ids.push(""); continue; }

    const resolvedSourceType = resolveSourceType(sourceType);
    const chunks = chunkBySourceType(text, resolvedSourceType);
    const baseSourceId = typeof sourceId === "string" && SOURCE_ID_RE.test(sourceId)
      ? sourceId
      : `api:${ctx.workspaceId}:${userId}:${randomUUID()}`;

    const batchChunkIds = await insertChunks(
      chunks.map((chunk, idx) => ({
        workspaceId: ctx.workspaceId,
        memoryUserId: memUserId!,
        sourceType: resolvedSourceType,
        sourceId: chunks.length > 1 ? `${baseSourceId}:${idx}` : baseSourceId,
        content: chunk,
        expiresAt: ttlResult.expiresAt,
        metadata: {
          // Sanitized caller metadata (filterable); system keys win on collision
          ...metadata,
          author: typeof metadata.author === "string" ? metadata.author : userId,
          authorId: userId,
          timestamp: typeof metadata.timestamp === "string" ? metadata.timestamp : new Date().toISOString(),
          channelName: "api",
          sourceType: typeof sourceType === "string" ? sourceType : "api_text",
          ...(typeof sessionId === "string" ? { sessionId } : {}),
          ...(typeof agentId === "string" ? { agentId } : {}),
          ...(typeof metadata.actionType === "string" ? { actionType: metadata.actionType } : {}),
          ...(typeof metadata.resourceId === "string" ? { resourceId: metadata.resourceId } : {}),
          ...(typeof effectiveEntityContext === "string" ? { entityContext: effectiveEntityContext } : {}),
        },
      }))
    );

    // Enqueue embed jobs for chunks that need computed embeddings
    await Promise.all(
      batchChunkIds.map((chunkId) =>
        embedQueue.add("embed-chunk", { chunkId }, { jobId: `embed-${chunkId}` })
      )
    );

    ids.push(baseSourceId);
  }

  // Trigger synthesis for all unique users touched in this batch
  for (const memUserId of seenUsers.values()) {
    const userSynthJob: UserSynthesisJobData = { memoryUserId: memUserId, workspaceId: ctx.workspaceId };
    await synthesisQueue.add("synthesize-user", userSynthJob as never, { jobId: `synthesis-user-${memUserId}` });
  }

  return c.json({ queued: ids.filter(Boolean).length, ids }, 202);
});

// ─── GET /v1/context ─────────────────────────────────────────────────────────

v1Routes.get("/context", async (c) => {
  const t0 = Date.now();
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "read");
  if (denied) return denied;

  // Per-minute rate limit
  const rl = await checkRateLimit(`context:${ctx.developerId}`, CONTEXT_RATE_LIMIT);
  if (!rl) return c.json({ error: "Rate limit exceeded — 60 context calls/minute" }, 429, { "Retry-After": "60" });

  // Monthly quota is charged further down, only after input validation and feature
  // gates pass, so a rejected 400/402 doesn't burn a billable call. It is charged
  // before the cache lookup, so cache hits still count.

  const userId = c.req.query("userId");
  const q = c.req.query("q");
  const scope = c.req.query("scope");

  if (q && q.length > MAX_Q_LENGTH) return c.json({ error: "Query exceeds 2000 character limit" }, 400);
  if (scope && scope !== "user" && scope !== "workspace") {
    return c.json({ error: "scope must be 'user' or 'workspace'" }, 400);
  }

  const parsedOpts = parseRetrievalOptions({
    alpha: c.req.query("alpha"),
    threshold: c.req.query("threshold"),
    filters: c.req.query("filters"),
    sessionId: c.req.query("sessionId"),
    asOf: c.req.query("asOf"),
    asOfKnowledge: c.req.query("asOfKnowledge"),
  });
  if (!parsedOpts.ok) return c.json({ error: parsedOpts.error }, 400);
  const retrievalOpts = parsedOpts.opts;

  // Feature gates — gate parameters before doing any work
  if (retrievalOpts.filters !== undefined) {
    const gate = gateFeature(ctx.plan, "metadataFilters", "Metadata filters");
    if (gate) return c.json(gate, 402);
  }
  if (retrievalOpts.asOf !== undefined || retrievalOpts.asOfKnowledge !== undefined) {
    const gate = gateFeature(ctx.plan, "entityGraph", "Point-in-time queries (asOf/asOfKnowledge)");
    if (gate) return c.json(gate, 402);
  }
  if (retrievalOpts.alpha !== undefined && retrievalOpts.alpha !== 1) {
    // alpha < 1 means BM25 contribution — requires hybrid search
    const gate = gateFeature(ctx.plan, "hybridSearch", "Hybrid search (alpha parameter)");
    if (gate) return c.json(gate, 402);
  }

  const entityGraphEnabled = hasFeature(ctx.plan, "entityGraph");

  // Free plans get vector-only retrieval. alpha=1 makes searchChunks short-
  // circuit the BM25 leg without changing any other behavior.
  if (!hasFeature(ctx.plan, "hybridSearch") && retrievalOpts.alpha === undefined) {
    retrievalOpts.alpha = 1;
  }

  // Workspace scope: team-wide profile across all memory users for this developer.
  // No userId required. Profile is cached 5 minutes (keyed on developerId);
  // relevant[] is computed fresh per request.
  if (scope === "workspace") {
    const wsGate = gateFeature(ctx.plan, "workspaceContext", "Workspace-scoped context");
    if (wsGate) return c.json(wsGate, 402);
    // Charge quota now that the request is validated and gated (402 = upgrade vs 429 = slow down).
    const quota = await checkAndIncrementApiCall(ctx.workspaceId, "context");
    if (!quota.allowed) return c.json({ error: "Monthly context quota exceeded — upgrade your plan" }, 402);
    const result = await queryWorkspaceContext(ctx.developerId, ctx.workspaceId, q ?? undefined, retrievalOpts);
    console.log(JSON.stringify({
      event: "context_workspace",
      durationMs: Date.now() - t0,
      hasQuery: !!q,
      relevantCount: result.relevant.length,
    }));
    return c.json(result);
  }

  if (!userId) return c.json({ error: "userId required" }, 400);
  if (userId.length > 256) return c.json({ error: "userId too long" }, 400);

  // Charge quota after validation/gating; charged before the cache lookup so cache hits still count.
  const quota = await checkAndIncrementApiCall(ctx.workspaceId, "context");
  if (!quota.allowed) return c.json({ error: "Monthly context quota exceeded — upgrade your plan" }, 402);

  const tAuth = Date.now();

  const memUser = await db.query.memoryUsers.findFirst({
    where: and(
      eq(memoryUsers.developerId, ctx.developerId),
      eq(memoryUsers.externalId, userId)
    ),
  });

  // Return empty context for new users — they haven't ingested yet, not an error
  if (!memUser) {
    return c.json(
      entityGraphEnabled
        ? { static: [], dynamic: [], temporal: [], relevant: [], entities: [] }
        : { static: [], dynamic: [], relevant: [] }
    );
  }

  const qVal = q ?? undefined;

  // Cache variant: anything that changes the response must be part of the key
  const variant = qVal !== undefined || hasRetrievalOptions(retrievalOpts)
    ? JSON.stringify({
        q: qVal ?? null,
        alpha: retrievalOpts.alpha ?? null,
        threshold: retrievalOpts.threshold ?? null,
        filters: retrievalOpts.filters ?? null,
        sessionId: retrievalOpts.sessionId ?? null,
        asOf: retrievalOpts.asOf?.toISOString() ?? null,
        asOfKnowledge: retrievalOpts.asOfKnowledge?.toISOString() ?? null,
      })
    : undefined;

  const cached = await getCachedContext(ctx.developerId, memUser.id, variant);
  if (cached) {
    console.log(JSON.stringify({
      event: "context_hit",
      durationMs: Date.now() - t0,
      authMs: tAuth - t0,
      source: "cache",
      hasQuery: !!qVal,
    }));
    return c.json(
      entityGraphEnabled
        ? cached
        : { static: cached.static, dynamic: cached.dynamic, relevant: cached.relevant }
    );
  }

  const tQuery = Date.now();
  const fullResult = await queryUser(ctx.workspaceId, memUser.id, qVal, retrievalOpts);
  await setCachedContext(ctx.developerId, memUser.id, variant, fullResult);

  // Free plans only see static + dynamic + relevant. Temporal facts and the
  // entity graph are Pro+ features; strip them from the response surface so
  // they're not just unused payload.
  const result = entityGraphEnabled
    ? fullResult
    : { static: fullResult.static, dynamic: fullResult.dynamic, relevant: fullResult.relevant };

  console.log(JSON.stringify({
    event: "context_miss",
    durationMs: Date.now() - t0,
    authMs: tAuth - t0,
    queryMs: Date.now() - tQuery,
    hasQuery: !!qVal,
    relevantCount: fullResult.relevant.length,
  }));

  return c.json(result);
});

// ─── POST /v1/search ─────────────────────────────────────────────────────────
// Raw hybrid search without synthesis — returns scored chunks, not a profile.
// Supports semantic/hybrid/keyword modes, alpha weighting, per-request
// thresholds, metadata filters, and document scoping via sourceId.

v1Routes.post("/search", async (c) => {
  const t0 = Date.now();
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "read");
  if (denied) return denied;

  const rl = await checkRateLimit(`context:${ctx.developerId}`, CONTEXT_RATE_LIMIT);
  if (!rl) return c.json({ error: "Rate limit exceeded — 60 search calls/minute" }, 429, { "Retry-After": "60" });

  // Monthly quota is charged below, only once the request is validated, gated, and
  // the target user exists — so 400/402s and unknown-user calls don't burn a call.

  let body: {
    userId?: unknown;
    query?: unknown;
    searchMode?: unknown;
    threshold?: unknown;
    alpha?: unknown;
    limit?: unknown;
    filters?: unknown;
    sourceId?: unknown;
    sessionId?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { userId, query, searchMode, limit, sourceId } = body;

  if (!userId || typeof userId !== "string") return c.json({ error: "userId required" }, 400);
  if (userId.length > 256) return c.json({ error: "userId too long" }, 400);
  if (!query || typeof query !== "string" || !query.trim()) return c.json({ error: "query required" }, 400);
  if (query.length > MAX_Q_LENGTH) return c.json({ error: "Query exceeds 2000 character limit" }, 400);
  if (searchMode !== undefined && searchMode !== "semantic" && searchMode !== "hybrid" && searchMode !== "keyword") {
    return c.json({ error: "searchMode must be 'semantic', 'hybrid', or 'keyword'" }, 400);
  }
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT)) {
    return c.json({ error: `limit must be an integer between 1 and ${SEARCH_MAX_LIMIT}` }, 400);
  }
  if (sourceId !== undefined && (typeof sourceId !== "string" || !SOURCE_ID_RE.test(sourceId))) {
    return c.json({ error: "Invalid sourceId format" }, 400);
  }

  const parsedOpts = parseRetrievalOptions(body);
  if (!parsedOpts.ok) return c.json({ error: parsedOpts.error }, 400);

  // Plan gates — hybrid/keyword + alpha + filters are Pro+ features
  const wantsBm25 = searchMode === "hybrid" || searchMode === "keyword";
  if (wantsBm25) {
    const gate = gateFeature(ctx.plan, "hybridSearch", "Hybrid/keyword search");
    if (gate) return c.json(gate, 402);
  }
  if (parsedOpts.opts.alpha !== undefined && parsedOpts.opts.alpha !== 1) {
    const gate = gateFeature(ctx.plan, "hybridSearch", "Hybrid search (alpha parameter)");
    if (gate) return c.json(gate, 402);
  }
  if (parsedOpts.opts.filters !== undefined) {
    const gate = gateFeature(ctx.plan, "metadataFilters", "Metadata filters");
    if (gate) return c.json(gate, 402);
  }
  // Without the hybrid-search feature, force pure semantic mode regardless of input
  const effectiveSearchMode = hasFeature(ctx.plan, "hybridSearch")
    ? (searchMode as "semantic" | "hybrid" | "keyword" | undefined)
    : ("semantic" as const);

  const memUser = await db.query.memoryUsers.findFirst({
    where: and(
      eq(memoryUsers.developerId, ctx.developerId),
      eq(memoryUsers.externalId, userId)
    ),
  });
  if (!memUser) return c.json({ results: [], total: 0 });

  const quota = await checkAndIncrementApiCall(ctx.workspaceId, "context");
  if (!quota.allowed) return c.json({ error: "Monthly context quota exceeded — upgrade your plan" }, 402);

  const results = await searchChunks({
    workspaceId: ctx.workspaceId,
    memoryUserId: memUser.id,
    query,
    searchMode: effectiveSearchMode,
    limit: limit as number | undefined,
    sourceId: sourceId as string | undefined,
    ...parsedOpts.opts,
  });

  console.log(JSON.stringify({
    event: "search",
    durationMs: Date.now() - t0,
    mode: searchMode ?? "hybrid",
    resultCount: results.length,
  }));

  return c.json({
    results: results.map((r) => ({
      content: r.content,
      score: r.score,
      sourceId: r.sourceId,
      metadata: r.metadata,
    })),
    total: results.length,
  });
});

// ─── GET /v1/memories ────────────────────────────────────────────────────────
// List raw memory chunks for a user with pagination. With q, results are
// ranked by hybrid search; without, newest first.

v1Routes.get("/memories", async (c) => {
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "read");
  if (denied) return denied;

  const rl = await checkRateLimit(`context:${ctx.developerId}`, CONTEXT_RATE_LIMIT);
  if (!rl) return c.json({ error: "Rate limit exceeded — 60 calls/minute" }, 429, { "Retry-After": "60" });

  // Quota is charged after validation and the target-user lookup (below).

  const userId = c.req.query("userId");
  const sourceType = c.req.query("sourceType");
  const q = c.req.query("q");

  if (!userId) return c.json({ error: "userId required" }, 400);
  if (userId.length > 256) return c.json({ error: "userId too long" }, 400);
  if (q && q.length > MAX_Q_LENGTH) return c.json({ error: "Query exceeds 2000 character limit" }, 400);

  const limitRaw = c.req.query("limit");
  const offsetRaw = c.req.query("offset");
  const limit = limitRaw === undefined ? 20 : Number(limitRaw);
  const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MEMORIES_MAX_LIMIT) {
    return c.json({ error: `limit must be an integer between 1 and ${MEMORIES_MAX_LIMIT}` }, 400);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    return c.json({ error: "offset must be a non-negative integer" }, 400);
  }

  const memUser = await db.query.memoryUsers.findFirst({
    where: and(
      eq(memoryUsers.developerId, ctx.developerId),
      eq(memoryUsers.externalId, userId)
    ),
  });
  if (!memUser) return c.json({ memories: [], total: 0, limit, offset });

  const quota = await checkAndIncrementApiCall(ctx.workspaceId, "context");
  if (!quota.allowed) return c.json({ error: "Monthly context quota exceeded — upgrade your plan" }, 402);

  if (q) {
    // Free plans get pure semantic ranking; Pro+ gets full hybrid (BM25 + vector).
    // The sourceType filter uses metadata filters internally — also gated.
    const useHybrid = hasFeature(ctx.plan, "hybridSearch");
    const useFilters = hasFeature(ctx.plan, "metadataFilters");
    // Ranked listing: fetch up to MEMORIES_MAX_LIMIT so total reflects the full
    // matched set (not just the current page), then slice for the requested page.
    const results = await searchChunks({
      workspaceId: ctx.workspaceId,
      memoryUserId: memUser.id,
      query: q,
      limit: MEMORIES_MAX_LIMIT,
      searchMode: useHybrid ? "hybrid" : "semantic",
      ...(sourceType && useFilters ? { filters: { metadata: { sourceType } } } : {}),
    });
    return c.json({
      memories: results.slice(offset, offset + limit).map((r) => ({
        id: r.id,
        content: r.content,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        metadata: r.metadata,
        similarity: r.similarity || null,
        synthesized: r.synthesized,
        expiresAt: r.expiresAt,
        createdAt: r.createdAt,
      })),
      total: results.length,
      limit,
      offset,
    });
  }

  // Caller-supplied sourceType matches the public value preserved in metadata
  const conditions = [
    eq(memoryChunks.memoryUserId, memUser.id),
    eq(memoryChunks.workspaceId, ctx.workspaceId),
    sql`(${memoryChunks.expiresAt} IS NULL OR ${memoryChunks.expiresAt} > now())`,
    ...(sourceType ? [sql`${memoryChunks.metadata}->>'sourceType' = ${sourceType}`] : []),
  ];

  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select()
      .from(memoryChunks)
      .where(and(...conditions))
      .orderBy(desc(memoryChunks.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(memoryChunks)
      .where(and(...conditions)),
  ]);

  return c.json({
    memories: rows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        content: r.content,
        sourceType: typeof meta.sourceType === "string" ? meta.sourceType : r.sourceType,
        sourceId: r.sourceId,
        metadata: meta,
        similarity: null,
        synthesized: r.synthesized,
        expiresAt: r.expiresAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    }),
    total,
    limit,
    offset,
  });
});

// ─── GET /v1/entities ────────────────────────────────────────────────────────
// All entities and their relationships for a user — built by the synthesis
// worker's entity extraction pass.

v1Routes.get("/entities", async (c) => {
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "entities");
  if (denied) return denied;

  // Plan gate — the entity graph is a Pro+ feature in its entirety
  const gate = gateFeature(ctx.plan, "entityGraph", "Entity graph (/v1/entities)");
  if (gate) return c.json(gate, 402);

  const rl = await checkRateLimit(`context:${ctx.developerId}`, CONTEXT_RATE_LIMIT);
  if (!rl) return c.json({ error: "Rate limit exceeded — 60 calls/minute" }, 429, { "Retry-After": "60" });

  // Quota is charged after validation and the target-user lookup (below).

  const userId = c.req.query("userId");
  if (!userId) return c.json({ error: "userId required" }, 400);
  if (userId.length > 256) return c.json({ error: "userId too long" }, 400);

  // Point-in-time snapshot of the graph when asOf is supplied; full history otherwise.
  // asOfKnowledge adds the knowledge-time axis (what we knew as of that instant).
  const asOf = parseAsOf(c.req.query("asOf"));
  if (!asOf.ok) return c.json({ error: asOf.error }, 400);
  const asOfKnowledge = parseAsOf(c.req.query("asOfKnowledge"));
  if (!asOfKnowledge.ok) return c.json({ error: asOfKnowledge.error.replace("asOf", "asOfKnowledge") }, 400);

  const memUser = await db.query.memoryUsers.findFirst({
    where: and(
      eq(memoryUsers.developerId, ctx.developerId),
      eq(memoryUsers.externalId, userId)
    ),
  });
  if (!memUser) return c.json({ entities: [] });

  const quota = await checkAndIncrementApiCall(ctx.workspaceId, "context");
  if (!quota.allowed) return c.json({ error: "Monthly context quota exceeded — upgrade your plan" }, 402);

  const entities = await getEntitiesForUser(memUser.id, { asOf: asOf.value, asOfKnowledge: asOfKnowledge.value });
  return c.json({ entities });
});

// ─── DELETE /v1/memory ────────────────────────────────────────────────────────
// Delete all memory for a userId, or specific chunks by sourceId.
// Full wipe removes chunks, the synthesized profile, and the entity graph
// (entity_edges cascade from entity_nodes), then evicts the Redis context and
// workspace-profile caches so deleted data is never served from cache.
// memoryUser row is kept so the developer can re-ingest without re-creating
// the user scoping.

v1Routes.delete("/memory", async (c) => {
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "admin");
  if (denied) return denied;

  const userId = c.req.query("userId");
  const sourceId = c.req.query("sourceId");

  if (!userId) return c.json({ error: "userId required" }, 400);
  if (userId.length > 256) return c.json({ error: "userId too long" }, 400);

  const memUser = await db.query.memoryUsers.findFirst({
    where: and(
      eq(memoryUsers.developerId, ctx.developerId),
      eq(memoryUsers.externalId, userId)
    ),
  });

  if (!memUser) return c.json({ deleted: 0 });

  if (sourceId) {
    // Delete chunks matching a specific sourceId
    const deleted = await db
      .delete(memoryChunks)
      .where(
        and(
          eq(memoryChunks.memoryUserId, memUser.id),
          eq(memoryChunks.sourceId, sourceId)
        )
      )
      .returning({ id: memoryChunks.id });
    // Cached context may hold the deleted chunks in relevant[]
    if (deleted.length > 0) await invalidateUserCache(memUser.id);
    return c.json({ deleted: deleted.length });
  }

  // Full wipe: delete all chunks, the synthesized profile, and the entity graph.
  // Deleting entity_nodes cascades to every edge touching them — nodes (including
  // relationship targets) are always scoped to this memoryUserId at creation.
  const [chunks] = await Promise.all([
    db.delete(memoryChunks)
      .where(eq(memoryChunks.memoryUserId, memUser.id))
      .returning({ id: memoryChunks.id }),
    db.delete(staticDocuments)
      .where(eq(staticDocuments.memoryUserId, memUser.id)),
    db.delete(entityNodes)
      .where(eq(entityNodes.memoryUserId, memUser.id)),
  ]);

  // Evict caches so the wiped profile can't be served for the remaining TTL:
  // per-user context (60s) and the team-wide profile that merged this user's facts (5 min)
  await Promise.all([
    invalidateUserCache(memUser.id),
    invalidateWorkspaceProfileCache(ctx.developerId),
  ]);

  console.log(`[v1/memory] Deleted ${chunks.length} chunks for user ${userId} (workspace ${ctx.workspaceId})`);
  return c.json({ deleted: chunks.length });
});

// ─── DELETE /v1/user ─────────────────────────────────────────────────────────
// GDPR hard-delete: removes the memoryUser row and all child data for a given
// (developerId, userId) pair. Cascading FKs on memoryChunks, staticDocuments,
// and entityNodes handle the child rows. After deletion the per-user context
// cache and the workspace profile cache are evicted so stale data is never served.

v1Routes.delete("/user", async (c) => {
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "admin");
  if (denied) return denied;

  // Accept userId from body or query param — consistent with other v1 endpoints
  let userId: string | undefined;
  const qUserId = c.req.query("userId");
  if (qUserId) {
    userId = qUserId;
  } else {
    try {
      const body = await c.req.json() as { userId?: unknown };
      if (typeof body.userId === "string") userId = body.userId;
    } catch {
      // fall through — missing userId caught below
    }
  }

  if (!userId) return c.json({ error: "userId required" }, 400);
  if (userId.length > 256) return c.json({ error: "userId too long" }, 400);

  const memUser = await db.query.memoryUsers.findFirst({
    where: and(
      eq(memoryUsers.developerId, ctx.developerId),
      eq(memoryUsers.externalId, userId)
    ),
  });

  if (!memUser) return c.json({ deleted: true });

  // Hard-delete the memoryUsers row — FK cascades handle child tables:
  //   memoryChunks (memory_user_id → memory_users.id ON DELETE CASCADE)
  //   staticDocuments (memory_user_id → memory_users.id ON DELETE CASCADE)
  //   entityNodes (memory_user_id → memory_users.id ON DELETE CASCADE)
  //   entityEdges (from_entity_id/to_entity_id → entity_nodes.id ON DELETE CASCADE)
  await db.delete(memoryUsers).where(eq(memoryUsers.id, memUser.id));

  // Evict caches so no stale data is served
  await Promise.all([
    invalidateUserCache(memUser.id),
    invalidateWorkspaceProfileCache(ctx.developerId),
  ]);

  console.log(`[v1/user] Hard-deleted memoryUser ${memUser.id} (externalId=${userId}, workspace=${ctx.workspaceId})`);
  return c.json({ deleted: true });
});

// ─── GET /v1/ledger ──────────────────────────────────────────────────────────
// The as-of ledger fold: cited, trust-tiered claims for a topic, reconstructed at
// any (valid-time, knowledge-time) coordinate. "Give me the correct organizational
// context for this task, as of this moment." Read-only over the attestation ledger.
v1Routes.get("/ledger", async (c) => {
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "ledger");
  if (denied) return denied;

  const rl = await checkRateLimit(`context:${ctx.developerId}`, CONTEXT_RATE_LIMIT);
  if (!rl) return c.json({ error: "Rate limit exceeded — 60 ledger calls/minute" }, 429, { "Retry-After": "60" });

  const asOf = parseAsOf(c.req.query("asOf"));
  if (!asOf.ok) return c.json({ error: asOf.error }, 400);
  const asOfKnowledge = parseAsOf(c.req.query("asOfKnowledge"));
  if (!asOfKnowledge.ok) return c.json({ error: asOfKnowledge.error.replace("asOf", "asOfKnowledge") }, 400);

  const view = await reconstructLedger(ctx.workspaceId, {
    domain: c.req.query("domain") ?? undefined,
    asOf: asOf.value,
    asOfKnowledge: asOfKnowledge.value,
  });
  return c.json(view);
});

// ─── GET /v1/ledger/divergences ──────────────────────────────────────────────
// Where the documented process and observed behaviour disagree, with the change
// date — the unique doc-vs-reality view only the bi-temporal ledger can produce.
v1Routes.get("/ledger/divergences", async (c) => {
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "ledger");
  if (denied) return denied;

  const rl = await checkRateLimit(`context:${ctx.developerId}`, CONTEXT_RATE_LIMIT);
  if (!rl) return c.json({ error: "Rate limit exceeded — 60 ledger calls/minute" }, 429, { "Retry-After": "60" });

  const divergences = await computeDivergences(ctx.workspaceId, { domain: c.req.query("domain") ?? undefined });
  return c.json({ divergences });
});

// ─── GET /v1/ledger/timeline ─────────────────────────────────────────────────
// A chronological record of when each answer was adopted and superseded.
v1Routes.get("/ledger/timeline", async (c) => {
  const ctx = await authenticate(c.req.header("authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const denied = requireScope(c, ctx, "ledger");
  if (denied) return denied;

  const rl = await checkRateLimit(`context:${ctx.developerId}`, CONTEXT_RATE_LIMIT);
  if (!rl) return c.json({ error: "Rate limit exceeded — 60 ledger calls/minute" }, 429, { "Retry-After": "60" });

  const timeline = await computeTimeline(ctx.workspaceId, { domain: c.req.query("domain") ?? undefined });
  return c.json({ timeline });
});
