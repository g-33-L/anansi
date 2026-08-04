# System Overview

Anansi is a single codebase that deploys as two processes (API and worker) backed by PostgreSQL (pgvector) and Redis.

## High-level architecture

```
                           ┌─────────────────────────────────┐
                           │         Anansi Engine             │
  POST /v1/ingest ───────► │  sanitize → chunk → embed →     │
                           │  memory_chunks (pgvector)        │
                           │         ▼                        │
  Slack events ──────────► │  synthesis worker (LLM)          │
  Notion sync ───────────► │  static_facts + dynamic_context  │
  Google Docs sync ──────► │         ▼                        │
  Linear webhook ────────► │  GET /v1/context                 │◄── LLM app
  Transcript webhook ────► │  hybrid search (BM25 + vector)   │
                           │  → RRF merge → synthesized ctx   │
                           └─────────────────────────────────┘
```

## Technology stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22 + TypeScript |
| API framework | Hono |
| Database | PostgreSQL 16 + pgvector |
| ORM | Drizzle |
| Queue | BullMQ + Redis |
| LLM | Provider chain: Cerebras → GitHub Models → Ollama (local) |
| Embeddings | Nomic `nomic-embed-text-v1.5` (768-dim) → Ollama fallback |
| Deployment | Railway (hosted) or Docker Compose (self-hosted) |

## Two deployable processes

Both processes are built from the same codebase (`apps/api/Dockerfile`):

### API process (`src/index.ts`)

- Boots the Hono HTTP server (`createApp()` in `src/app.ts`)
- Starts all core BullMQ workers **in-process**: embedding, ingestion, synthesis, retention, backfill, plus connector workers when configured
- Serves the developer portal (`/portal`), docs site (`/docs`), landing page (`/`), and all `/v1/*` API routes
- Health-checked at `/health`, status page at `/status`

### Worker process (`src/worker-entry.ts`) — optional scale-out

- Starts exactly **one** BullMQ worker per process, selected by `WORKER_ROLE` env var
- Available roles: `ingestion`, `synthesis`, `backfill`, `notion`, `google-docs`, `embed`
- Add instances per role when a queue needs dedicated capacity
- BullMQ distributes jobs safely alongside the in-process workers

In production (Railway), the API process runs everything. The worker process exists for cases where synthesis or embedding load needs isolated capacity.

## Module map

```
apps/api/src/
├── app.ts             App wiring, security headers, /status, /metrics, sitemap
├── index.ts           HTTP entry point (+ retention sweep on startup)
├── worker-entry.ts    Worker entry point (WORKER_ROLE dispatch)
├── routes/            HTTP surfaces
│   ├── v1.ts          Public API (/v1/ingest, /v1/context, /v1/search, etc.)
│   ├── slack.ts       Slack bot (OAuth, events, slash commands)
│   ├── connectors.ts  Notion, Google Docs, Linear, Transcript connectors
│   ├── billing.ts     Stripe checkout + webhooks
│   ├── portal.tsx     Developer portal (API key management, settings)
│   ├── dashboard.tsx  Slack workspace dashboard
│   ├── landing.tsx    Marketing site
│   └── docs.tsx       Documentation site
├── workers/           BullMQ consumers
│   ├── embedding.ts   Fills in vectors for new chunks
│   ├── ingestion.ts   Processes Slack messages → chunks → embeds
│   ├── synthesis.ts   LLM-powered profile + entity graph generation
│   ├── retention.ts   TTL and plan-based data cleanup
│   ├── backfill.ts    Historical message import
│   └── connectors/    Notion, Google Docs, Linear sync workers
└── lib/
    ├── ai/            Core AI: query-engine, ingest-core, embed, llm, chunker, entity-graph, synthesis-prompt
    ├── auth/          api-auth (HMAC keys), portal-auth, dashboard-auth
    ├── billing/       plans, usage, feature-gate, stripe-meters
    ├── db/            schema, migrations, post-migration (HNSW indexes)
    ├── infra/         queue (BullMQ defs), cache, rate-limit, outbound-webhook, error-reporting
    ├── integrations/  Slack API client, Supabase client
    └── utils/         crypto (AES-GCM, HMAC), sanitize (redaction + prompt injection), mask
```

## Request lifecycle: ingest

1. `POST /v1/ingest` arrives → Bearer token validated via HMAC-SHA256 lookup
2. Rate limit checked (sliding-window Lua sorted set, 100/min)
3. Monthly quota checked and incremented
4. Content sanitized (secrets redacted) → chunked → inserted with NULL embedding
5. Embed job enqueued → request returns `202` immediately
6. Embedding worker fills in vectors (Nomic → Ollama)
7. Synthesis worker triggers when threshold reached → LLM generates profile + entity graph

## Request lifecycle: context

1. `GET /v1/context` arrives → authenticated
2. Rate limit checked (60/min) → monthly quota incremented
3. Redis cache checked (60s TTL for user, 5min for workspace profile)
4. On cache miss: synthesized profile loaded, hybrid search executed if query present
5. Response: `static` (≤30) + `dynamic` (≤15) + `relevant` chunks + `temporal` facts + `entities`

## Key invariants

- **Retrieval filters `embedding IS NOT NULL`**: un-embedded chunks are invisible rather than wrong
- **Tenant isolation is app-layer**: every query scopes by `workspace_id` / `developer_id`
- **Advisory locks for synthesis**: `pg_try_advisory_lock` ensures a user's synthesis runs at most once at a time
- **Cache keys encode all parameters**: different query options never share a cached result
