# Ingestion Pipeline

The ingestion pipeline transforms raw content into searchable, synthesizable memory chunks.

## Overview

```
POST /v1/ingest
  → authenticate (HMAC-SHA256 key lookup)
  → rate limit (100/min, sliding window)
  → monthly quota check
  → validate + sanitize content
  → [optional] URL fetch (SSRF-safe)
  → chunk (type-aware splitting)
  → insert with NULL embedding
  → enqueue embed jobs
  → return 202 immediately
  → [async] embedding worker fills vectors
  → [async] synthesis worker triggers when threshold reached
```

## Step-by-step

### 1. Authentication

The Bearer token is validated via HMAC-SHA256 lookup. A regex fast-reject filters malformed keys before any database hit.

Source: `apps/api/src/lib/auth/api-auth.ts`

### 2. Rate limiting

Redis-backed sliding-window sorted set in a single Lua script. 100 requests per minute per API key. Atomic and race-safe.

Source: `apps/api/src/lib/infra/rate-limit.ts`

### 3. Monthly quota

The workspace's monthly ingest call count is checked against the plan limit. Quota is incremented atomically. Calls beyond quota return `402` (vs `429` for per-minute rate limits).

Source: `apps/api/src/lib/billing/usage.ts`

### 4. Content processing

#### Sanitization

All content passes through secret redaction (`lib/utils/sanitize.ts`). Known patterns (Stripe keys, GitHub tokens, Slack tokens, AWS keys, PEM private keys, generic `password=...` assignments) are replaced with `[REDACTED]`.

40-character tokens are only redacted with nearby AWS/secret-key context — git commit SHAs and base64 strings pass through untouched.

#### URL ingestion

When the `content` field is a single http(s) URL (and no pre-computed embedding is supplied), the page is fetched server-side:

- SSRF guard resolves DNS and verifies all addresses are public
- 10-second timeout, 500 KB body cap, max 3 redirects
- Each redirect hop is re-validated against the SSRF policy
- HTML is stripped to plain text; title is extracted
- Pro+ feature (gated by plan)

Source: `apps/api/src/lib/url-ingest.ts`

### 5. Chunking

Type-aware chunking via `chunkBySourceType()`:

| Source type | Strategy |
|---|---|
| `notion_page`, `gdoc` | Split at markdown headings, then paragraphs |
| `meeting_transcript` | Split at speaker turns (`Name:` or `[HH:MM]` patterns) |
| `linear_issue` | Keep as single chunk (issues are small) |
| Everything else | Sentence-boundary splitting, 512 tokens max, 50 token overlap |

Default limits: 512 tokens per chunk (~2048 chars), 50 tokens overlap (~200 chars). The chunker includes a forward-progress guard to prevent infinite loops on adversarial inputs.

Source: `apps/api/src/lib/ai/chunker.ts`

### 6. Database insertion

Chunks are inserted immediately with **NULL embedding** via `insertChunks()`. This makes them invisible to search (which filters `embedding IS NOT NULL`) until the embedding worker fills them in.

Each chunk stores:
- The raw content (unchanged)
- Source metadata (author, timestamp, channel, source type)
- Any caller-supplied metadata (all keys are filterable)
- Session and agent IDs if provided
- An optional TTL (`expires_at`)

Idempotency: chunks with the same `(workspace_id, source_id)` are deduplicated via `ON CONFLICT DO NOTHING`.

Source: `apps/api/src/lib/ai/ingest-core.ts`

### 7. Embedding (async)

An `embed` job is enqueued for each chunk that doesn't have a pre-computed embedding. The embedding worker:

1. Reads the chunk from the database
2. Prepends a context header: `Title: ... | Source: ...\n\n<content>`
3. Calls the embedding provider (Nomic → Ollama fallback)
4. Updates the row with the 768-dim vector

Concurrency: 3 parallel embedding jobs.

Embedding caching: search-query embeddings are cached in Redis for 24 hours.

Source: `apps/api/src/lib/ai/embed.ts`, `apps/api/src/workers/embedding.ts`

### 8. Synthesis trigger

After ingest, a synthesis job is enqueued (deduped by job ID per user). Synthesis triggers when the unsynthesized chunk count reaches the threshold (`SYNTHESIS_THRESHOLD`, default 25).

The synthesis worker:

1. Acquires a Postgres advisory lock per user (prevents concurrent synthesis)
2. Reads up to 50 oldest unsynthesized chunks
3. Calls the LLM (Cerebras → GitHub Models → Ollama)
4. Updates the synthesized profile (`static_documents`)
5. Extracts and persists the entity graph
6. Fires the outbound webhook if configured
7. Re-enqueues if more chunks remain (backlog draining)

Source: `apps/api/src/workers/synthesis.ts`

## Bring-your-own embeddings

When a pre-computed `embedding` array is passed on `POST /v1/ingest`, the content is stored whole (no chunking) with the vector inline. No embed job is enqueued. The embedding must be exactly 768 dimensions.

## Batch ingest

`POST /v1/ingest/batch` accepts up to 50 items. Each item is independently chunked, embedded, and queued. Rate limit cost equals the number of items. Monthly quota is charged per item (not per request). All-or-nothing: the whole batch is rejected if it wouldn't fit under the cap.
