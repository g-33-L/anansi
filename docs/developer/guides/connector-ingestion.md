---
title: Connector Ingestion - Integrating External Data Sources
description: A task-first tutorial on how to integrate external data sources like Notion and Google Docs with Anansi Memory using configured connectors.
audience: [developer, operator]
edition: [self-host, cloud, enterprise] # Connectors typically require a deployed Anansi instance
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Developer Experience Lead"
related_runbook: ""
---

# Connector Ingestion: Integrating External Data Sources

Anansi Memory can integrate with various external data sources through its connector system, allowing you to automatically ingest content from platforms like Notion and Google Docs. This tutorial explains how to enable and utilize these connectors to enrich your user's memory profiles.

## Prerequisites

1.  **An Anansi Deployment:** Connectors are part of the Anansi backend, so you need a running Anansi instance (self-hosted or cloud deployment).
2.  **An Anansi API Key:** Obtain an API key from your Anansi dashboard.
3.  **Third-Party API Credentials:** You'll need `client_id` and `client_secret` from the respective third-party platforms (Notion, Google).

## Step 1: Enabling Connectors in Your Anansi Deployment

Anansi connectors are enabled by setting specific environment variables in your Anansi deployment. When these variables are present, Anansi automatically starts workers to manage data ingestion from these sources.

### Notion Connector

To enable the Notion connector, set the following environment variables:

*   `NOTION_CLIENT_ID`: Your Notion OAuth client ID.
*   `NOTION_CLIENT_SECRET`: Your Notion OAuth client secret.

You can obtain these by registering an integration on Notion's developer platform.

### Google Docs Connector

To enable the Google Docs connector, set the following environment variables:

*   `GOOGLE_CLIENT_ID`: Your Google OAuth client ID.
*   `GOOGLE_CLIENT_SECRET`: Your Google OAuth client secret.

You can obtain these by creating OAuth 2.0 Client IDs in the Google Cloud Console.

**Example `.env` configuration:**

```dotenv
# .env
# ... other Anansi environment variables ...

# Notion Connector
NOTION_CLIENT_ID=your_notion_client_id
NOTION_CLIENT_SECRET=your_notion_client_secret

# Google Docs Connector
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

After setting these variables, restart your Anansi API service for the changes to take effect. The Anansi API logs will indicate whether the connectors were successfully enabled.

## Step 2: Ingesting Data via Connectors

Once enabled, Anansi's internal workers will manage the synchronization process with the third-party platforms. The content ingested by connectors will appear in a user's memory, typically attributed with a `sourceType` reflecting the connector (e.g., `notion_page`, `google_doc`) and a `sourceId` pointing to the original document's identifier.

You do not directly call an API endpoint to "trigger" a connector sync from your client application. Instead, you interact with the third-party platform (e.g., share a Notion page with your Anansi integration), and the Anansi backend handles the ingestion.

## Step 3: Querying Data Ingested by Connectors

Data ingested through connectors behaves like any other memory data. You can retrieve it using the `context` API and filter/search it using `listMemories` or `search` based on its `sourceType` and other metadata.

Let's assume a Notion page about a user's project has been ingested.

```typescript
import AnansiMemory from 'anansi-memory';

const ANANSI_API_KEY = process.env.ANANSI_API_KEY || 'your_anansi_api_key';
const memory = new AnansiMemory({ apiKey: ANANSI_API_KEY });
const userId = 'project-owner-123';

async function queryConnectorData() {
  console.log('\n--- Querying Data from Connectors ---');
  try {
    // Example: Retrieve context for a user whose Notion data has been ingested
    const contextResult = await memory.context({
      userId: userId,
      q: 'What projects are they working on?',
    });
    console.log('\nContext for project owner:\n', memory.formatForPrompt(contextResult));

    // Example: List raw memories, filtered by sourceType 'notion_page'
    const { memories, total } = await memory.listMemories({
      userId: userId,
      sourceType: 'notion_page', // Filter by Notion source type
      limit: 5,
    });
    console.log(`\nFound ${total} Notion pages. Displaying ${memories.length}:`);
    memories.forEach(mem => {
      console.log(`- Source ID: ${mem.sourceId}, Content: "${mem.content.slice(0, 50)}..."`);
    });

  } catch (error) {
    console.error('Querying connector data failed:', error);
  }
}

// queryConnectorData(); // Uncomment to run
```

## Step 4: Understanding Connector Metadata

When content is ingested via a connector, Anansi automatically enriches the metadata associated with the memory chunks. This typically includes:

*   `sourceType`: (e.g., `notion_page`, `google_doc`)
*   `sourceId`: The unique identifier of the original document/page in the third-party system.
*   Other platform-specific metadata (e.g., Notion page title, Google Doc owner).

This rich metadata allows for fine-grained filtering and tracing of information back to its original source.

## Next Steps

*   Explore the full capabilities of Notion and Google Docs APIs to understand what types of content can be ingested.
*   Implement webhooks or polling mechanisms in your application to react to new or updated content from connected sources and trigger re-ingestion if necessary (though Anansi workers handle much of this automatically).
*   Consider developing custom connectors for other platforms your application might use.

Happy integrating!