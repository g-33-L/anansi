# ADR-0003: Data Retention and GDPR

**Date:** 2026-06-18  
**Status:** Accepted

## Context

Anansi stores personal memory data (user messages, synthesized profiles, entity graphs). GDPR and user trust require clear retention limits and a right-to-erasure path.

## Decision

**Plan-based retention:**
- Free plan: 7 days. All chunks (raw and synthesized) older than 7 days are hard-deleted.
- Pro / Scale / Enterprise: unlimited retention.

The daily retention sweep (`workers/retention.ts`) deletes:
1. Any chunk whose `expires_at` has lapsed (caller-controlled TTL from `/v1/ingest`).
2. All chunks past the plan retention window — including `synthesized = true` chunks.
3. `staticDocuments` (synthesized profiles) for `memoryUsers` with no remaining chunks.

Step 3 is the GDPR right-to-erasure path: derived profiles must not outlive the source data.

**Explicit deletion:**
`DELETE /v1/user/{userId}` hard-deletes all chunks for a user immediately (cascades to entity nodes/edges). Developers must surface this to end users who request erasure.

**Opt-out (Slack):**
Users can opt out of personal memory synthesis via `/remember off`. The `opted_out` flag on `memory_users` prevents new personal profiles while retaining their contributions to the workspace (team) profile.

## Consequences

- Synthesized profiles (`staticDocuments`) are cleaned up by the daily sweep — they are not permanent.
- End users of apps built on Anansi must request deletion through the developer; there is no self-service end-user deletion UI in Anansi itself.
- No GDPR data access log (right of access) is currently implemented. Callers can use `GET /v1/memories` to retrieve all stored data for a user.
- Geographic data residency is not enforced. EU-only processing requires explicit Railway region configuration and a DPA with the LLM provider.
