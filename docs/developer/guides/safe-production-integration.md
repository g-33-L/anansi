---
title: Safe Production Integration - Best Practices
description: A task-first tutorial on best practices for integrating Anansi Memory into production environments, focusing on security, reliability, and observability.
audience: [developer, operator]
edition: [oss, self-host, cloud, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Developer Experience Lead"
related_runbook: ""
---

# Safe Production Integration: Best Practices

Integrating any external API into a production environment requires careful consideration of security, reliability, and observability. This guide outlines best practices for using Anansi Memory in production, ensuring your application is robust and your data is handled securely.

## Prerequisites

1.  **An Anansi API Key:** Obtain an API key for your production environment.
2.  **Anansi TypeScript SDK:** (or Python SDK) installed in your project.
3.  Familiarity with Anansi's core concepts from previous tutorials.

## 1. API Key Security

Your Anansi API key is a sensitive credential that grants access to your workspace's memory. Treat it like a password.

**Best Practices:**
*   **Environment Variables:** Always load your API key from environment variables (e.g., `process.env.ANANSI_API_KEY` in Node.js, `os.environ.get("ANANSI_API_KEY")` in Python). **Never hardcode API keys** directly into your source code.
*   **Secrets Management:** For containerized or serverless deployments, use a dedicated secrets management service (e.g., AWS Secrets Manager, Google Secret Manager, Azure Key Vault, HashiCorp Vault) to inject environment variables securely at runtime.
*   **Access Control:** Restrict access to your API keys to only those systems and personnel that absolutely require it.
*   **Rotation:** Regularly rotate your API keys.

```typescript
// NEVER hardcode your API key!
// const ANANSI_API_KEY = 'ans_your_hardcoded_key'; // BAD!

// Always use environment variables
const ANANSI_API_KEY = process.env.ANANSI_API_KEY; 

if (!ANANSI_API_KEY) {
  console.error("ANANSI_API_KEY is not set. Please set it as an environment variable.");
  process.exit(1);
}

const memory = new AnansiMemory({ apiKey: ANANSI_API_KEY });
```

## 2. Error Handling and Retries

Network requests can fail for many reasons (transient network issues, API rate limits, server errors). Your production integration should be resilient to these.

**Best Practices:**
*   **Graceful Degradation:** Your application should function even if Anansi Memory is temporarily unavailable or returns an error. Consider using cached data or skipping memory integration gracefully.
*   **Retry Logic:** Implement exponential backoff with jitter for transient errors (e.g., `429 Too Many Requests`, `5xx` server errors). Many HTTP client libraries offer built-in retry mechanisms.
*   **Specific Error Handling:** Differentiate between client errors (`4xx`) and server errors (`5xx`). Client errors often indicate issues with your request (e.g., missing `userId`), while server errors might be retriable.
    *   Anansi's SDKs throw `AnansiError` with `statusCode` for easy programmatic handling.

```typescript
import AnansiMemory, { AnansiError } from 'anansi-memory';
// ... initialization as above ...

async function ingestWithRetry(userId: string, content: string, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const result = await memory.ingest({ userId, content });
      console.log('Ingest successful:', result);
      return result;
    } catch (error) {
      if (error instanceof AnansiError) {
        if (error.statusCode === 429 || error.statusCode >= 500) {
          console.warn(`Ingest failed with status ${error.statusCode}. Retrying in ${2 ** i} seconds...`);
          await new Promise(resolve => setTimeout(resolve, (2 ** i) * 1000));
          continue; // Retry
        } else if (error.statusCode === 402) {
          console.error("Monthly quota exceeded. Please upgrade your plan.");
          // Don't retry, this is a permanent error.
          throw error;
        }
      }
      console.error('Ingest failed permanently:', error);
      throw error; // Re-throw other errors
    }
  }
  throw new Error(`Ingest failed after ${retries} retries.`);
}

// Example usage:
// ingestWithRetry('user-123', 'Some important content');
```

## 3. Rate Limiting and Quotas

Anansi imposes [rate limits](/docs/api/reference.md#rate-limits) (requests per minute) and [monthly quotas](/docs/api/reference.md#monthly-quotas) (total calls per month) to ensure fair usage and service stability.

**Best Practices:**
*   **Monitor Usage:** Regularly check your Anansi dashboard for API usage.
*   **Handle `429` (Rate Limit Exceeded):** Implement the retry logic described above, respecting the `Retry-After` header if provided by the API.
*   **Handle `402` (Monthly Quota Exceeded):** This is a signal to upgrade your plan. Your application should not retry these requests automatically. Alert an administrator if this occurs.
*   **Batch Ingest:** Use `POST /v1/ingest/batch` where appropriate to optimize API calls when ingesting multiple items, reducing the number of requests while still consuming quota per item.

## 4. Deployment Modes

Anansi supports different deployment modes (`local`, `cloud`, `hybrid`) which affect how it handles LLM/embedding inference and telemetry egress.

**Best Practices:**
*   **Configure `DEPLOYMENT_MODE`:** Ensure your production environment's `DEPLOYMENT_MODE` environment variable is set correctly (`cloud` or `hybrid` for hosted deployments). This enforces privacy guarantees and resource usage.
*   **Local Mode for Development:** Use `local` mode during development to prevent accidental telemetry export or using cloud resources.
*   **Understand Implications:** Be aware that `DEPLOYMENT_MODE` can gate certain features (e.g., cloud LLM usage) as detailed in `ANANSI_ARCHITECTURE_STATE.md`.

## 5. Monitoring and Observability

To ensure the health and performance of your Anansi integration, establish robust monitoring.

**Best Practices:**
*   **Logging:** Anansi API emits structured logs (JSON) that can be integrated into your centralized logging solution (e.g., ELK Stack, Splunk, Datadog). Monitor for errors and unusual patterns.
*   **Metrics:** Anansi exposes a `/metrics` endpoint for Prometheus-style metrics. Integrate this into your monitoring system to track API call volume, latency, and error rates.
*   **Health Checks:** Use the `/health` and `/status` endpoints for liveness and readiness probes in your deployment (e.g., Kubernetes).

## 6. Data Retention (`ttl`)

Use the `ttl` (Time-To-Live) parameter during `ingest` to automatically expire and delete memory chunks after a specified duration. This is crucial for compliance and managing storage costs.

**Best Practices:**
*   **Default `ttl`:** Establish a default `ttl` for different types of data based on your application's requirements and privacy policies.
*   **Explicit `ttl`:** Override the default `ttl` for specific data that has a shorter or longer relevancy period.
*   **GDPR Compliance:** For full user data deletion, use the `DELETE /v1/user` endpoint.

```typescript
// Ingest content that expires in 30 days (2592000 seconds)
await memory.ingest({
  userId: 'gdpr-user-789',
  content: 'User consented to data processing for 30 days.',
  ttl: 2592000, 
});
```

By following these best practices, you can build a reliable, secure, and observable integration with Anansi Memory that scales with your application's needs.

Happy integrating!