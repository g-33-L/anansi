---
title: First Memory - Ingesting and Retrieving User Context
description: A task-first tutorial on how to get started with Anansi Memory by ingesting your first piece of user data and retrieving synthesized context.
audience: [developer]
edition: [oss, self-host, cloud, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc" # Placeholder, replace with actual SHA
owner: "Developer Experience Lead"
related_runbook: ""
---

# First Memory: Ingesting and Retrieving User Context

This tutorial will guide you through the fundamental steps of using Anansi Memory: ingesting data about a user and then retrieving a synthesized context based on that data. We'll use the Anansi TypeScript SDK for our examples.

## Prerequisites

Before you begin, ensure you have:

1.  **An Anansi API Key:** Obtain an API key from your Anansi dashboard or by following the [Quickstart Guide](/docs/developer/quickstart.md).
2.  **Node.js and npm/Yarn:** Installed on your system.
3.  **Anansi TypeScript SDK:** Installed in your project.

    ```bash
    npm install anansi-memory
    # or
    yarn add anansi-memory
    ```

## Step 1: Initialize the Anansi SDK

First, import and initialize the `AnansiMemory` client with your API key.

```typescript
import AnansiMemory from 'anansi-memory';

const ANANSI_API_KEY = process.env.ANANSI_API_KEY || 'your_anansi_api_key'; // Replace with your actual key or use an environment variable

const memory = new AnansiMemory({
  apiKey: ANANSI_API_KEY,
  // baseUrl: 'https://your-self-hosted-anansi-instance.com' // Uncomment if self-hosting
});

const userId = 'demo-user-123'; // A unique identifier for your user
```

## Step 2: Ingest Your First Piece of Memory

Let's ingest a simple fact about our `demo-user-123`. We'll use the `ingest` method, providing the `userId` and the `content` to be remembered. We can also specify a `sourceType` for better organization and future filtering.

```typescript
async function ingestFirstMemory() {
  try {
    const result = await memory.ingest({
      userId: userId,
      content: 'The user is interested in learning about large language models (LLMs).',
      sourceType: 'user_interest', // A custom source type
      metadata: {
        topic: 'AI/ML',
        priority: 'high',
      },
    });
    console.log('Ingest Result:', result);
    // Expected output: { id: 'uuid-of-ingested-item', queued: true }
  } catch (error) {
    console.error('Ingest failed:', error);
  }
}

ingestFirstMemory();
```

The `ingest` call is asynchronous and typically returns quickly. The `queued: true` in the response indicates that the content has been accepted and will be processed in the background (chunked, embedded, and synthesized).

## Step 3: Retrieve Synthesized User Context

After ingesting some data, you can retrieve a synthesized overview of what Anansi remembers about the user. The `context` method combines various pieces of memory into a coherent profile.

```typescript
async function retrieveUserContext() {
  try {
    // Give a moment for ingestion to process (in a real app, you'd handle this more robustly)
    await new Promise(resolve => setTimeout(resolve, 3000)); 

    const contextResult = await memory.context({
      userId: userId,
      q: 'What are their interests?', // An optional query to focus the context
    });

    console.log('Context Result:', contextResult);
    /*
    Expected output (simplified):
    {
      static: ["The user is interested in learning about large language models (LLMs)."],
      dynamic: [],
      relevant: [
        {
          content: "The user is interested in learning about large language models (LLMs).",
          similarity: 0.98,
          metadata: { sourceType: "user_interest", topic: "AI/ML", priority: "high", ... }
        }
      ],
      temporal: [],
      entities: []
    }
    */

    // AnansiMemory also provides a utility to format this for an LLM prompt
    const formattedPrompt = memory.formatForPrompt(contextResult);
    console.log('\nFormatted for LLM Prompt:\n', formattedPrompt);
    /*
    Expected output:
    ## User — Stable facts
    - The user is interested in learning about large language models (LLMs).
    ## Relevant history
    - The user is interested in learning about large language models (LLMs).
    */

  } catch (error) {
    console.error('Context retrieval failed:', error);
  }
}

retrieveUserContext();
```

## Step 4: Interpreting the Context Result

The `ContextResult` object contains several arrays that represent different facets of the user's memory:

*   **`static`**: Core, stable facts about the user that are unlikely to change often.
*   **`dynamic`**: More fluid, current context or recent interactions.
*   **`relevant`**: Raw memory chunks that were deemed relevant to the optional `q` (query) provided in the `context` call. These include similarity scores and original metadata.
*   **`temporal`**: (Pro+ feature) Facts that are valid only within a specific time range.
*   **`entities`**: (Pro+ feature) Extracted entities and their relationships, forming a knowledge graph.

The `memory.formatForPrompt(contextResult)` utility is designed to convert this structured information into a concise text block suitable for injecting into the system prompt of a Large Language Model, helping it understand the user's background without exceeding context window limits.

## Next Steps

You've successfully ingested your first memory and retrieved context! From here, you can:

*   Explore more ingestion options, such as `sourceId` for idempotency or `ttl` for expiring memories.
*   Experiment with different queries (`q`) for `context` calls to see how the `relevant` chunks change.
*   Integrate Anansi Memory into your application's user flows.
*   Learn about [Source and Evidence Inspection: Raw Memories and Search](/docs/developer/guides/source-evidence.md) to understand how Anansi stores and retrieves raw data.
*   Learn about [Connector Ingestion: Integrating External Data Sources](/docs/developer/guides/connector-ingestion.md) to pull data from Notion, Google Docs, and more.
*   Learn about [Safe Production Integration: Best Practices](/docs/developer/guides/safe-production-integration.md) for deploying Anansi in production environments.
*   Learn about [Temporal Query: Understanding `asOf` and `asOfKnowledge`](/docs/developer/guides/temporal-query.md) to explore the bi-temporal nature of Anansi.

Happy building!