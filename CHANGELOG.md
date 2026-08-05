# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.3.1] — 2026-08-05

### Added

- **MCP client example** (`examples/mcp-client`) — a runnable Node.js walkthrough connecting `anansi-mcp` to Claude Desktop, Claude Code, Cursor, and Windsurf, contributed by [@ShahbazCoder1](https://github.com/ShahbazCoder1).
- **README: "What runs where" table** — a local/optional matrix next to the Quickstart, and the bi-temporal graph's Pro+ gating is now called out next to the pitch itself instead of only in the Usage section further down.

- **Open-core licensing** — `LICENSE-EE` introduces a source-available commercial license for the Enterprise Edition surface (SSO/SAML, SCIM, audit/governance/redaction, team management, hosted control plane billing + staff ops console). Every covered file carries a header naming `LICENSE-EE`. Everything else stays MIT. See `README.md#license` for the full path list and rationale.
- **One-command local Compose startup** — `docker compose up -d` now starts a fresh checkout without requiring a `.env` file. It supplies development-only secrets and local Ollama defaults; real deployments must still set their own secrets and provider configuration.
- **API-reference completeness** — `docs/api/reference.md` now covers `/health`, `/status`, and the protected `/metrics` endpoint alongside every `/v1` developer endpoint, including the ledger family. It explicitly records that skills have no public REST endpoint yet.
- **`docker-compose.yml` now runs the full stack** — a new `api` service builds from `apps/api/Dockerfile` and serves the API + portal on `http://localhost:3000`. `docker compose up -d` alone now takes a fresh checkout to a running app; previously the compose file only defined `postgres` and `redis`, so the API had to be started separately with `pnpm dev`. DB migrations apply automatically on container startup (no separate migrate step needed).
- `.env.example` now documents `SENTRY_DSN` / `SENTRY_ENVIRONMENT` (error reporting) and the optional connector OAuth credentials `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — all previously read by the code but undocumented in the template.
- **Ledger API documented** — the bi-temporal ledger endpoints (`GET /v1/ledger`, `GET /v1/ledger/divergences`, `GET /v1/ledger/timeline`) are now documented in the served API reference and `docs/api/reference.md`; they were live but undocumented.
- **README sections** — added `Security`, `Local development`, `API versioning`, and a `What's in this repo` (open-core boundary) section; other docs already linked to these anchors.
- Node `engines` (`>=20`) declared on the root package and all published npm packages; a `.github/ISSUE_TEMPLATE/config.yml` chooser (blank issues off, security + discussions links) was added.

### Changed

- **Local dev database renamed** — the docker-compose Postgres user/database changed from the pre-rebrand `zazzy`/`companymemory` to `anansi`/`anansi` (also in CI and `.env.example`). Existing dev volumes keep their old credentials; either keep your current `.env` as-is or recreate the volume (`docker compose down -v && docker compose up -d`) and re-run migrations.
- `.env.example` and `.env.railway.template` now document `STRIPE_SCALE_PRICE_ID` (read by billing but previously missing from both templates).
- **README rewritten** as an accurate open-source front page: correct clone URL, a working Docker quickstart on port 3000, a real ingest/context usage example, and an honest roadmap (previously listed already-shipped SDKs as future work).
- **ARCHITECTURE.md refreshed** — module map now lists `lib/config`, `lib/skill`, `lib/ui`, the ledger, and the attestations repo; test count corrected to 409 across 31 files; a ledger section was added.
- **`docs/product/comparison.md` re-verified** — Mem0, Supermemory, and Zep/Graphiti all now ship official MCP servers (previously listed as a differentiator against all three; it isn't one); corrected Supermemory's license from "varies" to MIT (core self-hosted engine), confirmed against their GitHub `LICENSE`.

### Fixed

- **`/status` no longer reports a healthy embedding backend when the configured model isn't pulled, and `/v1/context` returns a named `503` instead of a bare `500` in that case.** Ollama being reachable and the configured model actually being present are different things; `/status` only checked the former. A first-run install that skipped pulling `nomic-embed-text` saw a green status page right up until the first `/v1/context` call failed opaquely. Added `EmbeddingModelNotFoundError`, distinct from the existing "backend unreachable" error, since the fix differs (start Ollama vs. pull the model).
- **`pnpm audit --audit-level high` now exits clean** — the `brace-expansion` pnpm override was bumped to the patched `>=5.0.8` (was pinned to the still-vulnerable `5.0.7`/`2.1.2`, GHSA-mh99-v99m-4gvg, DoS via unbounded expansion length) and a `postcss` override (`>=8.5.18`) was added to close a path-traversal advisory (GHSA-r28c-9q8g-f849) pulled in transitively via `vite`/`vitest`. CI's dependency-audit gate was red on both.
- **API reference: `/v1/search` corrected from `GET` to `POST`** — the served docs (method badge, nav labels, sidebar, rate-limit table) and request description labelled it a GET with query parameters; it is a `POST` with a JSON body (`routes/v1.ts`).
- **API reference: removed a non-existent `limit` parameter from `GET /v1/context`** — the handler never read it, and the two docs disagreed (default 5/max 20 vs default 8/max 50). Retrieval is internally capped at the top 8 relevant chunks.
- **ARCHITECTURE.md** — removed the dead `LAUNCH_CHECKLIST` reference and linked the API-versioning policy to the README anchor.
- Cleared 10 pre-existing ESLint warnings (unused imports/variables/directives, one unnecessary regex escape) with no behavior change.

## [0.3.0] — 2026-07-09

### Added

- **Unified version scheme** — all surfaces (VERSION, landing, the five npm packages, and the Python SDK) aligned to `0.3.0`; resolved a prior Python mismatch (`pyproject` 0.1.1 vs `__init__` 0.2.0).
- **Per-tier feature gates** — hybrid/keyword search, metadata filters, entity graph, workspace context, connectors, URL ingestion, and outbound webhooks are now enforced per plan at the API boundary. Gated calls return `402` with an upgrade message.
- **New pricing tiers** — Pro ($19/mo) and Scale ($99/mo) replace the legacy flat API tier ($49/mo, grandfathered for existing subscribers).
- **Cerebras as primary LLM provider** — provider chain is now Cerebras → GitHub Models → local Ollama.
- **LICENSE file** (MIT — previously declared in the README only).

### Changed

- Landing, docs, portal, and dashboard redesigned (silver data-dense theme, Apple system typography, light/dark toggle).
- Public-facing contact email routed to anansi.memory@gmail.com.

### Fixed

- **`DELETE /v1/memory` full wipe now deletes the user's entity graph** (nodes + edges) and evicts the Redis context and workspace-profile caches — previously entity data survived deletion and cached profiles kept being served until TTL expiry.
- **Secret redaction no longer corrupts content** — 40-char tokens are only redacted with nearby AWS/secret-key context; git commit SHAs and base64 strings pass through untouched.
- **SSRF hardening** — outbound webhook delivery now resolves DNS and verifies all addresses are public (hostname regex alone was bypassable); IPv4-mapped IPv6 literals in canonical hex form (`::ffff:7f00:1`) are now correctly classified as private in both the webhook and URL-ingestion guards.
- Hono CORS advisory GHSA-88fw-hqm2-52qc patched via pnpm workspace override.

## [0.2.0] - 2026-06-13

### Added

- **Hybrid search** — `POST /v1/search` returns scored memory chunks without synthesis; supports `semantic`, `hybrid` (default), and `keyword` modes. Alpha parameter tunes vector-vs-BM25 weighting; RRF merge used when alpha is omitted.
- **Metadata filters** — Ingest and search now accept JSONB metadata filters with `$gte`, `$lte`, `$gt`, `$lt`, `$contains`, `$and`, `$or` operators. Caller metadata is stored in full so any key is filterable.
- **Memory listing** — `GET /v1/memories` returns paginated chunks for a user; ranked by hybrid search when a query is given, otherwise sorted by recency. Supports `sourceType` filter.
- **Entity graph** — `GET /v1/entities` returns entities and their bi-temporal relationships extracted by the synthesis worker (people, tools, projects, and more). Entities accumulate across ingest calls; edges carry `valid_from`/`valid_until` for historical tracking.
- **Temporal facts** — `GET /v1/context` response now includes a `temporal` array of time-bounded facts (e.g. "worked at Acme from Jan–Mar 2025") alongside the existing `static` and `dynamic` profile.
- **Bring-your-own vector** — Ingest accepts a pre-computed `embedding` array, skipping the internal embedding provider. Useful for models not supported by the default pipeline.
- **Session and agent scoping** — Ingest and context retrieval accept `sessionId` and `agentId` for scoping memory to a conversation or agent.
- **`anansi-ai-sdk`** — Vercel AI SDK middleware (`withAnansi`) that auto-injects memory context into `doGenerate`/`doStream` calls and optionally ingests responses.
- **`anansi-langchain`** — LangChain integration: `AnansiRetriever` (BaseRetriever), `AnansiMemoryTool` and `AnansiContextTool` (Tool), plus LangGraph `AnansiMemoryAnnotation` and `createAnansiMemoryNodes` helpers.
- **`anansi-tools`** — Zero-dependency tool definitions for AI SDK (`remember` / `recall`) in both AI SDK and OpenAI tool-call formats.
- **Python SDK** — Added `search()`, `list_memories()`, `list_entities()`, and `AnansiRetriever` (LangChain-compatible with stdlib-only fallback). `context()` now returns `temporal` and `entities` fields.
- **TypeScript SDK** — Added `search()`, `listMemories()`, `listEntities()` methods and full type definitions for `MetadataFilter`, `RetrievalOptions`, `Entity`, `TemporalFact`, `SearchResult`.

### Changed

- `GET /v1/context` response shape extended: `temporal: TemporalFact[]` and `entities: EntitySummary[]` added alongside existing fields.
- Context cache key now encodes all retrieval parameters (`alpha`, `threshold`, `filters`, `sessionId`) so different option combinations never share a cached result.
- Synthesis worker prompt extended to extract temporal facts and entities in addition to the existing static/dynamic profile.
- `GET /v1/entities` enforces monthly quota in addition to rate limiting (consistent with other read endpoints).

### Fixed

- Caller-supplied metadata was silently dropped during ingest (only whitelisted system keys survived). Caller metadata is now stored first, with system keys winning on collision, making all custom keys filterable.
- Test fixture: `API_KEY_HMAC_SECRET` was set after `hashApiKey()` was called in `beforeEach`, causing all v1 route tests to fail with an environment error.
