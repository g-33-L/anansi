-- Guarantee at most one ACTIVE edge of a given (from_entity_id, to_entity_id,
-- relationship). Closed edges (valid_until set) are exempt so the bi-temporal
-- history is preserved; only the currently-active edge is unique. This lets the
-- synthesis worker insert edges with ON CONFLICT DO NOTHING and prevents the
-- duplicate active edges that concurrent synthesis passes could otherwise create.

-- Backfill: collapse any pre-existing duplicate active edges, keeping the oldest
-- (earliest valid_from, then lowest id) so the unique index can be created.
DELETE FROM "entity_edges" e
USING (
  SELECT id, row_number() OVER (
    PARTITION BY from_entity_id, to_entity_id, relationship
    ORDER BY valid_from ASC, id ASC
  ) AS rn
  FROM "entity_edges"
  WHERE valid_until IS NULL
) dup
WHERE e.id = dup.id AND dup.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "entity_edges_active_unique"
  ON "entity_edges" ("from_entity_id", "to_entity_id", "relationship")
  WHERE "valid_until" IS NULL;
