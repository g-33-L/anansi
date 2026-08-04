---
title: Troubleshooting Guide
description: A guide for self-hosted Anansi operators on how to diagnose and resolve common operational issues.
audience: [operator]
edition: [self-host, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Operator"
related_runbook: ""
---

# Troubleshooting Guide

This guide provides solutions and diagnostic steps for common issues you may encounter while running a self-hosted Anansi instance.

## 1. General Troubleshooting Steps

Before diving into specific issues, always start with these general steps:

1.  **Check the logs:** The primary source of information for any issue is the application logs. Use `docker compose logs` to view the logs for all services.
    ```bash
    docker compose logs -f api # View logs for the API service
    ```
2.  **Check the health endpoints:** Anansi provides two health check endpoints:
    *   `/health`: For a simple liveness check.
    *   `/status`: For a readiness check that includes connectivity to the database and Redis.
    Use `curl http://localhost:3000/status` to check the status of your instance.

## 2. Startup Issues

### Docker Compose Failures

*   **Symptom:** `docker compose up` fails with errors.
*   **Solution:**
    *   Ensure Docker and Docker Compose are installed and running correctly.
    *   Check for port conflicts. If another service on your host is using a port required by Anansi (e.g., `3000`, `5432`, `6379`), you will need to stop the other service or reconfigure the ports in `docker-compose.yml`.
    *   Ensure you have sufficient system resources (CPU, RAM).

### Database/Redis Connection Issues

*   **Symptom:** The API service logs show errors like "Connection refused" to PostgreSQL or Redis.
*   **Solution:**
    *   Ensure the `postgres` and `redis` services are running correctly: `docker compose ps`.
    *   Verify the `DATABASE_URL` and `REDIS_URL` in your `.env` file are correct and match the services defined in `docker-compose.yml`. For the default setup, these should point to `postgres` and `redis` hostnames, which are resolved by Docker's internal networking.

### Environment Variable Validation Errors

*   **Symptom:** The API service fails to start with a message about invalid deployment configuration.
    ```text
    [startup] Deployment configuration is invalid:
      - DEPLOYMENT_MODE=local forbids cloud LLM providers, but CEREBRAS_API_KEY is set.
        Unset CEREBRAS_API_KEY for an air-gapped install, or use DEPLOYMENT_MODE=hybrid ...
    ```
*   **Solution:**
    *   This is an intentional security feature. Read the error message carefully. It will tell you exactly which environment variable is conflicting with your chosen `DEPLOYMENT_MODE`.
    *   If you set `DEPLOYMENT_MODE=local`, you must unset all cloud provider API keys (e.g., `CEREBRAS_API_KEY`, `NOMIC_API_KEY`, `SENTRY_DSN`).
    *   Ensure all required secrets (`ENCRYPTION_KEY`, `CSRF_SIGNING_KEY`, etc.) are set in your `.env` file. The API will refuse to start without them.

## 3. API and Ingestion Issues

### 4xx / 5xx API Errors

*   **Symptom:** API requests are failing with `4xx` or `5xx` status codes.
*   **Solution:**
    *   **`401 Unauthorized`**: Your API key is invalid or missing. Verify that the `Authorization: Bearer ans_...` header is being sent correctly.
    *   **`402 Payment Required`**: Your monthly quota has been exceeded. This is not applicable to most self-hosted plans but may appear if you are using a licensed edition.
    *   **`429 Too Many Requests`**: You have exceeded the rate limit. Implement a retry mechanism with exponential backoff in your client application.
    *   **`5xx Server Error`**: This indicates a problem on the server side. Check the `docker compose logs api` for detailed error messages and stack traces.

### Ingestion Not Processing (Queue Backlog)

*   **Symptom:** `POST /v1/ingest` requests succeed with `202 Accepted`, but the content does not appear in `context` or `search` results after a reasonable time. This may indicate that the BullMQ background workers are stuck or have failed.
*   **Solution:**
    1.  **Check worker logs:** Look for errors in the `api` service logs that might be related to BullMQ or background processing.
    2.  **Check queue status:** Anansi includes a script to check the status of the BullMQ queues.
        ```bash
        docker compose exec api node apps/api/scripts/check-queue.mjs
        ```
        This will show the number of active, waiting, completed, and failed jobs in each queue (`embed`, `synthesis`, `retention`).
    3.  **Inspect failed jobs:** If there are failed jobs, inspect them for error messages.
    4.  **Re-enqueue jobs:** For certain recoverable failures, you can re-enqueue jobs. The `trigger-backfill.mjs` script can be used to re-enqueue chunks that have not been embedded.
        ```bash
        docker compose exec api node apps/api/scripts/trigger-backfill.mjs
        ```

## 4. Provider Issues (Local Mode)

### Ollama Connection Issues

*   **Symptom:** In `local` deployment mode, API logs show errors connecting to Ollama.
*   **Solution:**
    *   Ensure Ollama is running on your host machine.
    *   The Anansi API, running inside a Docker container, defaults to `http://localhost:11434` to connect to Ollama. This works for Linux hosts, but on macOS and Windows, you must override the `OLLAMA_BASE_URL` in your `.env` file to point to the special Docker hostname for the host machine:
        ```ini
        # In your .env file, for macOS or Windows Docker Desktop:
        OLLAMA_BASE_URL=http://host.docker.internal:11434
        ```
    *   Ensure the LLM and embedding models specified in `OLLAMA_LLM_MODEL` and `OLLAMA_EMBED_MODEL` have been pulled and are available in Ollama (`ollama list`).

## 5. Connector Issues

### Connector Authentication Failures

*   **Symptom:** You are unable to connect to Notion, Google Docs, or other third-party connectors.
*   **Solution:**
    *   Double-check that the `..._CLIENT_ID` and `..._CLIENT_SECRET` environment variables in your `.env` file are correct.
    *   Ensure that the OAuth redirect URIs are correctly configured in the third-party application settings to point to your Anansi instance's callback URL.

## 6. Incident Escalation

If you encounter a critical issue that you are unable to resolve with this guide:

*   **Self-Hosted OSS Users:** Gather all relevant logs and error messages and open a detailed [GitHub Issue](https://github.com/g-33-L/anansi/issues).
*   **Enterprise Support:** Customers with an enterprise support contract should follow the escalation procedure outlined in their support agreement.