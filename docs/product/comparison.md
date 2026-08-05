# How Anansi Compares

The memory space is active — Mem0, Supermemory, and Zep all ship strong products. This page explains where Anansi is genuinely differentiated and where it is not.

## What Anansi does differently

### 1. Knowledge-time queries (`asOfKnowledge`)

The headline differentiator. Anansi's entity graph carries a knowledge-time axis alongside valid-time. You can reconstruct the graph *as you knew it* at any past instant, not just what was valid at that time.

As of July 2026, neither Mem0's nor Supermemory's public APIs expose a knowledge-time query.

**Zep (Graphiti) also models bi-temporality** — do not claim this axis is unique against Zep.

### 2. MIT licensed and fully self-hostable

The entire stack — synthesis worker, bi-temporal query engine, connectors, all of it — is MIT licensed with no open-core asterisks. `docker compose up` starts PostgreSQL (pgvector) + Redis, and with Ollama for LLM and embeddings, the stack runs with zero external API calls.

### 3. First-party Slack app

The Slack integration (`apps/api/src/routes/slack.ts`) turns a workspace into a shared memory surface. Messages ingest automatically, `/ask` queries a two-layer profile, and `/memory forget-me` lets any individual opt out. The bot runs on the same engine as the API.

## What Anansi shares with competitors

Be honest here — this is a capable field:

- **Synthesized profiles**: Mem0, Supermemory, and Zep all return curated output, not just raw chunks
- **Entity/graph memory**: All three ship some form of knowledge graph
- **Connector ecosystems**: Mem0 and Supermemory have Notion, Google, Slack integrations
- **Dashboards and observability**: Mem0 and Supermemory ship dashboards
- **MCP servers**: All three now ship one (Mem0, Supermemory, and Zep's Graphiti MCP Server all shipped/matured in 2026) — do not position an MCP server as differentiating against any of them

The synthesized profile is table stakes, not a moat.

## Feature comparison

| Feature | Anansi | Mem0 | Supermemory | Zep (Graphiti) |
|---|---|---|---|---|
| Synthesized profile (static + dynamic) | Yes | Yes | Yes | No (raw graph) |
| Knowledge-time queries (`asOfKnowledge`) | Yes | No | No | Yes (bi-temporal model) |
| Valid-time queries (`asOf`) | Yes | Yes | Yes | Yes |
| Hybrid search (BM25 + vector + RRF) | Yes | Yes | Yes | Yes |
| Entity graph | Yes | Yes | Yes | Yes |
| MIT license | Yes | No (Apache 2.0) | Yes (core; hosted platform is commercial) | Yes (Apache 2.0, Graphiti engine) |
| Self-hostable with local models | Yes | Yes | Yes (core engine; connectors/MCP are hosted-only) | Yes |
| First-party Slack app | Yes | No (blog-post demo pattern, not shipped) | No (third-party via viaSocket) | No |
| Outbound webhooks | Yes | No | Yes | No |
| Bring-your-own embeddings | Yes | No | Yes | No |
| MCP server | Yes | Yes | Yes (hosted platform only, not the self-hosted core) | Yes (Graphiti MCP Server 1.0) |

*Feature matrix verified against public documentation/repos as of August 2026 (corrected the MCP-server and Supermemory-license rows, previously stale from a July 2026 pass). Re-verify against current product pages before using in sales materials — this space moves fast.*

## Where Anansi is behind

- **Maturity**: Mem0, Supermemory, and Zep have larger teams and more production customers
- **Multimodal**: No image/video/audio ingest — content is parsed to text only
- **Dashboard**: No user-facing memory visualization (an idea is tracked, not built)
- **Latency benchmarks**: No published benchmarks — the team does not quote numbers it cannot back
- **Enterprise features**: No SOC 2, no DPA, no SLA — these are planned, not shipped

## Positioning guidance

- **Do not say**: "We're disrupting the memory space" (vague), "AI-native memory infrastructure" (buzzword soup), or "Better than ChatGPT memory" (wrong reference)
- **Do not say**: "Competitors just return raw chunks" (false — they ship profiles too)
- **Do say**: "A bi-temporal graph — query what you knew, when you knew it. Plus MIT + self-hostable + runs on local models."
