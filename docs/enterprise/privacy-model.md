# Privacy Model

How Anansi handles user data, encryption, access controls, and regulatory compliance.

## Data ownership

Anansi stores memory on behalf of downstream applications. The developer (API key holder) owns the data; Anansi is a processor, not a controller. Self-hosted deployments keep all data on your own infrastructure.

## Encryption at rest

### API keys

API keys are HMAC-SHA256 hashed before storage (`API_KEY_HMAC_SECRET`). Raw keys are never written to the database. A DB breach exposes hashes, not usable keys.

### OAuth tokens

Slack bot tokens, Notion/Google/Linear OAuth tokens are encrypted with AES-256-GCM (`ENCRYPTION_KEY`) before storage. Decryption happens only at use-time (connector sync, Slack API calls).

### Content

Memory chunks and synthesized profiles are stored as plaintext in PostgreSQL. The database itself should be encrypted at the infrastructure level (Railway provides this by default; self-hosted deployments must configure disk encryption).

## Tenant isolation

Every database query scopes by `workspace_id` or `developer_id` in its `WHERE` clause. No query reaches the DB without a workspace-scoped predicate. This is enforced at the application layer.

Row-Level Security (RLS) is enabled on `memory_chunks` as a defense-in-depth NULL guard (`USING (workspace_id IS NOT NULL)`), but it does **not** enforce tenant isolation — the per-query `WHERE` clause is the isolation boundary.

See ADR-0001 for the full rationale.

## Secrets management

Three environment variables serve distinct cryptographic roles and must never be reused:

| Variable | Algorithm | Purpose |
|---|---|---|
| `ENCRYPTION_KEY` | AES-256-GCM (32-byte hex) | Encrypts OAuth tokens at rest |
| `CSRF_SIGNING_KEY` | HMAC-SHA256 | Signs CSRF state, cookies, install tokens |
| `API_KEY_HMAC_SECRET` | HMAC-SHA256 | Derives stored hashes of developer API keys |

The server refuses to start if any of these is missing. `ENCRYPTION_KEY` must never be changed after first install — doing so renders all stored tokens undecryptable.

See ADR-0002 for key rotation limitations.

## Data retention

| Plan | Retention |
|---|---|
| Free | 7 days |
| Pro | Unlimited |
| Scale | Unlimited |
| Enterprise | Unlimited |

Free-tier data is hard-deleted by a daily retention sweep (`workers/retention.ts`). The sweep deletes:

1. Chunks whose caller-controlled `expires_at` has lapsed
2. All chunks past the plan retention window (including synthesized chunks)
3. Synthesized profiles (`staticDocuments`) for users with no remaining chunks

Pro+ plans have no automatic expiry. Developers can set per-ingest TTLs via the `ttl` parameter.

## GDPR compliance

### Right to erasure

`DELETE /v1/user` performs a hard-delete: removes the `memoryUsers` row and cascades to all child data (chunks, synthesized profiles, entity nodes/edges). Caches are evicted. Idempotent — deleting an unknown user still returns `{ "deleted": true }`.

### Right of access

`GET /v1/memories` returns all stored chunks for a user. `GET /v1/entities` returns the entity graph. These can be used to fulfill data access requests.

### Opt-out (Slack)

Slack users can opt out of personal memory synthesis via `/memory forget-me`. The `opted_out` flag prevents new personal profiles while retaining contributions to the workspace profile.

### What is not implemented

- No GDPR data access log (right of access audit trail)
- No geographic data residency enforcement (EU-only processing requires Railway region configuration and a DPA with the LLM provider)
- No end-user self-service deletion UI — developers must surface `DELETE /v1/user` to their users

## SSRF protection

Outbound webhooks and URL ingestion are validated against an SSRF allowlist: HTTPS only, DNS-resolved public-address checks, no RFC-1918 addresses. The `assertSafeWebhookUrl` function in `lib/infra/outbound-webhook.ts` enforces this.

## Rate limiting

Redis-backed sliding-window sorted-set algorithm in a single Lua script. Atomic and per-workspace. Limits are plan-dependent (see `lib/billing/plans.ts`).

## Infrastructure

| Component | Security posture |
|---|---|
| PostgreSQL | Disk encryption (Railway default); no superuser in production |
| Redis | Used for caches, rate limits, queues only — no durable user data |
| LLM provider | Data sent for synthesis/query; DPA required for Enterprise |
| Embeddings | Nomic (cloud) or Ollama (local); pre-computed embeddings skip the provider entirely |
