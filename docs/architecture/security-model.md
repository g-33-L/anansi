# Security Model

Anansi stores user memory on behalf of downstream applications. Security is a core concern, not an afterthought.

## Authentication

### API keys

- Keys are HMAC-SHA256 hashed at rest using `API_KEY_HMAC_SECRET`
- Raw keys are **never** stored in the database
- A regex fast-reject filters malformed keys before any DB hit
- Key format: `ans_` prefix + random string

### Portal authentication

- Magic-link login via email (Resend in production, console logging in dev)
- Tokens are one-time use with 15-minute TTL
- Stored as SHA-256 hashes in `developer_auth_tokens`
- Supabase handles the email delivery infrastructure

### Slack OAuth

- Standard OAuth 2.0 flow with HMAC-signed state parameters (prevents CSRF)
- Bot tokens stored as AES-256-GCM ciphertext

## Encryption at rest

### OAuth tokens

All connector tokens (Slack, Notion, Google, Linear) are encrypted with AES-256-GCM using `ENCRYPTION_KEY`.

```typescript
// lib/utils/crypto.ts
encrypt(plaintext, ENCRYPTION_KEY)  // → ciphertext
decrypt(ciphertext, ENCRYPTION_KEY) // → plaintext
```

### Key management

Three distinct cryptographic keys with separate purposes:

| Variable | Algorithm | Purpose |
|---|---|---|
| `ENCRYPTION_KEY` | AES-256-GCM (32-byte hex) | Encrypts OAuth tokens at rest |
| `CSRF_SIGNING_KEY` | HMAC-SHA256 | Signs CSRF state, cookies, install tokens |
| `API_KEY_HMAC_SECRET` | HMAC-SHA256 | Derives stored hashes of API keys |

**Rules**:
- Never reuse keys across roles
- Missing any required key causes `process.exit(1)` at startup
- `ENCRYPTION_KEY` must never be rotated without re-encrypting all stored tokens (rotation path not yet implemented)

## Tenant isolation

### Application-layer isolation

Every database query explicitly scopes by `workspace_id` or `developer_id` in its `WHERE` clause. No query reaches the DB without a workspace-scoped predicate.

### Database-level backstop

Row-Level Security (RLS) is enabled on `memory_chunks` as a defense-in-depth NULL guard:

```sql
USING (workspace_id IS NOT NULL)
```

This prevents rows without a workspace from appearing, but it does **not** enforce tenant isolation. The per-query `WHERE workspace_id` clause is the isolation boundary.

### Production DB user

The production database user must **not** be a PostgreSQL superuser (superusers bypass RLS).

## Content security

### Secret redaction

All content passes through secret redaction before ingestion. Known patterns are replaced with `[REDACTED]`:

- Stripe keys (`sk_live_...`, `pk_live_...`, `whsec_...`)
- GitHub tokens (`ghp_...`, `gho_...`, `github_pat_...`)
- Slack tokens (`xoxb-...`, `xoxp-...`, `xapp-...`)
- AWS keys (`AKIA...`, secret keys with context)
- OpenAI/Anthropic/Nomic API keys
- PEM private keys
- Generic `password=...`, `secret=...`, `token=...` assignments

40-character tokens are only redacted with nearby context — git SHAs and base64 strings pass through.

### Prompt injection defense

End-user content is neutralized before reaching any LLM prompt:

- Forged `--- BEGIN/END ... ---` fence markers are rewritten to `- - -BEGIN/END...`
- `CITED:` control lines are rewritten to `CITED :`
- This prevents content from breaking out of its trust boundary in the prompt

Source: `apps/api/src/lib/utils/sanitize.ts`

## Network security

### SSRF protection

Both URL ingestion and outbound webhooks validate targets against an SSRF policy:

- HTTPS only (no HTTP)
- DNS resolution verifies all addresses are public (no RFC-1918, no loopback, no link-local, no CGNAT)
- IPv4-mapped IPv6 literals in canonical hex form are correctly classified
- Each redirect hop is re-validated against the same policy
- 10-second timeout, 500 KB body cap, max 3 redirects

Source: `apps/api/src/lib/url-ingest.ts`, `apps/api/src/lib/infra/outbound-webhook.ts`

### Security headers

All responses include:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload (production only)
Content-Security-Policy: ... (HTML responses only)
```

### CORS

Hono's built-in CORS handling. Workspace IDs in request headers are not logged at the middleware level (prevents log injection).

## Rate limiting

Redis-backed sliding-window sorted set in a single Lua script. Atomic and race-safe.

- Ingest: 100 requests per minute per API key
- Context/search: 60 requests per minute per API key
- Monthly quota enforced per plan limits

On Redis failure, rate limiting fails open (allows the request) with a logged warning. Quotas are still enforced in Postgres.

## GDPR compliance

### Right to erasure

`DELETE /v1/user` performs a hard delete:

1. Deletes the `memory_users` row
2. Cascading FK deletes: `memory_chunks`, `static_documents`, `entity_nodes`, `entity_edges`
3. Evicts per-user context cache and workspace profile cache
4. Idempotent: deleting an unknown userId returns `{ "deleted": true }`

### Data retention

- Free plan: 7-day retention (daily sweep deletes expired chunks)
- Pro/Scale/Enterprise: unlimited retention
- Retention sweep also cleans up orphaned `staticDocuments` and entity graph nodes

### Opt-out (Slack)

Users can opt out via `/memory forget-me`. The `opted_out` flag prevents new personal profiles while retaining contributions to the team profile.

### What is NOT implemented

- No GDPR data access log (right of access) — callers can use `GET /v1/memories` to retrieve all stored data
- No geographic data residency enforcement — EU-only processing requires explicit Railway region configuration
- No data processing agreement (DPA) — planned for enterprise tier

## Vulnerability reporting

See [SECURITY.md](../../SECURITY.md) for the private disclosure process. Report to anansi.memory@gmail.com.
