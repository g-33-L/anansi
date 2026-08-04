---
title: Temporal Query - Understanding `asOf` and `asOfKnowledge`
description: A task-first tutorial on how to perform temporal queries using Anansi Memory's `asOf` (valid-time) and `asOfKnowledge` (knowledge-time) parameters.
audience: [developer]
edition: [pro, scale, enterprise] # Temporal queries are Pro+ features
last_verified: 2026-08-01
verified_commit: "94c039fc"
owner: "Developer Experience Lead"
related_runbook: ""
---

# Temporal Query: Understanding `asOf` and `asOfKnowledge`

Anansi Memory's bi-temporal data model is a powerful feature that allows you to query information not just as it is "now," but as it "was true at a specific time" (valid-time) and as the system "knew it at a specific time" (knowledge-time). This tutorial explains how to use the `asOf` and `asOfKnowledge` parameters in your `context` and `listEntities` API calls.

## Prerequisites

1.  **An Anansi API Key:** With access to Pro+ features (temporal queries and entity graph).
2.  **Anansi TypeScript SDK:** Installed in your project.
3.  Familiarity with [First Memory: Ingesting and Retrieving User Context](/docs/developer/guides/first-memory.md).

## Introduction to Valid-Time and Knowledge-Time

*   **Valid-Time (`asOf`)**: Refers to when a fact *was true in the real world*. For example, "John worked at Acme Corp from 2020 to 2024". Even if you learn this fact in 2025, its valid-time is still 2020-2024. `asOf` queries let you reconstruct a user's profile as if it were a specific date in history.
*   **Knowledge-Time (`asOfKnowledge`)**: Refers to when the system *learned or recorded* a fact. You might learn about John's past employment at Acme Corp in 2025. The knowledge-time for that fact's recording is 2025, even if its valid-time is in the past. `asOfKnowledge` queries let you see the system's state of knowledge at a given point in time.

## Step 1: Ingesting Temporal Data

To demonstrate temporal queries, let's ingest some facts with explicit valid-time boundaries or that change over time. Anansi automatically extracts temporal information from content.

For this example, imagine we are tracking a user's employment history.

```typescript
import AnansiMemory from 'anansi-memory';

const ANANSI_API_KEY = process.env.ANANSI_API_KEY || 'your_anansi_api_key';
const memory = new AnansiMemory({ apiKey: ANANSI_API_KEY });
const userId = 'temporal-user-456';

async function ingestTemporalFacts() {
  try {
    // Fact 1: User worked at Company A
    await memory.ingest({
      userId: userId,
      content: 'From 2020-01-01 to 2022-12-31, Alex worked as a Software Engineer at Company A.',
      sourceType: 'employment_history',
      metadata: { company: 'Company A' },
    });

    // Fact 2: User started at Company B later
    await memory.ingest({
      userId: userId,
      content: 'As of 2023-01-01, Alex started as a Senior Engineer at Company B. This was recorded on 2023-01-05.',
      sourceType: 'employment_history',
      metadata: { company: 'Company B' },
    });
    
    // Fact 3: A later update about Company B, recorded much later
    await memory.ingest({
      userId: userId,
      content: 'Alex is still a Senior Engineer at Company B as of 2024-06-01.',
      sourceType: 'employment_history',
      metadata: { company: 'Company B' },
    });

    console.log('Ingested temporal facts.');
    // Give a moment for ingestion to process
    await new Promise(resolve => setTimeout(resolve, 5000)); 
  } catch (error) {
    console.error('Ingest failed:', error);
  }
}

// ingestTemporalFacts(); // Uncomment to run ingestion
```

## Step 2: Querying with `asOf` (Valid-Time)

The `asOf` parameter reconstructs the user's profile (static, dynamic, temporal facts, and entities) as it *was true* at a specific date. This ignores when Anansi learned the fact, focusing solely on its real-world validity.

Let's query Alex's context as of `2022-03-15` (when they were at Company A) and then `2024-03-15` (when they were at Company B).

```typescript
async function queryWithAsOf() {
  console.log('\n--- Querying with asOf ---');

  // As of March 15, 2022 (should show Company A)
  const context2022 = await memory.context({
    userId: userId,
    asOf: '2022-03-15',
  });
  console.log('\nContext as of 2022-03-15:');
  console.log(memory.formatForPrompt(context2022));
  // Expected: mentions Company A in static/temporal

  // As of March 15, 2024 (should show Company B)
  const context2024 = await memory.context({
    userId: userId,
    asOf: '2024-03-15',
  });
  console.log('\nContext as of 2024-03-15:');
  console.log(memory.formatForPrompt(context2024));
  // Expected: mentions Company B in static/temporal
}

// queryWithAsOf(); // Uncomment to run query
```

## Step 3: Querying with `asOfKnowledge` (Knowledge-Time)

The `asOfKnowledge` parameter reconstructs the user's profile based on what Anansi *knew* by a specific date, regardless of when those facts were truly valid. This is useful for debugging, auditing, or understanding the system's state at a historical point in time.

Let's query Alex's context based on what Anansi knew as of `2023-01-02` (before it learned about Company B) and then `2024-07-01` (after all facts were ingested).

```typescript
async function queryWithAsOfKnowledge() {
  console.log('\n--- Querying with asOfKnowledge ---');

  // What Anansi knew as of 2023-01-02 (should only know about Company A, if recorded by then)
  const contextKnown2023 = await memory.context({
    userId: userId,
    asOfKnowledge: '2023-01-02',
  });
  console.log('\nContext as of knowledge time 2023-01-02:');
  console.log(memory.formatForPrompt(contextKnown2023));
  // Expected: primarily Company A, potentially nothing about Company B

  // What Anansi knew as of 2024-07-01 (should know all facts, including Company B update)
  const contextKnown2024 = await memory.context({
    userId: userId,
    asOfKnowledge: '2024-07-01',
  });
  console.log('\nContext as of knowledge time 2024-07-01:');
  console.log(memory.formatForPrompt(contextKnown2024));
  // Expected: full knowledge of Company B employment
}

// queryWithAsOfKnowledge(); // Uncomment to run query
```

## Step 4: Combining `asOf` and `asOfKnowledge` (Bi-Temporal Queries)

You can combine `asOf` and `asOfKnowledge` for powerful bi-temporal queries. This allows you to ask: "What did Anansi know *as of Knowledge-Time* about what *was true as of Valid-Time*?"

For example, what did Anansi know on `2023-02-01` about Alex's employment *as it was true on `2022-06-15`*? It should still only know about Company A, as that was true on `2022-06-15` and Anansi would have known about it by `2023-02-01`.

```typescript
async function queryWithBiTemporal() {
  console.log('\n--- Querying with Bi-Temporal ---');

  // What Anansi knew on 2023-02-01 about what was true on 2022-06-15
  const biTemporalContext = await memory.context({
    userId: userId,
    asOf: '2022-06-15',       // Valid-time
    asOfKnowledge: '2023-02-01', // Knowledge-time
  });
  console.log('\nContext bi-temporal (known 2023-02-01 about true 2022-06-15):');
  console.log(memory.formatForPrompt(biTemporalContext));
  // Expected: primarily Company A
}

// queryWithBiTemporal(); // Uncomment to run query
```

## Next Steps

Bi-temporal queries, especially when combined with the entity graph (accessible via `listEntities` with `asOf` and `asOfKnowledge`), provide unparalleled precision in managing and retrieving historical context.

*   Experiment with different dates for `asOf` and `asOfKnowledge` to fully grasp their impact.
*   Explore `listEntities` with these parameters to see how the entity graph evolves over time.
*   Consider how bi-temporal queries can be used for auditing, compliance, or advanced RAG (Retrieval Augmented Generation) scenarios where historical accuracy is paramount.

Happy temporal querying!