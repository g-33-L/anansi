# API Reference

This reference covers the public developer API and operational endpoints. `/v1/*` endpoints require `Authorization: Bearer ans_...` unless noted. Every `/v1/*` response includes an `API-Version: v1` header.

Base URL: `https://anansimemory.com` (hosted) or your self-hosted instance.

## Authentication and key scopes

A key may optionally be narrowed to a subset of scopes when it is created in the
console. **A key with no scopes is unrestricted** — that is the default, and it
is what every key minted before scoping existed carries.

| Scope | Grants |
| --- | --- |
| `ingest` | `POST /v1/ingest`, `POST /v1/ingest/batch` |
| `read` | `GET /v1/context`, `POST /v1/search`, `GET /v1/memories` |
| `entities` | `GET /v1/entities` |
| `ledger` | `GET /v1/ledger`, `/v1/ledger/divergences`, `/v1/ledger/timeline` |
| `admin` | `DELETE /v1/memory`, `DELETE /v1/user` |

Calling an endpoint outside a scoped key's grants returns **`403`** — not `401`,
because the credential is valid and retrying authentication will not help:

```json
{
  "error": "This API key is not authorized for \"ingest\" operations.",
  "code": "insufficient_scope",
  "required_scope": "ingest",
  "key_scopes": ["read"]
}
```

This applies to every `/v1` endpoint below and is omitted from their individual
error tables.

---

## POST /v1/ingest

Store content in a user's memory.

```bash
curl -X POST https://anansimemory.com/v1/ingest \
  -H "Authorization: Bearer ans_..." \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "content": "User asked about retry logic for webhooks. Uses BullMQ.",
    "sourceType": "conversation"
  }'
# → 202 { "id": "...", "queued": true }
```

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | Yes | Your internal user ID, max 256 chars |
| `content` | `string` | Yes | Text to remember, max 100 KB |
| `sourceType` | `string` | No | Caller-defined source label. `conversation`, `voice`, `action`, `agent_summary`, `onboarding`, `meeting`, and `meeting_transcript` select built-in chunking behaviour; other labels use API-text chunking and are preserved in metadata. |
| `sourceId` | `string` | No | Stable source reference (max 256 chars, regex: `[a-zA-Z0-9:_./-]+`). Long content may create chunk IDs with `:0`, `:1`, etc.; it is not an idempotency key. |
| `metadata` | `object` | No | Up to 20 scalar fields (keys ≤64 chars; strings ≤1024 chars). Nested objects and arrays are discarded. System fields such as `author`, `timestamp`, and `sourceType` take precedence. |
| `embedding` | `number[]` | No | Pre-computed 768-dim embedding. Skips the internal embedding provider |
| `sessionId` | `string` | No | Scope this ingest to a conversation session |
| `agentId` | `string` | No | Scope this ingest to a specific agent |
| `ttl` | `number` | No | Time-to-live in seconds (1 to ~315M). Chunks auto-delete after expiry |
| `embeddingModel` | `string` | No | Label recorded with a supplied pre-computed embedding. |
| `entityContext` | `string` | No | Extra entity-graph context, at most 500 characters (Pro+). |

### Response

```json
{ "id": "uuid", "queued": true }
```

Status: `202 Accepted`

### URL ingestion

Pass a URL as `content` and Anansi fetches and ingests the page content automatically:

```json
{ "userId": "user_123", "content": "https://example.com/article" }
```

### Errors

| Status | Meaning |
|---|---|
| `400` | Invalid request (missing userId, content too large, invalid sourceId format) |
| `401` | Invalid or missing API key |
| `402` | Monthly quota exceeded |
| `413` | Content exceeds 100 KB |
| `429` | Rate limit exceeded (100 req/min) |

---

## POST /v1/ingest/batch

Ingest up to 50 items in a single request. Each item is processed independently, and the response includes an array of IDs corresponding to the input items.

```bash
curl -X POST https://anansimemory.com/v1/ingest/batch \
  -H "Authorization: Bearer ans_..." \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "userId": "user_123", "content": "First fact about user 123" },
      { "userId": "user_456", "content": "Fact for user 456" }
    ]
  }'
# → 202 { "queued": 2, "ids": ["...", "..."] }
```

### Request body

The request body is a JSON object with an `items` field, which is an array of objects. Each object accepts `userId`, `content`, `sourceType`, `sourceId`, `metadata`, `sessionId`, `agentId`, `ttl`, and `entityContext`. `userId` and `content` are required. Bring-your-own embeddings and URL fetching are single-ingest features and are not supported by this batch endpoint.

| Field | Type | Required | Description |
|---|---|---|---|
| `items` | `array` | Yes | An array of up to 50 ingest items. Each item is an object with `userId`, `content`, and optional fields like `sourceType`, `sourceId`, `metadata`, `embedding`, `sessionId`, `agentId`, `ttl`. |

**Each item in `items` supports:**

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | Yes | Your internal user ID, max 256 chars |
| `content` | `string` | Yes | Text to remember, max 100 KB |
| `sourceType` | `string` | No | Caller-defined source label; recognised labels select built-in chunking behaviour. |
| `sourceId` | `string` | No | Stable source reference; not an idempotency key. |
| `metadata` | `object` | No | Up to 20 scalar metadata fields; nested objects and arrays are discarded. |
| `sessionId` | `string` | No | Scope this ingest to a conversation session |
| `agentId` | `string` | No | Scope this ingest to a specific agent |
| `ttl` | `number` | No | Time-to-live in seconds (1 to ~315M). Chunks auto-delete after expiry |
| `entityContext` | `string` | No | Extra entity-graph context, at most 500 characters (Pro+; omitted for lower tiers) |

### Response

```json
{ "queued": 2, "ids": ["uuid1", "uuid2"] }
```

*   `queued`: The number of items successfully queued for ingestion.
*   `ids`: An array of `sourceId`s for the ingested items, in the same order as the input `items`. If an item fails validation, its corresponding entry in `ids` will be an empty string `""`.

Status: `202 Accepted`

### Errors

| Status | Meaning |
|---|---|
| `400` | Invalid request (e.g., `items` not an array, too many items, invalid item fields) |
| `401` | Invalid or missing API key |
| `402` | Monthly ingest quota exceeded (whole batch rejected if any item exceeds quota) |
| `429` | Rate limit exceeded (100 req/min, costed per item) |

---

## GET /v1/context

Retrieve synthesized memory context for a user.

```bash
curl "https://anansimemory.com/v1/context?userId=user_123&q=what+are+they+building" \
  -H "Authorization: Bearer ans_..."
```

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | Yes | Your internal user ID. Not required when `scope=workspace` |
| `q` | `string` | No | Query for relevant chunk retrieval (max 2000 chars). Relevant chunks are capped at 8 |
| `scope` | `string` | No | `user` (default) or `workspace` for the team-wide profile (Pro+) |
| `alpha` | `number` | No | `1.0` = pure vector, `0.0` = pure keyword. Omit for RRF merge. Values ≠ 1.0 require hybrid search (Pro+) |
| `threshold` | `number` | No | Minimum similarity score (0.0–1.0) |
| `filters` | `string` | No | JSON-encoded metadata filter (Pro+) |
| `sessionId` | `string` | No | Restrict retrieval to a session |
| `asOf` | `string` | No | Point-in-time snapshot (ISO 8601) — profile as of this time (Pro+) |
| `asOfKnowledge` | `string` | No | Knowledge-time snapshot for entity graph (ISO 8601, Pro+) |

### Response

```json
{
  "static": [
    "Senior engineer at Acme Corp",
    "Prefers TypeScript over Python"
  ],
  "dynamic": [
    "Currently building a voice agent",
    "Last session: debugging BullMQ retry logic"
  ],
  "relevant": [
    {
      "content": "User mentioned they use BullMQ for async job processing...",
      "similarity": 0.94,
      "metadata": { "timestamp": "2026-06-07T..." }
    }
  ],
  "temporal": [
    { "fact": "Worked at Acme Corp", "validFrom": "2024-01-01", "validUntil": "2025-03-31" }
  ],
  "entities": [
    { "name": "BullMQ", "type": "tool", "summary": "Used for async job processing" }
  ]
}
```

Status: `200 OK`

### Metadata filters

```json
{
  "metadata": {
    "sourceType": "conversation",
    "timestamp": { "$gte": "2026-01-01" },
    "$and": [
      { "author": "alice" },
      { "importance": { "$gte": 5 } }
    ]
  }
}
```

Supported operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$contains`, `$and`, `$or`.

### Errors

| Status | Meaning |
|---|---|
| `400` | Invalid request (missing userId, invalid filters) |
| `401` | Invalid or missing API key |
| `402` | Monthly quota exceeded |
| `429` | Rate limit exceeded (60 req/min) |

---

## POST /v1/search

Search memory chunks directly — raw scored results without synthesis.

```bash
curl -X POST https://anansimemory.com/v1/search \
  -H "Authorization: Bearer ans_..." \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "query": "webhook retry logic",
    "searchMode": "hybrid",
    "limit": 10
  }'
```

### Request body

| Field | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | Yes | Your internal user ID |
| `query` | `string` | Yes | Query text, max 2000 chars |
| `searchMode` | `string` | No | `semantic`, `hybrid` (default), `keyword` |
| `alpha` | `number` | No | `1.0` = pure vector, `0.0` = pure keyword |
| `threshold` | `number` | No | Minimum similarity (0.0–1.0) |
| `limit` | `number` | No | Max results (default 8, max 50) |
| `filters` | `object` | No | JSONB metadata filters (Pro+) |
| `sourceId` | `string` | No | Scope to one ingested document |
| `sessionId` | `string` | No | Restrict to a session |

### Response

```json
{
  "results": [
    {
      "content": "User mentioned they use BullMQ...",
      "score": 0.94,
      "sourceId": "api:ws_abc:user_123:...",
      "metadata": { "sourceType": "conversation", "timestamp": "..." }
    }
  ],
  "total": 1
}
```

### Errors

| Status | Meaning |
|---|---|
| `400` | Invalid request |
| `401` | Invalid or missing API key |
| `402` | Monthly quota exceeded |
| `429` | Rate limit exceeded (60 req/min) |

---

## GET /v1/memories

Paginated list of raw memory chunks. Ranked by hybrid search when `q` is given; otherwise sorted by recency.

```bash
curl "https://anansimemory.com/v1/memories?userId=user_123&sourceType=conversation&limit=20" \
  -H "Authorization: Bearer ans_..."
```

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | Yes | Your internal user ID |
| `q` | `string` | No | Optional query for ranked results |
| `sourceType` | `string` | No | Filter by source type |
| `limit` | `number` | No | Page size (default 20, max 100) |
| `offset` | `number` | No | Pagination offset |

### Response

```json
{
  "memories": [
    {
      "id": "chunk-uuid",
      "content": "User asked about retry logic for webhooks...",
      "sourceType": "conversation",
      "metadata": { "timestamp": "..." },
      "createdAt": "2026-06-07T..."
    }
  ],
  "total": 142,
  "limit": 20,
  "offset": 0
}
```

### Errors

| Status | Meaning |
|---|---|
| `400` | Invalid request |
| `401` | Invalid or missing API key |
| `402` | Monthly quota exceeded |
| `429` | Rate limit exceeded (60 req/min) |

---

## GET /v1/entities

Entities and bi-temporal relationships extracted from memory. Entities accumulate across ingest calls; edges carry valid-time boundaries for historical tracking.

```bash
curl "https://anansimemory.com/v1/entities?userId=user_123" \
  -H "Authorization: Bearer ans_..."
```

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | Yes | Your internal user ID |
| `asOf` | `string` | No | Valid-time snapshot (`YYYY-MM-DD` or ISO 8601) |
| `asOfKnowledge` | `string` | No | Knowledge-time snapshot |

Combining both gives a bi-temporal point query: "what did we know was true at this instant?"

### Response

```json
{
  "entities": [
    {
      "name": "BullMQ",
      "type": "tool",
      "summary": "Used for async job processing",
      "edges": [
        {
          "relation": "uses",
          "target": "Redis",
          "validFrom": "2026-01-15",
          "validUntil": null,
          "recordedAt": "2026-01-15"
        }
      ]
    }
  ]
}
```

### Errors

| Status | Meaning |
|---|---|
| `400` | Invalid request |
| `401` | Invalid or missing API key |
| `402` | Monthly quota exceeded |
| `429` | Rate limit exceeded (60 req/min) |

---

## DELETE /v1/memory

Delete a user's memory. Pass `userId` to wipe all chunks, the synthesized profile, and the entity graph. Add `sourceId` to delete only chunks from one ingested document. The `memoryUsers` row is kept so you can re-ingest. Caches are evicted on delete.

```bash
curl -X DELETE "https://anansimemory.com/v1/memory?userId=user_123" \
  -H "Authorization: Bearer ans_..."
# → { "deleted": 7 }
```

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | Yes | User whose memory to delete |
| `sourceId` | `string` | No | Delete only chunks from this ingested document |

### Response

```json
{ "deleted": 7 }
```

The `deleted` field is the **count** of chunks removed (not a boolean).

Status: `200 OK`

### Errors

| Status | Meaning |
|---|---|
| `400` | Missing userId |
| `401` | Invalid or missing API key |

---

## DELETE /v1/user

GDPR hard-delete. Removes the `memoryUsers` row and all cascaded child data (chunks, profile, entity graph) via foreign key cascades. Evicts per-user and workspace-profile caches. Idempotent — deleting an unknown `userId` still returns success.

```bash
curl -X DELETE "https://anansimemory.com/v1/user?userId=user_123" \
  -H "Authorization: Bearer ans_..."
# → { "deleted": true }
```

`userId` may be passed as a query param or in the JSON body.

### Response

```json
{ "deleted": true }
```

Status: `200 OK`

### Errors

| Status | Meaning |
|---|---|
| `400` | Missing userId |
| `401` | Invalid or missing API key |

---

## GET /v1/ledger

Reconstruct the ledger — cited, trust-tiered claims for a workspace — at any point in time. The ledger stores attestations, each backed by a verbatim quote in a source chunk, and is bi-temporal and append-only. With `asOfKnowledge`, answers reflect what was *believed* at that instant; with `asOf`, what was *true*; with neither, the current ledger. When one question (`claimKey`) has more than one distinct active answer, those answers also appear under `disputes`.

```bash
curl "https://anansimemory.com/v1/ledger?domain=deploys&asOf=2026-04-01" \
  -H "Authorization: Bearer ans_..."
```

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `domain` | `string` | No | Restrict the fold to a single domain. Omit for the whole ledger |
| `asOf` | `string` | No | Valid-time coordinate (`YYYY-MM`, `YYYY-MM-DD`, or ISO 8601) — what was true at this instant |
| `asOfKnowledge` | `string` | No | Knowledge-time coordinate — what the system believed at this instant |

### Response

```json
{
  "workspaceId": "ws_abc",
  "domain": "deploys",
  "asOf": "2026-04-01T00:00:00.000Z",
  "asOfKnowledge": null,
  "claims": [
    {
      "claim": "Prod deploys require two approvals",
      "claimKey": "deploy.approvals",
      "claimFingerprint": "a1b2c3",
      "claimType": "policy",
      "status": "observed",
      "disputed": false,
      "confidence": 0.92,
      "validFrom": "2026-03-01T00:00:00.000Z",
      "validFromBasis": "stated",
      "evidence": [
        { "chunkId": "chunk-uuid", "quote": "all prod deploys need two approvals", "sourceType": "notion_page" }
      ],
      "recordedAt": "2026-03-02T09:00:00.000Z"
    }
  ],
  "disputes": []
}
```

Each claim's `status` is its trust tier (`observed` or `candidate`); `validFromBasis` is `stated` when a date was given in the source, otherwise `recorded`. A `dispute` entry has the shape `{ "claimKey": "...", "answers": [ ...competing claims... ] }`.

Status: `200 OK`

### Errors

| Status | Meaning |
|---|---|
| `400` | Invalid `asOf` or `asOfKnowledge` date |
| `401` | Invalid or missing API key |
| `429` | Rate limit exceeded (60 req/min) |

---

## GET /v1/ledger/divergences

Where a **documented** answer (wiki, runbook, Notion) disagrees with the **observed** reality (chat, tickets) for the same `claimKey` — the doc-vs-reality view only a bi-temporal ledger can produce. Reads full history, so it catches documented answers the ledger has already superseded.

```bash
curl "https://anansimemory.com/v1/ledger/divergences?domain=deploys" \
  -H "Authorization: Bearer ans_..."
```

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `domain` | `string` | No | Restrict to a single domain. Omit to scan all domains |

### Response

```json
{
  "divergences": [
    {
      "claimKey": "deploy.approvals",
      "documented": {
        "claim": "Prod deploys require two approvals",
        "fingerprint": "a1b2c3",
        "validFrom": "2026-01-01T00:00:00.000Z",
        "evidence": [{ "chunkId": "c1", "quote": "two approvals", "sourceType": "notion_page" }]
      },
      "observed": {
        "claim": "Prod deploys ship with one approval",
        "fingerprint": "d4e5f6",
        "validFrom": "2026-04-01T00:00:00.000Z",
        "evidence": [{ "chunkId": "c2", "quote": "just LGTM and merge", "sourceType": "conversation" }]
      },
      "changedAt": "2026-04-01T00:00:00.000Z"
    }
  ]
}
```

`changedAt` is when practice changed: the observed answer's stated start date if given, otherwise the moment the documented answer was superseded (may be `null`).

Status: `200 OK`

### Errors

| Status | Meaning |
|---|---|
| `401` | Invalid or missing API key |
| `429` | Rate limit exceeded (60 req/min) |

---

## GET /v1/ledger/timeline

A chronological record of when each answer was adopted and (if closed) superseded. `adopted` uses a stated start date when one exists, otherwise the moment the claim was first recorded — never an invented date. Sorted ascending by time.

```bash
curl "https://anansimemory.com/v1/ledger/timeline?domain=deploys" \
  -H "Authorization: Bearer ans_..."
```

### Query parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `domain` | `string` | No | Restrict to a single domain. Omit for all domains |

### Response

```json
{
  "timeline": [
    { "at": "2026-01-01T00:00:00.000Z", "claimKey": "deploy.approvals", "claim": "Prod deploys require two approvals", "fingerprint": "a1b2c3", "kind": "adopted" },
    { "at": "2026-04-01T00:00:00.000Z", "claimKey": "deploy.approvals", "claim": "Prod deploys require two approvals", "fingerprint": "a1b2c3", "kind": "superseded" }
  ]
}
```

`kind` is `adopted` or `superseded`. `claimKey` may be `null` for claims that carry no shared question key.

Status: `200 OK`

### Errors

| Status | Meaning |
|---|---|
| `401` | Invalid or missing API key |
| `429` | Rate limit exceeded (60 req/min) |

---

## GET /health

Public process-liveness endpoint. No authentication required. It returns JSON and does not probe Postgres or Redis.

```bash
curl https://anansimemory.com/health
# → { "status": "ok", "version": "0.3.0" }
```

## GET /status

Public dependency-status page. No authentication required. It returns HTML with the Postgres, Redis, and queue checks; its status is `200` only when Postgres and Redis are reachable, otherwise `503`.

```bash
curl -I https://anansimemory.com/status
# → HTTP/2 200
```

## GET /metrics

Internal operational endpoint. It returns embedding-provider counters only when the caller sends `Authorization: Bearer <QUERY_API_KEY>`; all other requests receive `401`. It is not an application API key endpoint.

## Skills

Skills are currently an internal, experimental extraction schema (`apps/api/src/lib/skill/schema.ts`), not a served public REST API. There are no `/v1/skills*` endpoints in this release. Do not build an integration against a skills endpoint until one is documented here.

---

## Rate limits

| Endpoint | Limit |
|---|---|
| `POST /v1/ingest` | 100 req/min |
| `POST /v1/ingest/batch` | 100 items/min (each item consumes one unit) |
| `GET /v1/context` | 60 req/min |
| `POST /v1/search` | 60 req/min |
| `GET /v1/memories` | 60 req/min |
| `GET /v1/entities` | 60 req/min |
| `GET /v1/ledger` | 60 req/min |
| `GET /v1/ledger/divergences` | 60 req/min |
| `GET /v1/ledger/timeline` | 60 req/min |

Rate limits are per-workspace (per API key). Exceeding the limit returns `429` with a `Retry-After` header.

## Monthly quotas

| Plan | Ingest / month | Context / month |
|---|---|---|
| Free | 1,000 | 500 |
| Pro ($19/mo) | 25,000 | 10,000 |
| Scale ($99/mo) | 250,000 | 100,000 |
| Enterprise | Unlimited | Unlimited |

Exceeding the monthly quota returns `402` with an upgrade message (distinct from `429` rate limiting).

## API versioning

All public developer API routes are prefixed with `/v1`. Within a major version Anansi will not make breaking changes. Breaking changes will be introduced under a new prefix (e.g., `/v2`) with a 90-day deprecation notice. Every `/v1` response includes `API-Version: v1`.
