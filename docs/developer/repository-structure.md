# Repository Structure

Anansi is a pnpm workspace managed with Turbo.

```
anansi/
├── apps/
│   ├── api/                          # Main application (Hono + Node.js)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── v1.ts             # Core API: ingest, context, search, memories, entities, delete
│   │   │   │   ├── landing.tsx       # Marketing site (/)
│   │   │   │   ├── docs.tsx          # Docs site (/docs)
│   │   │   │   ├── portal.tsx        # Developer portal (/portal)
│   │   │   │   ├── dashboard.tsx     # Slack workspace dashboard
│   │   │   │   ├── slack.ts          # Slack bot (OAuth, events, slash commands)
│   │   │   │   ├── connectors.ts     # Notion, Google Docs, Linear, Transcript webhooks
│   │   │   │   ├── billing.ts        # Stripe checkout + webhooks
│   │   │   │   ├── docs/
│   │   │   │   │   ├── getting-started.tsx
│   │   │   │   │   ├── api-reference.tsx
│   │   │   │   │   ├── concepts.tsx
│   │   │   │   │   └── shared.tsx
│   │   │   │   └── legal.tsx         # Privacy policy, ToS, DPA
│   │   │   ├── workers/
│   │   │   │   ├── ingestion.ts      # Chunk → embed → memory_chunks pipeline
│   │   │   │   ├── synthesis.ts      # Advisory-locked synthesis → static_facts + dynamic_context
│   │   │   │   └── connectors/
│   │   │   │       ├── notion.ts
│   │   │   │       ├── google-docs.ts
│   │   │   │       └── linear.ts
│   │   │   └── lib/
│   │   │       ├── ai/               # Core ML: ingest-core, query-engine, embed, chunker, llm, entity-graph
│   │   │       ├── auth/             # api-auth (API keys), portal-auth, dashboard-auth
│   │   │       ├── billing/          # plans, usage, feature-gate, stripe-meters
│   │   │       ├── db/               # Drizzle schema, migrations, connection
│   │   │       ├── infra/            # cache, queue (BullMQ), rate-limit, outbound-webhook, error-reporting
│   │   │       ├── integrations/     # Slack API client, Supabase client
│   │   │       └── utils/            # crypto (AES-GCM, HMAC), sanitize (secret redaction)
│   │   ├── Dockerfile
│   │   └── drizzle/                  # Migration files
│   └── graph-explorer/               # Memory-graph explorer UI (Vite + React, internal demo)
│
├── packages/
│   ├── sdk/                          # anansi-memory — TypeScript SDK
│   ├── sdk-python/                   # anansi-memory — Python SDK
│   ├── ai-sdk/                       # anansi-ai-sdk — Vercel AI SDK middleware
│   ├── langchain/                    # anansi-langchain — LangChain + LangGraph integration
│   ├── tools/                        # anansi-tools — framework-agnostic remember/recall tools
│   └── mcp/                          # anansi-mcp — MCP server (Claude, Cursor, Windsurf)
│
├── examples/
│   ├── claude-chatbot/               # Terminal chatbot with persistent memory
│   └── voice-agent/                  # Voice memory pattern (Vapi / Retell / LiveKit)
│
├── scripts/                          # Release verification (cold-install smoke test)
├── docker-compose.yml                # PostgreSQL (pgvector) + Redis for local dev
├── railway.toml                      # Railway deployment config
├── ARCHITECTURE.md                   # System architecture deep-dive
├── CONTRIBUTING.md                   # Contribution guide
├── SECURITY.md                       # Security policy + private disclosure
└── CHANGELOG.md                      # Release history
```

## Key modules in `apps/api/src/lib/ai/`

| File | Role |
|---|---|
| `ingest-core.ts` | Shared ingest logic: chunk storage, embedding insertion, idempotency |
| `query-engine.ts` | All retrieval: `queryUser`, `searchChunks`, `getEntitiesForUser`, `buildFilterSQL` |
| `chunker.ts` | Source-type-aware text chunking (`api_text`, `meeting_transcript`) |
| `embed.ts` | Embedding provider: Nomic (cloud) → Ollama (local) |
| `llm.ts` | LLM provider chain: Cerebras → GitHub Models → Ollama |
| `entity-graph.ts` | Bi-temporal entity extraction and edge management |

## Key modules in `apps/api/src/lib/infra/`

| File | Role |
|---|---|
| `queue.ts` | BullMQ queue definitions (`embedQueue`, `synthesisQueue`, etc.) |
| `cache.ts` | Redis-backed context caching (60s TTL) with per-user and workspace-profile tiers |
| `rate-limit.ts` | Sliding-window rate limiting via Redis sorted sets (single Lua script) |
| `outbound-webhook.ts` | POST events to configured webhook URL with SSRF validation |

## Key modules in `apps/api/src/lib/billing/`

| File | Role |
|---|---|
| `plans.ts` | Plan definitions, quotas, and feature gates |
| `usage.ts` | Monthly API call counting per workspace |
| `feature-gate.ts` | Enforce plan limits (returns 402 when exceeded) |
| `stripe-meters.ts` | Stripe Billing Meter event reporting |
