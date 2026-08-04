# Security Policy

Anansi stores user memory on behalf of downstream applications, so we take security reports seriously and appreciate responsible disclosure.

## Supported versions

| Version | Supported |
|---|---|
| 0.3.x (latest release) | Yes |
| < 0.3 | No |

Security fixes land on `main` and ship in the next release. The hosted service at [anansimemory.com](https://anansimemory.com) always runs the latest code.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.** Public issues immediately expose the problem to everyone, including hosted-service users, before a fix exists.

Instead, email **anansi.memory@gmail.com** with:

- A description of the vulnerability and its impact
- Steps to reproduce (a proof of concept helps a lot)
- The affected component (API route, worker, connector, SDK, portal, etc.)
- Any suggested remediation, if you have one

### What to expect

- **Acknowledgement within 3 business days** of your report.
- An assessment of severity and impact, and a remediation plan, typically within 7 days of acknowledgement.
- Status updates as we work on a fix, and a heads-up before the fix and advisory are published.
- Credit in the release notes if you'd like it (tell us how you'd like to be credited, or if you'd prefer to stay anonymous).

We ask that you give us a reasonable window to ship a fix before any public disclosure, and that you avoid accessing or modifying data that isn't yours while testing.

## Scope

In scope:

- The API server and workers (`apps/api`) — authentication, authorization, quota/rate limiting, ingestion, retrieval
- The connectors (Slack, Notion, Google Docs, Linear, transcript webhooks) and their OAuth flows
- The SDKs and integrations under `packages/`
- The hosted service at `anansimemory.com` (non-destructive testing only)

Out of scope: denial-of-service via volume alone, reports from automated scanners without a demonstrated impact, and issues in third-party dependencies without a concrete exploit path in Anansi (though we still appreciate a heads-up).

## Existing security posture

For context when assessing a finding, the project already implements:

- API keys HMAC-SHA256 hashed at rest — raw keys are never stored
- OAuth tokens (Slack, Notion, Google) encrypted with AES-256-GCM
- HMAC-signed OAuth state parameters to prevent CSRF
- Secret redaction on all content before ingestion
- Row-level security on `memory_chunks` as a DB-level backstop
- Atomic, Redis-backed rate limiting (sliding-window sorted set in a single Lua script)
- SSRF guards on outbound webhooks and URL ingestion (HTTPS only, DNS-resolved public-address checks, no RFC-1918)
- Enforceable deployment modes (`DEPLOYMENT_MODE=local`) that reject cloud LLM/embedding keys and content-exporting telemetry at startup, so an air-gapped install cannot silently offload company content — see [`docs/enterprise/self-hosting.md`](docs/enterprise/self-hosting.md)

See the [Security section of the README](README.md#security) for details. Reports that bypass one of these controls are especially valuable.
