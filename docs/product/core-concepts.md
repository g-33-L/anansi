# Core Concepts

Anansi is built around a few foundational ideas. This page explains each one.

## Bi-temporal memory

Most memory stores track one time axis: when a fact is true. Anansi tracks two:

| Axis | Columns | Question it answers |
|---|---|---|
| **Valid-time** | `valid_from` / `valid_until` | When was this true in the real world? |
| **Knowledge-time** | `recorded_at` / `valid_until_recorded_at` | When did the system learn it? |

### Why two axes matter

Say your graph holds "Alex works at Acme," learned in January. In June you learn Alex actually left back in April.

A single-axis store overwrites — and silently rewrites history. You lose the fact that you *believed* Alex worked at Acme on May 1, because the April departure (learned in June) is retroactively applied.

Anansi records both axes, so you can replay the past without today's hindsight:

```typescript
// What was true on May 1 — as we KNEW it on May 1?
await memory.listEntities({
  userId: "user_123",
  asOf: "2026-05-01",          // valid-time instant
  asOfKnowledge: "2026-05-01", // knowledge-time instant
});
// → Alex —works_at→ Acme (current: true)

// What was true on May 1 — as we know it TODAY?
await memory.listEntities({ userId: "user_123", asOf: "2026-05-01" });
// → no works_at edge: the April end date, recorded in June, now applies
```

### How it works in the entity graph

Every entity edge (relationship) in the knowledge graph carries four timestamps:

- `valid_from` — when the relationship started in the real world
- `valid_until` — when it ended (null = currently active)
- `recorded_at` — when the system first learned of it (immutable)
- `valid_until_recorded_at` — when the system learned it had ended

The query engine applies knowledge-time first, then valid-time, reconstructing the graph at any bi-temporal point.

## Attestations

Attestations are evidence-backed claims about how an organization operates. Unlike entity edges (which describe relationships between entities), attestations carry propositional, role, or policy claims:

- "The deployment process requires two approvals" (policy)
- "Sarah is the on-call engineer this week" (role)
- "The API rate limit is 100 requests per minute" (propositional)

### Key properties

- **Append-only**: claims are closed (by setting `validUntil`), never deleted
- **Evidence-backed**: each attestation links to verbatim quotes from source chunks
- **Confidence-scored**: confidence defaults to 0 (not 1.0), status defaults to "candidate"
- **Bi-temporal**: same valid-time + knowledge-time model as entity edges
- **Self-correcting**: new claims can supersede old ones via the `supersedes` field

### Trust defaults

The ledger is deliberately conservative:

| Field | Default | Why |
|---|---|---|
| `confidence` | 0 | Never invent certainty |
| `status` | "candidate" | Never auto-publish |
| `inferenceStatus` | "inferred" | Least trusted classification |
| `validFrom` | null (floored to `recordedAt` on read) | Never imply a truth predated its evidence |

## Evidence-backed claims

Every attestation carries an `evidence` array — a list of verbatim quotes from specific memory chunks:

```json
{
  "evidence": [
    {
      "chunkId": "abc-123",
      "quote": "We require two approvals for any production deploy",
      "source": "engineering-standards.md",
      "author": "Sarah Chen",
      "eventTime": "2026-03-15"
    }
  ]
}
```

The chunk ID links back to the exact piece of ingested content that supports the claim. This creates an audit trail: you can trace any assertion in the knowledge graph back to its source material.

## Knowledge reconstruction

Knowledge reconstruction is the ability to rebuild the state of what the system knew at any past instant. It combines both time axes:

1. **Filter by knowledge-time**: exclude edges/attestations recorded after the query instant
2. **Apply valid-time**: keep only edges/attestations that were active at the query instant
3. **Compute "current"**: relative to the query instant, not the present moment

This is different from "time travel" or "snapshot" features in other systems, which typically only offer valid-time reconstruction. Anansi's knowledge-time axis answers the harder question: "What did we *believe* then?"

## Synthesized profiles

Raw retrieval (chunks, embeddings) is available, but Anansi's primary output is a synthesized profile that drops directly into a system prompt:

- **Static facts** (max 30): curated, deduplicated, stable truths
- **Dynamic context** (max 15): current state and recent activity
- **Temporal facts**: time-bounded facts with validity windows
- **Entity summaries**: extracted people, tools, projects, and their relationships

The synthesis worker (an LLM-powered background job) maintains these profiles as new content is ingested. Profiles are re-synthesized when evidence changes the picture, not on every request.

## Hybrid search

Retrieval combines two search methods:

- **Semantic search** (pgvector cosine similarity): finds conceptually related content, even when the wording differs
- **Keyword search** (Postgres BM25 via `ts_rank`): finds exact term matches, critical for lookups like "who owns LIN-247"

Results are merged using Reciprocal Rank Fusion (RRF) by default, or can be tuned with an `alpha` parameter (0.0 = pure keyword, 1.0 = pure vector).

## Two-layer memory

Anansi maintains two independent synthesis tracks:

1. **Workspace-level** (team profile): synthesized from all messages across all users in a workspace. Captures shared patterns, common preferences, and team-wide context.
2. **User-level** (personal profile): synthesized from one user's messages. Captures individual preferences, role, and current state.

Both layers are served together in the `context()` response. The workspace profile can also be queried independently with `scope=workspace`.
