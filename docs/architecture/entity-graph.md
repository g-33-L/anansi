# Entity Graph

The bi-temporal entity graph is Anansi's core differentiating data structure. It extracts and tracks relationships between people, organizations, tools, and projects, with two independent time axes.

## Structure

### Nodes (`entity_nodes`)

Extracted entities: people, organizations, tools, projects, locations.

| Property | Description |
|---|---|
| `entity_type` | `person`, `org`, `tech`, `project`, `location` |
| `name` | Display name |
| `canonical_name` | Normalized (lowercase) for matching |
| `first_seen_at` / `last_seen_at` | Temporal bounds of observation |

Nodes are scoped to a `(developer_id, memory_user_id)` pair. Shared nodes (orgs, tools) may have `memory_user_id = null`.

### Edges (`entity_edges`)

Bi-temporal relationships between entities:

| Column | Axis | Description |
|---|---|---|
| `valid_from` | Valid-time | When the relationship started in the real world |
| `valid_until` | Valid-time | When it ended (null = currently active) |
| `recorded_at` | Knowledge-time | When the system first learned this (immutable) |
| `valid_until_recorded_at` | Knowledge-time | When the system learned it had ended |

### Partial unique index

At most one **active** edge per `(from, to, relationship)` where `valid_until IS NULL`. Closed edges (with `valid_until` set) are exempt, preserving history. This makes edge inserts race-safe via `ON CONFLICT DO NOTHING`.

## How entities are extracted

The synthesis worker calls the LLM with a prompt that asks for entity extraction alongside profile generation. The LLM returns structured JSON with entities and their relationships.

The `persistEntityGraph()` function then:

1. **Upserts all nodes** in a single batch insert with `ON CONFLICT DO UPDATE` (updates `last_seen_at`)
2. **Processes explicit ends**: closes active edges where `current: false`
3. **Supersedes single-valued relationships**: for types like `works_at`, `reports_to`, `located_in`, a new current edge closes other active edges of the same type to different targets
4. **Inserts active edges**: uses the partial unique index for race-safe inserts

Source: `apps/api/src/lib/ai/entity-graph.ts`

## Single-valued vs multi-valued relationships

Not all relationships are functional. The system distinguishes:

**Single-valued** (superseding): `works_at`, `reports_to`, `located_in`, `lives_in`, `based_in`, `headquartered_in`

These are "one at a time" — changing jobs closes the old `works_at` edge.

**Multi-valued** (accumulating): `uses`, `knows`, `member_of`, and everything else

These accumulate — a person can use React and Postgres simultaneously without either closing the other.

Source: `apps/api/src/lib/ai/entity-graph.ts` (`SINGLE_VALUED_RELATIONSHIPS`)

## Bi-temporal query projection

The query engine projects edges through both time axes:

### Without parameters: full history

Returns all edges (active + closed), with `current` computed relative to now.

### With `asOf` (valid-time snapshot)

Only edges active at the given instant are returned. Each kept edge has `current = true` (it was active then).

### With `asOfKnowledge` (knowledge-time snapshot)

1. Skip edges recorded after the query instant
2. An edge's `valid_until` is only applied if `valid_until_recorded_at` is also before the query instant — otherwise the end is unknown
3. Remaining edges are filtered by valid-time if `asOf` is also provided

### Combined bi-temporal query

Apply knowledge-time first, then valid-time. This reconstructs the graph *as it was true and as it was believed* at any instant.

```typescript
// What did we believe about this user on May 1?
const entities = await memory.listEntities({
  userId: "user_123",
  asOf: "2026-05-01",
  asOfKnowledge: "2026-05-01",
});
```

## Safety bounds

Graph reads are bounded to prevent unbounded payloads:

- `MAX_ENTITY_NODES = 500` — most recently seen nodes
- `MAX_ENTITY_EDGES = 5000` — most recently recorded edges

History beyond these caps is omitted from a single read. The full history is preserved in the database.

## Integration with the profile

Entity summaries are embedded in the `GET /v1/context` response (Pro+ only). The synthesis prompt extracts entities alongside static facts and dynamic context, so the entity graph grows organically with every ingest cycle.

## Attestations

Attestations extend the entity graph with evidence-backed claims. They share the same bi-temporal model but carry propositional/role/policy claims rather than relational edges. See [Core Concepts](../product/core-concepts.md) for details.
