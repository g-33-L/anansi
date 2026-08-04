# Data Model

Anansi's data model is defined in `apps/api/src/lib/db/schema.ts` using Drizzle ORM. Migrations live in `apps/api/src/lib/db/migrations/` and are applied with `pnpm db:migrate`.

## Entity relationship diagram

```
developer_accounts
  ├── developer_api_keys (HMAC-hashed API keys)
  ├── developer_auth_tokens (magic link login)
  └── workspaces
        ├── memory_users (per-developer user scoping)
        │     ├── memory_chunks (pgvector embeddings, 768-dim)
        │     ├── static_documents (synthesized profiles)
        │     ├── entity_nodes (knowledge graph)
        │     │     └── entity_edges (bi-temporal relationships)
        │     └── attestations (evidence-backed claims)
        ├── channels (Slack channels)
        ├── subscriptions (Stripe billing)
        ├── usage_stats (monthly counters)
        ├── connector_tokens (OAuth tokens, AES-256-GCM encrypted)
        ├── dashboard_tokens (Slack dashboard magic links)
        └── synthesis_jobs (background job tracking)
```

## Core tables

### `developer_accounts`

The top-level entity. Each developer (API key holder) has one account.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `workspace_id` | UUID (FK → workspaces) | Nullable for API-only developers |
| `name` | text | Developer name |
| `email` | text | Unique, used for portal login |
| `webhook_url` | text | Outbound webhook URL (HTTPS required) |
| `created_at` | timestamp | |

### `workspaces`

Groups all memory data. API-only workspaces are auto-provisioned on developer signup. Slack-connected workspaces have a `slack_team_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `slack_team_id` | text | Unique, nullable (null for API-only) |
| `slack_bot_token` | text | AES-256-GCM encrypted |
| `slack_team_name` | text | Display name |
| `created_at` | timestamp | |

### `developer_api_keys`

API keys are HMAC-SHA256 hashed at rest. Raw keys are never stored.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `developer_id` | UUID (FK) | |
| `key_hash` | text | HMAC-SHA256 hash, unique |
| `name` | text | Display name, default "Default" |
| `last_used_at` | timestamp | Updated on each authenticated request |
| `created_at` | timestamp | |

### `memory_users`

Scoping entity for per-user memory. One `memory_users` row per (developer, external_user_id) pair.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `developer_id` | UUID (FK) | |
| `external_id` | text | Caller's user ID, max 256 chars |
| `opted_out` | boolean | Privacy opt-out (Slack: `/remember off`) |
| `created_at` | timestamp | |

Unique constraint: `(developer_id, external_id)`.

### `memory_chunks`

The primary data store. Each row is a piece of text with a 768-dim pgvector embedding.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `workspace_id` | UUID (FK) | Tenant isolation scope |
| `channel_id` | UUID (FK → channels) | Nullable, for Slack messages |
| `memory_user_id` | UUID (FK → memory_users) | Nullable, for attributed chunks |
| `source_type` | enum | `message`, `api_text`, `meeting_transcript`, `notion_page`, etc. |
| `source_id` | text | Idempotency key |
| `content` | text | The stored text |
| `embedding` | vector(768) | pgvector, NULL until embedded |
| `metadata` | jsonb | Caller-supplied + system fields |
| `synthesized` | boolean | Workspace-level synthesis flag |
| `user_synthesized` | boolean | Per-user synthesis flag |
| `expires_at` | timestamp | Null = never expires |
| `created_at` | timestamp | |

Indexes:
- Unique on `(workspace_id, source_id)` — deduplication
- Composite on `(workspace_id, synthesized)` — synthesis queries
- Composite on `(memory_user_id, user_synthesized)` — per-user synthesis
- HNSW vector index on `embedding` — created in `post-migration.ts`
- GIN index on `content_tsv` — BM25 full-text search (migration 0009)

**Key invariant**: retrieval filters `embedding IS NOT NULL`, so un-embedded chunks are invisible rather than wrong.

### `static_documents`

Synthesized profiles — one per memory user (personal) or one per workspace (team).

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `workspace_id` | UUID (FK) | Set for workspace profiles, null for user profiles |
| `memory_user_id` | UUID (FK) | Set for user profiles, null for workspace profiles |
| `static_facts` | jsonb (string[]) | Up to 30 curated facts |
| `dynamic_context` | jsonb (string[]) | Up to 15 current context items |
| `temporal_facts` | jsonb (TemporalFact[]) | Time-bounded facts with validFrom/validUntil |
| `version` | integer | Incremented on each synthesis pass |
| `chunks_synthesized_count` | integer | Running count of processed chunks |
| `last_synthesized_at` | timestamp | |

## Entity graph tables

### `entity_nodes`

People, organizations, tools, projects, and locations extracted by the synthesis worker.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `developer_id` | UUID (FK) | |
| `memory_user_id` | UUID (FK) | Nullable — null for shared org/tech nodes |
| `entity_type` | text | `person`, `org`, `tech`, `project`, `location` |
| `name` | text | Display name |
| `canonical_name` | text | Normalized form (lowercase) |
| `metadata` | jsonb | |
| `first_seen_at` | timestamp | |
| `last_seen_at` | timestamp | Updated on each synthesis pass |

Unique constraint: `(developer_id, memory_user_id, entity_type, name)`.

### `entity_edges`

Bi-temporal relationships between entities.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `from_entity_id` | UUID (FK → entity_nodes) | |
| `to_entity_id` | UUID (FK → entity_nodes) | |
| `relationship` | text | `works_at`, `uses`, `knows`, `member_of`, etc. |
| `valid_from` | timestamp | When the relationship started in the real world |
| `valid_until` | timestamp | Null = currently active |
| `recorded_at` | timestamp | When the system first learned this (immutable) |
| `valid_until_recorded_at` | timestamp | When the system learned it had ended |
| `source_chunk_id` | UUID (FK → memory_chunks) | Set null on chunk delete |
| `confidence` | float | Default 1.0 |
| `metadata` | jsonb | |

Partial unique index: at most one **active** edge per `(from, to, relationship)` where `valid_until IS NULL`. Closed edges are exempt, preserving history.

### `attestations`

Evidence-backed claims. Append-only — claims are closed, never deleted.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `workspace_id` | UUID (FK) | |
| `developer_id` | UUID (FK) | |
| `memory_user_id` | UUID (FK) | Nullable — null = workspace-level claim |
| `claim` | text | The assertion |
| `claim_fingerprint` | text | Content identity for dedup |
| `claim_key` | text | Groups competing claims |
| `claim_type` | text | `propositional`, `role`, or `policy` |
| `subject_entity_id` | UUID (FK → entity_nodes) | Optional link into entity graph |
| `domain` | text | Groups attestations into views |
| `polarity` | text | `assertion` or `negation` |
| `inference_status` | text | `stated`, `corroborated`, or `inferred` |
| `status` | text | `observed`, `candidate`, or `disputed` |
| `confidence` | float | Default 0 (never defaults to certainty) |
| `valid_from` / `valid_until` | timestamp | Valid-time axis |
| `recorded_at` / `valid_until_recorded_at` | timestamp | Knowledge-time axis |
| `evidence` | jsonb (AttestationEvidence[]) | Verbatim quotes from source chunks |
| `supersedes` | UUID | Self-referential correction chain |

## Billing tables

### `subscriptions`

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | UUID (FK, unique) | One subscription per workspace |
| `stripe_customer_id` | text | |
| `stripe_subscription_id` | text | |
| `plan` | enum | `free`, `pro`, `scale`, `enterprise`, `api` (legacy) |
| `status` | enum | `active`, `trialing`, `past_due`, `canceled`, `incomplete` |

### `usage_stats`

Monthly counters per workspace.

| Column | Type | Notes |
|---|---|---|
| `workspace_id` | UUID (FK) | |
| `month` | text | `YYYY-MM` format |
| `ingest_calls_count` | integer | |
| `context_calls_count` | integer | |

Unique constraint: `(workspace_id, month)`.

## Migration strategy

- SQL migrations in `apps/api/src/lib/db/migrations/` via Drizzle Kit
- `post-migration.ts` handles what SQL can't: HNSW index creation, RLS policies
- Applied on startup with `pnpm db:migrate`
- Tests require a local PostgreSQL instance; the suite refuses to run against non-localhost databases
