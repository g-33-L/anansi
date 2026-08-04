# Contributing to Anansi

Thanks for your interest in contributing. Anansi is a developer memory API — `ingest` to remember, `context` to retrieve — and contributions of all kinds are welcome: bug fixes, features, docs, and test coverage.

## Prerequisites

- Node.js 20+
- pnpm 11+
- Docker (for PostgreSQL + Redis)
- A Nomic API key (or Ollama running locally)

## Local development setup

```bash
git clone https://github.com/g-33-L/anansi.git
cd anansi

# Install dependencies
pnpm install

# Start PostgreSQL + Redis
docker compose up -d

# Copy env and fill in values
cp .env.example apps/api/.env

# Run DB migrations
cd apps/api && pnpm db:migrate

# Start the API server
pnpm dev
```

The server starts on `http://localhost:3000`. The developer portal is at `http://localhost:3000/portal`, and the docs site is served by the same process at `http://localhost:3000/docs`.

See the [README](README.md#local-development) for the full list of environment variables. For local development you only need `DATABASE_URL`, `REDIS_URL`, the crypto secrets (`ENCRYPTION_KEY`, `CSRF_SIGNING_KEY`, `API_KEY_HMAC_SECRET`, `QUERY_API_KEY`), and an LLM/embedding provider — Slack, Stripe, and Resend variables are optional.

## Repository layout

Start with [ARCHITECTURE.md](ARCHITECTURE.md) — it maps the request lifecycles, data model, and module boundaries. This is a pnpm workspace managed with Turbo:

- `apps/api` — the main application (Hono + Node.js): routes (including the landing page and `/docs` site), workers, and core libraries
- `apps/graph-explorer` — the memory-graph explorer (Vite + React, internal demo)
- `examples/` — runnable integration templates (Claude chatbot, voice agent)
- `packages/` — the SDKs and integrations (`sdk`, `sdk-python`, `ai-sdk`, `langchain`, `tools`, `mcp`)

## Running tests

```bash
cd apps/api
pnpm test
```

Tests require a local PostgreSQL instance (the `docker compose up -d` from setup is enough), and `DATABASE_URL` / `REDIS_URL` must be present in your shell — `vitest` does not read `.env`, so a bare `pnpm test` with an unset `DATABASE_URL` fails at import with `process.exit unexpectedly called with "1"`:

```bash
DATABASE_URL=postgresql://anansi:anansi@localhost:5432/anansi \
REDIS_URL=redis://localhost:6379 \
pnpm test
```

> **The suite wipes your local database.** Each test file runs `TRUNCATE workspaces CASCADE`, so anything you ingested while trying the quickstart is deleted — including API keys you seeded. This is expected; just re-seed a key afterwards. As a safety measure the suite refuses to run against a non-localhost database, but it offers no such protection for local data.

CI runs on every pull request and must pass before merge. It performs:

1. Type check + build (`pnpm build`)
2. Dependency audit (`pnpm audit --audit-level high`)
3. The full test suite with coverage against Postgres (pgvector) + Redis service containers

## Making changes

1. **Open an issue first** for anything non-trivial — a bug report or feature request — so we can agree on the approach before you invest time.
2. **Fork the repo and create a branch** off `main` with a descriptive name, e.g. `fix/webhook-ssrf-check` or `feat/session-scoped-search`.
3. **Keep changes focused.** One logical change per pull request. Unrelated refactors belong in separate PRs.
4. **Add or update tests** for any behavior change in `apps/api`. Bug fixes should include a regression test.
5. **Update the changelog.** Add an entry under the `[Unreleased]` section of `CHANGELOG.md` (`Added` / `Changed` / `Fixed`) for any user-visible change.
6. **Update docs** (README, `apps/api/src/routes/docs.tsx`) when you change API behavior, request/response shapes, or environment variables.

### Commit messages

- Write clear, imperative subject lines: "Fix SSRF check for IPv4-mapped IPv6 literals", not "fixed stuff".
- Keep the subject under ~72 characters; use the body to explain *why* when the change isn't obvious.

### Pull requests

- Fill in the PR template: what changed, why, and how you tested it.
- Make sure `pnpm build` and the test suite pass locally before requesting review.
- Never commit secrets, `.env` files, or real API keys — test fixtures use obvious placeholders only.
- PRs are squash-merged, so a tidy title and description matter more than a tidy commit history.

## Reporting security issues

Please do **not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for the private disclosure process.

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## License

Anansi is open-core — see [License](README.md#license) in the README for the
full split. By contributing to a file under the MIT license, you agree your
contribution is licensed under the [MIT License](LICENSE). By contributing to
a file under the Enterprise Edition license (each such file's header names
`LICENSE-EE`), you agree your contribution is licensed under [`LICENSE-EE`](LICENSE-EE),
including the relicensing grant in its §4.
