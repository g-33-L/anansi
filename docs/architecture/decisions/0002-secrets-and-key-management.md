# ADR-0002: Secrets and Key Management

**Date:** 2026-06-18  
**Status:** Accepted

## Context

Anansi stores sensitive credentials (OAuth tokens, Slack bot tokens) and must manage multiple cryptographic keys without confusing their purposes.

## Decision

Three environment variables serve distinct cryptographic roles — they must never be reused across roles:

| Variable | Algorithm | Purpose |
|---|---|---|
| `ENCRYPTION_KEY` | AES-256-GCM (32-byte hex) | Encrypts Slack bot tokens and OAuth connector tokens at rest |
| `CSRF_SIGNING_KEY` | HMAC-SHA256 | Signs CSRF state, cookies, and install tokens |
| `API_KEY_HMAC_SECRET` | HMAC-SHA256 | Derives stored hashes of developer API keys |

OAuth tokens and Slack bot tokens are stored encrypted (`encrypt()`/`decrypt()` in `lib/utils/crypto.ts`). API keys are HMAC-hashed (never stored in plaintext) so a DB breach does not expose raw keys.

## Key Rotation

**Current limitation:** `ENCRYPTION_KEY` has no rotation path. If rotated, all encrypted tokens become undecryptable until re-encrypted. A future migration should:
1. Add a `keyVersion` column to `connector_tokens` and `workspaces.slack_bot_token`.
2. On startup, re-encrypt rows using `keyVersion < current` with the current key.
3. Remove old key from env after re-encryption completes.

This is tracked but not yet implemented.

## Consequences

- AES keys must not be used as HMAC keys (different security properties). `generateInstallToken` uses `CSRF_SIGNING_KEY` for its HMAC, not `ENCRYPTION_KEY`.
- Missing any of the three required env vars causes `process.exit(1)` at startup.
- Key length is validated: `ENCRYPTION_KEY` must be exactly 64 hex chars (32 bytes).
