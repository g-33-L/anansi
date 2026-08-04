---
title: Self-Hosting Anansi
description: A comprehensive guide to deploying and managing a self-hosted Anansi instance using Docker Compose.
audience: [developer, operator]
edition: [oss, self-host, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Operator"
related_runbook: "docs/enterprise/backup-restore.md"
---

# Self-Hosting Anansi

This guide provides comprehensive instructions for deploying and managing a self-hosted Anansi instance. The recommended method for self-hosting is using Docker and Docker Compose, which provides a single-node topology suitable for many use cases.

## 1. Prerequisites

Before you begin, ensure you have the following installed on your host machine:

*   **Docker:** The containerization engine.
*   **Docker Compose:** For orchestrating the multi-container Anansi application.
*   **Git:** For cloning the Anansi repository.
*   **Node.js and pnpm:** Required for some initial setup steps and if you plan to do local development.

## 2. Configuration

### Step 2.1: Clone the Repository

First, clone the Anansi repository to your host machine:

```bash
git clone https://github.com/g-33-L/anansi.git
cd anansi
```

### Step 2.2: Set Up Environment Variables

Anansi is configured using environment variables.

1.  **Copy the example `.env` file:**
    ```bash
    cp .env.example .env
    ```

2.  **Generate Required Secrets:**
    The `.env` file requires several cryptographic keys for signing and encryption. The API server will not start without them. Generate these using `openssl` or a similar tool.

    ```bash
    # Generate a key for encrypting secrets at rest
    openssl rand -base64 32

    # Generate a key for signing CSRF cookies
    openssl rand -base64 32

    # Generate a key for HMAC-signing API keys
    openssl rand -base64 32

    # Generate a shared secret for authenticating internal queries (e.g., /metrics)
    openssl rand -base64 32
    ```
    Copy the output of these commands into the corresponding variables in your `.env` file (`ENCRYPTION_KEY`, `CSRF_SIGNING_KEY`, `API_KEY_HMAC_SECRET`, `QUERY_API_KEY`).

3.  **Configure Deployment Mode:**
    Anansi's security and privacy posture is controlled by the `DEPLOYMENT_MODE` environment variable. For a self-hosted instance where you control all infrastructure (including the LLM), `local` mode is recommended.

    *   **`local` (Air-gapped / Recommended for Self-Hosting):** Guarantees that no company content is sent to third-party AI providers. The server will refuse to start if any cloud API keys (e.g., `CEREBRAS_API_KEY`, `NOMIC_API_KEY`, `SENTRY_DSN`) are set. Requires a local Ollama instance for LLM and embedding inference.
    *   **`cloud` (Default):** Uses cloud providers for AI services if their keys are present, with local fallback.
    *   **`hybrid`:** Allows for an explicit mix of local and cloud providers.

    Set this in your `.env` file:
    ```ini
    DEPLOYMENT_MODE=local
    ```
    For a full explanation of deployment modes, see [Deployment Modes and Security Guarantees](/docs/architecture/deployment.md).

4.  **Review Other Variables:**
    The `.env` file contains other important variables for configuring database connections (PostgreSQL), Redis, and optional connectors. Review them and adjust as needed for your environment. For the default `docker-compose` setup, the default values are usually sufficient.

## 3. Running Anansi with Docker Compose

The `docker-compose.yml` file in the root of the repository defines the services required to run Anansi, including the API, database, and Redis.

1.  **Start the services:**
    ```bash
    docker compose up -d
    ```
    This will build the necessary Docker images and start all services in the background.

2.  **Access the Application:**
    *   **API:** The Anansi API will be available at `http://localhost:3000`.
    *   **Web UI:** The customer web application (`apps/web`) is typically run separately for development. For a production-like deployment, you would build the `apps/web` container and expose it through a reverse proxy.
    *   **Legacy Portal:** The legacy portal (if needed) is served by the API at `http://localhost:3000/portal`.

3.  **Check the Health of the Application:**
    Anansi provides two health check endpoints:
    *   **`/health`**: A simple liveness probe. Returns `200 OK` if the API server is running.
    *   **`/status`**: A readiness probe that checks connectivity to PostgreSQL and Redis. Returns `200 OK` if all checks pass, `503 Service Unavailable` otherwise.

## 4. Supported Topologies

### Single-Node (Default)

The provided `docker-compose.yml` deploys a single-node topology where the API server and BullMQ background workers run in the same process. This is suitable for many small to medium-sized deployments.

### Dedicated Workers

For larger deployments, you may want to run background workers in separate, dedicated processes for better scalability and resource management. The Anansi application supports this through the `worker-entry.ts` file (`apps/api/src/worker-entry.ts`).

To run a dedicated worker, you would create a separate container that starts the application with the `worker-entry.ts` script. This advanced topology requires a custom deployment manifest (e.g., Kubernetes manifests) and is not covered by the default `docker-compose.yml`.

## 5. Migration and Upgrades

To upgrade your self-hosted Anansi instance:

1.  **Pull the latest changes from the repository:**
    ```bash
    git pull origin main
    ```
2.  **Rebuild the Docker images:**
    ```bash
    docker compose build
    ```
3.  **Restart the services:**
    ```bash
    docker compose up -d
    ```
    When the API server starts, it will automatically apply any new database migrations.

## 6. Backup and Restore

Regularly backing up your PostgreSQL database is critical. For detailed instructions on how to perform backups and restore your Anansi instance, please refer to the **[Backup and Restore Guide](/docs/enterprise/backup-restore.md)**.