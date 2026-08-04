# Local Development

Run the full Anansi stack on your laptop with zero external API calls (using Ollama).

## Prerequisites

- Node.js 20+
- pnpm 11+
- Docker (for PostgreSQL + Redis)
- [Ollama](https://ollama.com) running locally (optional — for fully local LLM + embeddings)

## Setup

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

The server starts on `http://localhost:3000`.

| URL | What |
|---|---|
| `http://localhost:3000` | API (health check) |
| `http://localhost:3000/portal` | Developer portal |
| `http://localhost:3000/docs` | API docs site |
| `http://localhost:3000/dashboard` | Slack workspace dashboard |

## Environment variables

### Required for local dev

| Variable | Description |
|---|---|
| `DATABASE_URL` | `postgresql://anansi:anansi@localhost:5432/anansi` (matches `docker compose`) |
| `REDIS_URL` | `redis://localhost:6379` |
| `ENCRYPTION_KEY` | 32-byte hex — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CSRF_SIGNING_KEY` | Any strong random string |
| `API_KEY_HMAC_SECRET` | 32-byte hex — must be different from `ENCRYPTION_KEY` |
| `QUERY_API_KEY` | Protects `/metrics` endpoint — any random string |

### LLM and embeddings

The provider chain falls back automatically:

1. **Cerebras** (if `CEREBRAS_API_KEY` is set) — primary for production
2. **GitHub Models** (if `GITHUB_TOKEN` is set) — fallback
3. **Ollama** (always available) — local dev fallback

For fully local development, just run Ollama with the required models:

```bash
# Pull the default models
ollama pull llama3.1:8b
ollama pull nomic-embed-text
```

Leave `CEREBRAS_API_KEY` and `GITHUB_TOKEN` unset — the stack falls back to Ollama automatically.

### Optional

| Variable | When needed |
|---|---|
| `NOMIC_API_KEY` | Cloud embeddings (falls back to Ollama `nomic-embed-text`) |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET` | Slack bot only |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`, etc. | Billing only |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Portal login (Supabase auth) |
| `RESEND_API_KEY` | Magic link emails (logs to console in dev) |

## Running tests

```bash
cd apps/api
pnpm test
```

Tests require a local PostgreSQL instance (the `docker compose up -d` from setup covers this). The test suite **refuses to run against a non-localhost database** as a safety measure.

## Useful commands

```bash
# Run the full test suite
cd apps/api && pnpm test

# Build all packages
pnpm build

# Lint
pnpm lint

# Typecheck
pnpm typecheck
```
