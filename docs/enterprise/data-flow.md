# Data Flow

How data moves through Anansi — from ingestion to retrieval — and what happens at each stage.

## Overview

```
                          ┌─────────────────────────────────┐
                          │         Anansi Engine             │
  POST /v1/ingest ──────► │  sanitize → chunk → embed →     │
                          │  memory_chunks (pgvector)        │
                          │         ▼                        │
  Slack events ─────────► │  synthesis worker (LLM)          │
  Notion sync ──────────► │  static_facts + dynamic_context  │
  Google Docs sync ─────► │         ▼                        │
  Linear webhook ───────► │  GET /v1/context                 │◄── LLM app
  Transcript webhook ───► │  hybrid search (BM25 + vector)   │
                          │  → RRF merge → synthesized ctx   │
                          └─────────────────────────────────┘
```

## Ingestion flow

### 1. Receive content

A developer calls `POST /v1/ingest` (or a connector delivers content via webhook). The request is authenticated via API key (`Authorization: Bearer ans_...`).

**Rate limiting:** Sliding-window check via Redis (atomic Lua script). Plan-dependent limits.

**Quota check:** Monthly API call counter incremented atomically. Returns `402` if quota exceeded.

### 2. Sanitize

Content passes through `lib/utils/sanitize.ts`, which redacts secrets:

- API keys (`ans_...`)
- OAuth tokens
- Slack bot tokens
- Email addresses (configurable)

Sanitized content is what gets stored — raw secrets never persist.

### 3. Chunk

`lib/ai/chunker.ts` splits content into semantically meaningful chunks:

- **API text** (`api_text`): sentence-aware chunking with overlap
- **Meeting transcripts** (`meeting_transcript`): speaker-boundary-aware chunking

Chunk size and overlap are tuned per source type to optimize retrieval quality.

### 4. Embed

`lib/ai/embed.ts` generates 768-dim vectors for each chunk:

1. **Nomic** (`nomic-embed-text-v1.5`) — if `NOMIC_API_KEY` is set
2. **Ollama** (`nomic-embed-text`) — local fallback

Alternatively, the caller can pass a pre-computed `embedding` array on ingest to skip the internal embedding step entirely.

### 5. Store

Chunks are written to `memory_chunks` with:

- The embedding vector (pgvector `vector(768)` type)
- Content text
- Metadata (sourceType, sourceId, timestamp, custom fields)
- Workspace and user scoping
- Optional TTL (`expires_at`)

Idempotency: if `sourceId` is provided and already exists, the ingest is a no-op.

### 6. Trigger synthesis (async)

After ingest, a synthesis job is enqueued to BullMQ. The synthesis worker:

1. Waits until the user has enough new chunks (threshold: `SYNTHESIS_THRESHOLD`, default 25)
2. Acquires a PostgreSQL advisory lock (one synthesis per user at a time)
3. Reads all chunks for the user
4. Calls the LLM to extract:
   - **Static facts** (≤30) — stable, deduplicated truths
   - **Dynamic context** (≤15) — current state and recent activity
   - **Entities** — nodes and edges for the bi-temporal knowledge graph
5. Stores results in `staticDocuments` (synthesized profile) and `entity_nodes`/`entity_edges`

Synthesis is fire-and-forget from the ingest caller's perspective — `POST /v1/ingest` returns `202` immediately.

## Retrieval flow

### 1. Receive query

A developer calls `GET /v1/context` (synthesized) or `POST /v1/search` (raw chunks).

**Cache check:** Redis-backed context cache (60s TTL). If a cached response exists for this user + query combination, return it immediately.

### 2. Search (when `q` is provided)

`lib/ai/query-engine.ts` runs hybrid search:

1. **Semantic search:** pgvector nearest-neighbor on the embedding column
2. **Keyword search:** PostgreSQL full-text search (tsvector + GIN index)
3. **RRF merge:** Reciprocal Rank Fusion combines the two result lists

The `alpha` parameter controls the blend: `1.0` = pure vector, `0.0` = pure keyword. Omitting `alpha` uses RRF merge.

**Filters:** JSONB metadata filters (`$gte`, `$lte`, `$contains`, `$and`, `$or`) are translated to SQL WHERE clauses.

**Session scoping:** `sessionId` restricts results to a specific conversation.

### 3. Synthesize response

For `GET /v1/context`:

1. Fetch the stored synthesized profile (`staticDocuments`) — static facts + dynamic context
2. If `q` is provided, include the top-ranked relevant chunks
3. If entity graph access is enabled (Pro+), include temporal facts and entity summaries
4. Return the combined response: `{ static, dynamic, relevant, temporal, entities }`

For `POST /v1/search`: return raw scored chunks without synthesis.

### 4. Cache and return

The synthesized context is cached in Redis (60s TTL) and returned to the caller.

## Entity graph flow

The entity graph is built during synthesis and queried separately:

### Building (during synthesis)

1. LLM extracts entity nodes (people, organizations, tools, concepts) from chunks
2. LLM extracts edges (relationships between entities) with:
   - **Valid-time** boundaries (`valid_from`, `valid_until`) — when the relationship was true
   - **Knowledge-time** boundaries (`recorded_at`, `valid_until_recorded_at`) — when we learned it
3. Edges are upserted into `entity_edges`, nodes into `entity_nodes`

### Querying

`GET /v1/entities` reconstructs the graph at a point in time:

- `asOf` — valid-time snapshot: what was true at this instant?
- `asOfKnowledge` — knowledge-time snapshot: what did we know at this instant?
- Both combined — bi-temporal point query: what did we know was true at this instant?

See [core-concepts.md](../product/core-concepts.md) for the full explanation of bi-temporal queries.

## Connector flows

Connectors feed content into the same ingestion pipeline:

| Connector | Trigger | Content source |
|---|---|---|
| **Slack** | Real-time events (message posted) | Channel messages, thread replies |
| **Notion** | Periodic sync (configurable) | Page content, database entries |
| **Google Docs** | Webhook (document updated) | Document body |
| **Linear** | Webhook (issue created/updated) | Issue title + description + comments |
| **Transcript** | Webhook (meeting ended) | Fireflies / Otter / Grain / Fathom transcript |

All connector content passes through the same sanitize → chunk → embed → store pipeline as API ingests. The `sourceType` is set appropriately (e.g., `meeting_transcript` for transcript webhooks).

## Retention flow

The daily retention sweep (`workers/retention.ts`) runs once per day:

1. Delete chunks where `expires_at` has lapsed (caller-controlled TTL)
2. Delete all chunks past the plan retention window (Free: 7 days)
3. Delete synthesized profiles for users with no remaining chunks

Pro+ plans have no automatic expiry unless the caller sets a TTL.

## Cache invalidation

Caches are invalidated on:

- `DELETE /v1/memory` — per-user context cache evicted
- `DELETE /v1/user` — per-user and workspace-profile caches evicted
- Synthesis completion — workspace-profile cache evicted (new facts may change the workspace profile)
