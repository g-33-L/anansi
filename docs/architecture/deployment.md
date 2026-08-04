# Deployment Modes

Anansi supports three deployment modes, selected by the `DEPLOYMENT_MODE`
environment variable. Modes make the privacy posture an **enforced invariant**
rather than a convention: instead of "just don't set the cloud keys," local mode
*refuses to start* if a cloud content path is configured.

Provider selection lives in one place — `apps/api/src/lib/config/deployment.ts` —
and every provider (`llm.ts`, `embed.ts`, `error-reporting.ts`, analytics) consults
it. There are no scattered `process.env` provider checks.

| Mode | LLM inference | Embeddings | Telemetry | Startup guard |
|---|---|---|---|---|
| `local` | Ollama only | Ollama only | off | **fails** if any cloud key is set |
| `cloud` *(default)* | Cerebras → GitHub Models → Ollama | Nomic (if key) → Ollama | Sentry (if DSN) | none |
| `hybrid` | per `INFERENCE_LOCATION` | per `EMBEDDING_LOCATION` | Sentry (if DSN) | validates locations |

## Local mode (air-gapped / enterprise)

```bash
DEPLOYMENT_MODE=local
# No cloud keys. Ollama defaults to http://localhost:11434.
OLLAMA_LLM_MODEL=llama3.1:8b
OLLAMA_EMBED_MODEL=nomic-embed-text
```

Guarantees, enforced at startup:

- **Company content never reaches a third-party AI provider.** Cloud LLM keys
  (`CEREBRAS_API_KEY`, `GITHUB_TOKEN`) and cloud embedding keys (`NOMIC_API_KEY`)
  are **ignored** by the provider code *and* rejected at boot.
- **No content-exporting telemetry.** `SENTRY_DSN` is rejected at boot; error
  reporting and marketing analytics (Plausible) are disabled.
- **Fail-loud, not fail-silent.** If any forbidden variable is set, the process
  refuses to serve and prints exactly which variable violated the mode and how to
  fix it — a stray key can never silently offload data.

Example failure:

```
[startup] Deployment configuration is invalid:
  - DEPLOYMENT_MODE=local forbids cloud LLM providers, but CEREBRAS_API_KEY is set.
    Unset CEREBRAS_API_KEY for an air-gapped install, or use DEPLOYMENT_MODE=hybrid ...
```

## Cloud mode (default, hosted)

`DEPLOYMENT_MODE` unset or `cloud` reproduces today's behavior exactly: cloud
providers are used when their keys are present, with local fallback otherwise.
**Existing deployments need no configuration change.**

## Hybrid mode (explicit mix)

```bash
DEPLOYMENT_MODE=hybrid
INFERENCE_LOCATION=cloud     # cloud reasoning
EMBEDDING_LOCATION=local     # local embeddings (content never leaves for vectors)
```

Both default to `cloud` / `local` respectively if omitted. Invalid values are
rejected at startup. Hybrid is for teams that want, e.g., local embeddings for
privacy but a stronger cloud model for reasoning — the split is explicit, never
accidental.

## Security guarantees & the egress audit

Only three code paths can send **company content** off-box, all now governed by
the deployment config:

| Path | File | Cloud when | Local mode |
|---|---|---|---|
| LLM inference | `lib/ai/llm.ts` | `CEREBRAS_API_KEY` / `GITHUB_TOKEN` | forced Ollama |
| Embeddings | `lib/ai/embed.ts` | `NOMIC_API_KEY` | forced Ollama |
| Error telemetry | `lib/infra/error-reporting.ts` | `SENTRY_DSN` | disabled |
| Marketing analytics | `routes/landing.tsx` (Plausible) | always, on public site | disabled |

**Not covered (by design):** *connectors* (Slack, Notion, Google Docs) reach out
to the company's **own** SaaS to pull the company's **own** data in. That is data
ingestion from your systems, not offloading to a third-party processor. A fully
air-gapped install without internet access simply won't use connectors — ingest
via the local `POST /v1/ingest` API instead. Browser-loaded assets on the public
marketing site (Google Fonts) are not a server-side content path.

## Migration from previous releases

- **No action required for existing (cloud) deployments.** `DEPLOYMENT_MODE`
  defaults to `cloud`; all prior env vars behave as before.
- To harden an install to air-gapped: set `DEPLOYMENT_MODE=local` and remove
  `CEREBRAS_API_KEY`, `GITHUB_TOKEN`, `NOMIC_API_KEY`, and `SENTRY_DSN`. If any
  remain set, startup will tell you exactly which to remove.
- Ensure Ollama is running with both a chat model (`OLLAMA_LLM_MODEL`) and an
  embedding model (`OLLAMA_EMBED_MODEL`) pulled.

## Internal operations plane (managed cloud only)

Phase 8 adds a staff-only operations plane at `/console/ops` (health, queues,
customer support metadata, feature flags, announcements, safe actions).

It is **fail-closed**: reachable only when `DEPLOYMENT_MODE=cloud` **and**
`STAFF_EMAILS` is non-empty. On self-host/local (the default), leave `STAFF_EMAILS`
blank — the plane returns `404` and cannot be enabled by accident.

- `STAFF_EMAILS=ops@yourco.com,admin@yourco.com` — comma-separated operator
  accounts. Staff identity is **separate from organization roles**: an org owner
  has no ops access.
- Requests are traced via `X-Correlation-Id` (generated if absent). Every staff
  read of sensitive account metadata and every mutation is written to
  `operator_audit_events` with actor, correlation id, and (for mutations) a reason.
- Self-host owners get service health via the public `GET /status` page and
  `GET /health`; the staff console is not bundled as an unrestricted self-host
  feature.

See [`docs/enterprise/troubleshooting.md`](../enterprise/troubleshooting.md) for
triage procedures.

## Limitations

- **Local mode inference quality depends on your local model.** Cloud reasoning
  models are stronger than an 8B local model; validate extraction quality on your
  chosen local model before relying on it.
- Local mode disables connectors' usefulness in a truly air-gapped network (no
  outbound access to Slack/Notion). This is expected.
- The guard checks *configuration*, not runtime network reachability — it prevents
  a misconfigured cloud key, not a compromised host. Network-level egress controls
  remain the operator's responsibility.
