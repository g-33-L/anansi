# syntax=docker/dockerfile:1

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN npm install -g pnpm@11.5.1

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

COPY apps/api/ ./apps/api/
COPY tsconfig.json ./

RUN pnpm --filter @anansi/api build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN npm install -g pnpm@11.5.1

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Copy migrations so the server can run them on startup
COPY apps/api/src/lib/db/migrations ./apps/api/src/lib/db/migrations

# Copy static assets
COPY apps/api/public/ ./apps/api/public/

WORKDIR /app/apps/api

EXPOSE 3000

CMD ["node", "dist/index.js"]
