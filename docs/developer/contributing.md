# Contributing

Thanks for your interest in contributing to Anansi. Contributions of all kinds are welcome: bug fixes, features, docs, and test coverage.

## Prerequisites

- Node.js 20+
- pnpm 11+
- Docker (for PostgreSQL + Redis)
- A Nomic API key (or Ollama running locally)

## Setup

```bash
git clone https://github.com/g-33-L/anansi.git
cd anansi

pnpm install
docker compose up -d
cp .env.example apps/api/.env
cd apps/api && pnpm db:migrate
pnpm dev
```

See [local-development.md](local-development.md) for the full environment variable reference.

## Running tests

```bash
cd apps/api
pnpm test
```

Tests require a local PostgreSQL instance. The test suite **refuses to run against a non-localhost database**.

CI runs on every pull request and performs:

1. Type check + build (`pnpm build`)
2. Dependency audit (`pnpm audit --audit-level high`)
3. Full test suite with coverage against Postgres (pgvector) + Redis service containers

## Making changes

1. **Open an issue first** for anything non-trivial — bug report or feature request — so we can agree on the approach.
2. **Fork and create a branch** off `main` with a descriptive name, e.g. `fix/webhook-ssrf-check` or `feat/session-scoped-search`.
3. **Keep changes focused.** One logical change per PR. Unrelated refactors belong in separate PRs.
4. **Add or update tests** for any behavior change in `apps/api`. Bug fixes should include a regression test.
5. **Update the changelog.** Add an entry under `[Unreleased]` in `CHANGELOG.md` (`Added` / `Changed` / `Fixed`) for any user-visible change.
6. **Update docs** when you change API behavior, request/response shapes, or environment variables.

## Commit messages

- Imperative subject lines: "Fix SSRF check for IPv4-mapped IPv6 literals", not "fixed stuff".
- Subject under ~72 characters; use the body to explain *why* when the change isn't obvious.

## Pull requests

- Fill in the PR template: what changed, why, and how you tested it.
- Make sure `pnpm build` and the test suite pass locally before requesting review.
- Never commit secrets, `.env` files, or real API keys — test fixtures use obvious placeholders only.
- PRs are squash-merged, so a tidy title and description matter more than a tidy commit history.

## Repository layout

See [repository-structure.md](repository-structure.md) for the full directory map. Start with [ARCHITECTURE.md](https://github.com/g-33-L/anansi/blob/main/ARCHITECTURE.md) — it maps request lifecycles, the data model, and module boundaries.

## Reporting security issues

Do **not** open public issues for security vulnerabilities. See [SECURITY.md](https://github.com/g-33-L/anansi/blob/main/SECURITY.md) for the private disclosure process.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](https://github.com/g-33-L/anansi/blob/main/LICENSE).
