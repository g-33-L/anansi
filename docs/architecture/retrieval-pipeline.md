# Retrieval Pipeline

The retrieval pipeline serves two primary paths: synthesized context (`GET /v1/context`) and raw search (`POST /v1/search`).

## Synthesized context: `GET /v1/context`

This is the main retrieval path. It returns a profile ready to inject into a system prompt.

### Request flow

```
GET /v1/context?userId=...&q=...
  → authenticate
  → rate limit (60/min)
  → validate inputs + feature gates
  → charge monthly quota
  → lookup memoryUser
  → check Redis cache (60s TTL, keyed on all params)
  → on miss:
      → load synthesized profile (static_documents)
      → if q present: run hybrid search
      → annotate temporal facts with validity
      → annotate entities with current status
  → cache response
  → return JSON
```

### Response shape

```json
{
  "static": ["Senior engineer at Acme Corp", "Prefers TypeScript"],
  "dynamic": ["Currently building a voice agent"],
  "temporal": [
    { "fact": "Worked at Acme Corp", "validFrom": "2024-01-01", "validUntil": "2025-03-31", "current": false }
  ],
  "relevant": [
    { "content": "User mentioned BullMQ...", "similarity": 0.94, "metadata": {} }
  ],
  "entities": [
    { "name": "BullMQ", "type": "tool", "relationships": [...] }
  ]
}
```

- `static`: up to 30 curated, deduplicated facts (Pro+: full profile; Free: limited)
- `dynamic`: up to 15 current context items
- `temporal`: time-bounded facts annotated with `current` (Pro+ only)
- `relevant`: hybrid search hits when `q` is provided
- `entities`: extracted entity graph with relationships (Pro+ only)

### Free plan behavior

Free plans get vector-only retrieval (alpha=1, no BM25). Temporal facts and entity graph are stripped from the response.

### Caching

- User context: 60-second TTL, keyed on `userId + q + alpha + threshold + filters + sessionId + asOf + asOfKnowledge`
- Workspace profile: 5-minute TTL, keyed on `developerId`
- Different parameter combinations never share a cached result

## Raw search: `POST /v1/search`

Returns scored memory chunks without synthesis. Useful for building custom retrieval pipelines.

### Search modes

| Mode | Description |
|---|---|
| `semantic` | Vector cosine similarity only |
| `hybrid` (default) | BM25 + vector, merged via RRF |
| `keyword` | BM25 only |

### Hybrid search algorithm

1. **Vector search**: embed the query, find top-20 candidates by cosine distance (pgvector `<=>` operator), filter by threshold (default 0.7)
2. **BM25 search**: Postgres `ts_rank` with `plainto_tsquery('english', query)`, top-20 candidates
3. **Merge**: Reciprocal Rank Fusion (RRF) by default:
   - `score(chunk) = Σ 1/(60 + rank_i)` for each list the chunk appears in
   - K=60 balances rank contributions evenly
4. **Alpha-weighted** (optional): `finalScore = alpha * vectorScore + (1 - alpha) * bm25Score`

Source: `apps/api/src/lib/ai/query-engine.ts`

### Metadata filters

JSONB filters on the `metadata` column with operators:

| Operator | Description |
|---|---|
| `$gte`, `$lte`, `$gt`, `$lt` | Numeric comparison (with type guard) |
| `$contains` | JSONB containment |
| `$and`, `$or` | Logical combinators (max depth 5, max 50 conditions) |

Filters are compiled to parameterized SQL via Drizzle — values are never interpolated into the SQL string.

Source: `apps/api/src/lib/ai/query-engine.ts` (`buildFilterSQL`)

## Workspace context: `GET /v1/context?scope=workspace`

Synthesizes a team-wide profile across all memory users for a developer:

1. Loads per-user synthesized profiles (most recently updated first, max 100)
2. Loads the workspace-scoped profile (from Slack/connector synthesis)
3. If multiple sources: calls the LLM to merge into one team profile
4. On LLM failure: falls back to deterministic merge (dedupe + cap)
5. Caches for 5 minutes

The workspace profile captures shared patterns, common preferences, and team-wide context.

## Memory listing: `GET /v1/memories`

Paginated list of raw memory chunks:

- With `q`: ranked by hybrid search (up to 100 results), then sliced by offset/limit
- Without `q`: sorted by recency (newest first)
- Supports `sourceType` filter (requires Pro+ metadata filters)

## Entity retrieval: `GET /v1/entities`

Returns the full entity graph for a user:

1. Loads all nodes (max 500, most recently seen first)
2. Loads all edges for those nodes (max 5000)
3. Projects through bi-temporal filter in JavaScript:
   - Knowledge-time first: skip edges recorded after `asOfKnowledge`
   - Valid-time second: keep only edges active at `asOf`
   - Compute `current` relative to the query instant

Source: `apps/api/src/lib/ai/query-engine.ts` (`getEntitiesForUser`)

## Point-in-time queries

Both `GET /v1/context` and `GET /v1/entities` accept `asOf` and `asOfKnowledge` parameters:

- `asOf` (valid-time): reconstruct the graph/profile as it was valid at this instant
- `asOfKnowledge` (knowledge-time): reconstruct what was known at this instant
- Combine both for a full bi-temporal point query

Accepts `YYYY-MM`, `YYYY-MM-DD`, or full ISO 8601 strings.
