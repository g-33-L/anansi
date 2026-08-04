# Anansi Architecture

How the system fits together, for engineers working on this repo. The README covers *what* Anansi is and the API surface; this document covers *how* it works and *where things live*. Behavior claims here are verifiable in the referenced files.

## System overview

```
                       ┌──────────────────────── apps/api ────────────────────────┐
                       │                                                          │
 Your app ──ingest───► │  HTTP process (src/index.ts → createApp in app.ts)       │
 Your app ◄──context── │    routes/v1.ts        public API (/v1/*)                │
 Slack ───events─────► │    routes/slack.ts     Slack bot + OAuth                 │
 Notion/GDocs ─OAuth─► │    routes/connectors.ts, billing.ts, portal.tsx, …       │
 Linear/transcripts ─► │    routes/landing.tsx, docs.tsx   marketing + docs site  │
                       │        │ enqueue                                         │
                       │        ▼                                                 │
                       │  Redis (BullMQ queues, cache, rate limits)               │
                       │        │ consume                                         │
                       │        ▼                                                 │
                       │  Worker process (src/worker-entry.ts, WORKER_ROLE=…)     │
                       │    embed → synthesis → entity extraction → webhooks      │
                       │        │                                                 │
                       │        ▼                                                 │
                       │  PostgreSQL + pgvector (chunks, profiles, entity graph)  │
                       └──────────────────────────────────────────────────────────┘
```

Two deployable processes, one codebase:

- **API** — `src/index.ts` boots the Hono app (`createApp()` in `src/app.ts`) **and starts all core workers in-process** (embedding, ingestion, synthesis, backfill, retention, plus connector workers when their OAuth env is set). This is the deployed topology: one service does everything.
- **Worker (optional scale-out)** — `src/worker-entry.ts` starts exactly **one** BullMQ worker per process, selected by `WORKER_ROLE`: `ingestion | synthesis | backfill | notion | google-docs | embed`. Add instances per role when a queue needs dedicated capacity; BullMQ distributes jobs safely alongside the in-process workers.

## The two hot paths

### Ingest (`POST /v1/ingest` → routes/v1.ts)

1. Auth: Bearer `ans_…` key, HMAC-SHA256 lookup with a regex fast-reject before any DB hit (`lib/auth/api-auth.ts`).
2. Guardrails: rate limit (sliding-window Lua sorted set, `lib/infra/rate-limit.ts`), monthly quota (`lib/billing/usage.ts`), plan feature gates (`lib/billing/feature-gate.ts`), 100 KB cap.
3. Content passes through secret redaction (`lib/utils/sanitize.ts`); if it is a single http(s) URL, the page is fetched SSRF-safely and extracted (`lib/url-ingest.ts`, Pro+).
4. Chunks insert with **NULL embeddings** (`lib/ai/ingest-core.ts`) and an `embed` job is enqueued. The request returns `202` immediately — embedding latency never blocks the caller.
5. The embedding worker (`workers/embedding.ts`, concurrency 3) fills in vectors (Nomic → Ollama fallback, `lib/ai/embed.ts`) and enqueues synthesis.

**Invariant:** retrieval filters `embedding IS NOT NULL`, so un-embedded chunks are invisible rather than wrong.

### Context (`GET /v1/context` → lib/ai/query-engine.ts)

1. Per-user cache check (Redis, 60 s TTL; workspace profiles 5 min). Cache keys encode `q`, filters, `asOf`, `asOfKnowledge`, `sessionId` — variants never collide.
2. On miss: load the synthesized profile (`static_documents`) and, when `q` is present, run hybrid retrieval — pgvector cosine + BM25 (`ts_rank`), merged by reciprocal rank fusion (or `alpha`-weighted). Falls back gracefully to vector-only if the `content_tsv` column is missing.
3. Response: `static` (≤30) and `dynamic` (≤15) profile arrays, `relevant` chunks, plus `temporal` facts and `entities` on Pro+.

### Synthesis (workers/synthesis.ts)

Triggered after ingest (threshold `SYNTHESIS_THRESHOLD`, default 25 chunks). Under a Postgres advisory lock it reads a user's chunks, calls the LLM (provider chain: Cerebras → GitHub Models → local Ollama, `lib/ai/llm.ts` — separate model slots for query vs synthesis), and writes:

- the two-layer profile (`static_documents`) — per-user and, separately, workspace-wide (two-tier memory via `userSynthesized` / `synthesized` flags on chunks);
- the **entity graph** (below);
- then fires the developer's outbound webhook if configured (`lib/infra/outbound-webhook.ts`, SSRF-guarded, retried).

All end-user text is passed through prompt-injection neutralization before reaching any LLM prompt (`lib/utils/sanitize.ts`).

## The bi-temporal entity graph

The differentiating data structure, in `entity_nodes` / `entity_edges` (`lib/db/schema.ts`). Every edge carries **two independent time axes**:

| Axis | Columns | Question it answers |
|---|---|---|
| Valid time | `valid_from` / `valid_until` | When was this true in the world? |
| Knowledge time | `recorded_at` / `valid_until_recorded_at` | When did the system learn it? |

`GET /v1/entities?asOf=…&asOfKnowledge=…` applies knowledge-time first, then valid-time (`getEntitiesForUser` in `query-engine.ts`), reconstructing the graph as it was true *and as it was believed* at any instant. A partial unique index allows exactly one **active** edge per (from, to, relationship) while preserving closed edges as history, which makes edge inserts race-safe via `ON CONFLICT DO NOTHING`.

## The ledger (as-of, cited claims)

Alongside the relational entity graph, Anansi keeps a **propositional ledger** of attestations (`lib/db/attestations-repo.ts`): trust-tiered (`observed` / `candidate`), cited claims, each backed by a verbatim quote located in a specific source chunk. Like the graph it is bi-temporal and append-only — answers are never overwritten, only superseded.

Three shipped, read-only public endpoints fold it (`lib/ai/ledger.ts`, `lib/ai/ledger-diff.ts`):

- `GET /v1/ledger` — reconstruct the cited answer set for a domain at any `(asOf, asOfKnowledge)` coordinate, with disputes surfaced when one question has competing active answers.
- `GET /v1/ledger/divergences` — where a **documented** answer (wiki/runbook) disagrees with the **observed** reality (chat/tickets), with the date practice changed.
- `GET /v1/ledger/timeline` — a chronological record of when each answer was adopted and superseded.

## Data model (core tables)

`developer_accounts` → `developer_api_keys` (HMAC-hashed) → `workspaces` → `memory_users` → `memory_chunks` (768-dim pgvector, HNSW index built in `lib/db/post-migration.ts`) → `static_documents` (synthesized profiles), `entity_nodes` / `entity_edges` (graph), plus `subscriptions`, `usage_stats`, `connector_tokens` (AES-256-GCM encrypted), `channels` (Slack), and token tables for magic-link auth.

**Tenant isolation is app-layer**: every query scopes by `workspace_id` / `developer_id`. Postgres RLS on `memory_chunks` is only a NULL-guard backstop (`post-migration.ts`), not the isolation boundary. Any new query must include the scoping WHERE clause. See `docs/architecture/decisions/0001-workspace-data-isolation.md`.

Migrations: Drizzle Kit, `apps/api/src/lib/db/migrations/`, applied by `pnpm db:migrate`; `post-migration.ts` handles the bits SQL migrations can't (HNSW, RLS policies).

## Module map

```
apps/api/src/
├── app.ts             app wiring, security headers, /status, /metrics, sitemap
├── index.ts           HTTP entry point (+ retention sweep)
├── worker-entry.ts    worker entry point (WORKER_ROLE dispatch)
├── routes/            HTTP surfaces: v1 (public API), slack, connectors,
│                      billing, portal, dashboard, memory-view, landing, docs, legal
├── workers/           BullMQ consumers: embedding, ingestion, synthesis,
│                      retention, backfill, connectors/{notion,google-docs,linear}
└── lib/
    ├── ai/            query-engine (retrieval + bi-temporal), ingest-core,
    │                  embed, llm (provider chain), chunker, entity-graph,
    │                  ledger + ledger-diff (as-of claim fold, divergences), skill-extraction
    ├── auth/          api-auth (HMAC keys), portal-auth, dashboard-auth
    ├── billing/       plans (quotas/limits), usage, feature-gate, billing, stripe-meters
    ├── config/        deployment (DEPLOYMENT_MODE local/cloud/hybrid, provider selection)
    ├── db/            schema, migrate, post-migration, attestations-repo (ledger reads)
    ├── infra/         queue (BullMQ defs), cache, rate-limit, outbound-webhook, error-reporting
    ├── integrations/  slack-api, slack-client, slack-memory-user, supabase
    ├── skill/         schema for the experimental executable-skills work (no routes yet)
    ├── ui/            theme + background helpers for the server-rendered pages
    └── utils/         crypto (AES-GCM, HMAC), sanitize (redaction + injection), mask
```

Packages (`packages/`): `sdk` (TS), `sdk-python`, `ai-sdk` (Vercel AI middleware), `langchain`, `tools`, `mcp` — thin, zero/low-dependency HTTP clients over the same `/v1` API; they contain no business logic. `apps/graph-explorer` is an internal demo UI over `GET /v1/entities` (see its README). `examples/` are runnable integration templates.

Conventions: ESM throughout with `.js` import specifiers; server-rendered UI via Hono JSX (no SPA); structured JSON logs per request and per operation; uniform `{ "error": "…" }` error shape with disciplined status codes (400/401/402/413/429).

## Design decisions worth knowing

- **Why async ingest:** embedding calls are the slowest dependency; `202` + queue keeps p99 flat and matches the fire-and-forget shape voice/agent callers need.
- **Why profiles, not just chunks:** `GET /v1/context` returns capped, deduplicated arrays so callers do zero post-processing. Raw retrieval still exists (`POST /v1/search`).
- **Why pgvector, not a vector DB:** one database for rows + vectors + BM25; hybrid search is a SQL query, transactional with everything else.
- **Why the provider chain:** no hard dependency on any LLM vendor; with zero cloud keys the stack runs fully local on Ollama (`DEPLOYMENT_MODE=local`, dev/offline positioning — local synthesis *quality* is not yet validated).
- **Why Slack is feature-frozen:** it is a showcase of the engine, not the growth funnel (decision D2/D8) — kept as an OSS reference.
- **ADRs:** `docs/architecture/decisions/` — workspace isolation, secrets/key management, retention & GDPR.

## Deploy & release

- **API deploy:** Railway auto-deploys `main` on push (`railway.toml`; api + worker services from the same Dockerfile). CI (`.github/workflows/ci.yml`) runs build, lint, audit, tests — it does **not** deploy.
- **Package publish:** a `v*` tag triggers `.github/workflows/publish.yml` (all npm packages + PyPI, idempotent). Gate releases on `scripts/cold-install-smoke-test.sh`.
- Deployment guide: [`docs/enterprise/self-hosting.md`](docs/enterprise/self-hosting.md). Versioning policy: [README → API versioning](README.md#api-versioning) (breaking changes only under `/v2` with 90-day notice).

## Where to start reading

1. `routes/v1.ts` — the whole public API in one file.
2. `lib/ai/query-engine.ts` — retrieval, hybrid search, the bi-temporal projection.
3. `lib/db/schema.ts` — the data model with inline comments.
4. `workers/synthesis.ts` + `lib/ai/entity-graph.ts` — how memory becomes a profile and a graph.
5. `apps/api/src/test/` — 409 tests across 31 test files that double as executable documentation (`temporal-query.test.ts` is the bi-temporal spec).
