---
title: Source and Evidence Inspection - Raw Memories and Search
description: A task-first tutorial on how to inspect the raw memories Anansi stores and directly query them using `/v1/memories` and `/v1/search` endpoints.
audience: [developer]
edition: [oss, self-host, cloud, enterprise]
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Developer Experience Lead"
related_runbook: ""
---

# Source and Evidence Inspection: Raw Memories and Search

While Anansi's `context` API provides a high-level, synthesized view of user memory, sometimes you need to dive deeper. This tutorial shows you how to inspect the raw memory chunks that Anansi stores using `GET /v1/memories` and perform direct searches with `POST /v1/search`. These endpoints are crucial for debugging, understanding content provenance, and building custom retrieval experiences.

## Prerequisites

1.  **An Anansi API Key:** Obtain an API key from your Anansi dashboard.
2.  **Anansi TypeScript SDK:** Installed in your project.
3.  Familiarity with [First Memory: Ingesting and Retrieving User Context](/docs/developer/guides/first-memory.md).

## Step 1: Ingesting Sample Data

Let's ingest a few distinct pieces of content to work with. We'll use different `sourceType` and `sourceId` values to make filtering and searching more illustrative.

```typescript
import AnansiMemory from 'anansi-memory';

const ANANSI_API_KEY = process.env.ANANSI_API_KEY || 'your_anansi_api_key';
const memory = new AnansiMemory({ apiKey: ANANSI_API_KEY });
const userId = 'evidence-user-789';

async function ingestSampleData() {
  try {
    await memory.ingest({
      userId: userId,
      content: 'The user recently purchased a new monitor for their home office, a Dell Ultrasharp.',
      sourceType: 'conversation',
      sourceId: 'chat-log-1',
      metadata: { product: 'monitor', brand: 'Dell' },
    });

    await memory.ingest({
      userId: userId,
      content: 'They are also researching ergonomic keyboards. Looking at Keychron K2.',
      sourceType: 'note',
      sourceId: 'research-note-a',
      metadata: { category: 'keyboard', brand: 'Keychron' },
    });

    await memory.ingest({
      userId: userId,
      content: 'A customer support interaction about setting up the Dell monitor.',
      sourceType: 'support_ticket',
      sourceId: 'ticket-456',
      metadata: { product: 'monitor', issue: 'setup' },
    });

    console.log('Ingested sample data.');
    await new Promise(resolve => setTimeout(resolve, 5000)); // Give time for processing
  } catch (error) {
    console.error('Ingest failed:', error);
  }
}

// ingestSampleData(); // Uncomment to run ingestion
```

## Step 2: Listing Raw Memories with `GET /v1/memories`

The `listMemories` SDK method (corresponding to `GET /v1/memories`) allows you to retrieve raw memory chunks, with pagination and filtering.

### List all memories for a user

```typescript
async function listAllMemories() {
  console.log('\n--- Listing All Memories ---');
  try {
    const { memories, total } = await memory.listMemories({
      userId: userId,
      limit: 10,
    });
    console.log(`Found ${total} memories. Displaying ${memories.length}:`);
    memories.forEach(mem => {
      console.log(`- ID: ${mem.id}, Source: ${mem.sourceType} (${mem.sourceId}), Content: "${mem.content.slice(0, 50)}..."`);
    });
  } catch (error) {
    console.error('listMemories failed:', error);
  }
}

// listAllMemories(); // Uncomment to run
```

### Filtering by `sourceType`

You can filter memories by `sourceType` to narrow down the results.

```typescript
async function filterMemoriesBySourceType() {
  console.log('\n--- Filtering Memories by sourceType: conversation ---');
  try {
    const { memories, total } = await memory.listMemories({
      userId: userId,
      sourceType: 'conversation',
    });
    console.log(`Found ${total} 'conversation' memories. Displaying ${memories.length}:`);
    memories.forEach(mem => {
      console.log(`- ID: ${mem.id}, Content: "${mem.content.slice(0, 50)}..."`);
    });
  } catch (error) {
    console.error('listMemories with sourceType failed:', error);
  }
}

// filterMemoriesBySourceType(); // Uncomment to run
```

### Ranking with `q` (Query)

You can pass a `q` parameter to `listMemories` to rank the results by relevance to a query, similar to how `context` uses a query. This can help you quickly find the most pertinent raw facts.

```typescript
async function rankMemoriesWithQuery() {
  console.log('\n--- Ranking Memories with Query ---');
  try {
    const { memories, total } = await memory.listMemories({
      userId: userId,
      q: 'keyboards',
      limit: 5,
    });
    console.log(`Found ${total} memories relevant to 'keyboards'. Displaying ${memories.length}:`);
    memories.forEach(mem => {
      console.log(`- ID: ${mem.id}, Similarity: ${mem.similarity?.toFixed(2)}, Content: "${mem.content.slice(0, 50)}..."`);
    });
  } catch (error) {
    console.error('listMemories with query failed:', error);
  }
}

// rankMemoriesWithQuery(); // Uncomment to run
```

## Step 3: Direct Search with `POST /v1/search`

The `search` SDK method (corresponding to `POST /v1/search`) gives you even more control over the retrieval process, returning raw chunks with similarity scores. It supports `searchMode` (semantic, hybrid, keyword), `alpha`, `threshold`, and `filters`.

```typescript
async function performDirectSearch() {
  console.log('\n--- Performing Direct Search ---');
  try {
    const { results, total } = await memory.search({
      userId: userId,
      query: 'ergonomic setup',
      searchMode: 'hybrid', // Combines semantic and keyword search
      limit: 5,
      filters: { metadata: { product: 'monitor' } }, // Use metadata filters
    });
    console.log(`Found ${total} search results. Displaying ${results.length}:`);
    results.forEach(res => {
      console.log(`- Score: ${res.score.toFixed(2)}, Source: ${res.sourceId}, Content: "${res.content.slice(0, 50)}..."`);
      console.log(`  Metadata: ${JSON.stringify(res.metadata)}`);
    });
  } catch (error) {
    console.error('search failed:', error);
  }
}

// performDirectSearch(); // Uncomment to run
```

## Step 4: Understanding Provenance

Both `listMemories` and `search` return `sourceId` and `metadata` for each chunk. This information is critical for understanding the origin and context of a memory.
*   The `sourceId` directly links back to the original document or event that was ingested.
*   The `metadata` (including `sourceType`, `timestamp`, and any custom fields you provided) gives rich contextual details.

By inspecting these fields, you can debug why certain information is being retrieved, attribute facts to their original sources, and even implement "cite your sources" features in your AI applications.

## Next Steps

You've learned how to directly access and query the raw building blocks of Anansi's memory.

*   Experiment with different `searchMode` options (`semantic`, `hybrid`, `keyword`) in `memory.search()`.
*   Utilize `filters` in `memory.search()` for more precise retrieval based on your custom metadata.
*   Consider using the raw memories to build features like a "memory stream" or a "timeline of facts" in your application.

Happy inspecting!