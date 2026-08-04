-- Bi-temporal entity edges: add the transaction-time (knowledge-time) axis so the
-- graph can answer "what did we KNOW as of date K", not just "what was TRUE at date
-- V". Edges are insert-once / close-once (the active-unique index keeps one open
-- edge; supersession sets valid_until exactly once), so two immutable stamps fully
-- capture transaction time:
--   recorded_at             — when the edge was first learned (immutable)
--   valid_until_recorded_at — when we learned the relationship had ended (set with
--                             valid_until; NULL while the edge is still believed open)

ALTER TABLE "entity_edges" ADD COLUMN IF NOT EXISTS "recorded_at" timestamp;
--> statement-breakpoint
ALTER TABLE "entity_edges" ADD COLUMN IF NOT EXISTS "valid_until_recorded_at" timestamp;
--> statement-breakpoint
-- Backfill existing rows: under the pre-bitemporal code an edge was recorded at its
-- valid_from, and a close was recorded at the moment valid_until was set.
UPDATE "entity_edges" SET "recorded_at" = "valid_from" WHERE "recorded_at" IS NULL;
--> statement-breakpoint
UPDATE "entity_edges"
  SET "valid_until_recorded_at" = "valid_until"
  WHERE "valid_until" IS NOT NULL AND "valid_until_recorded_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "entity_edges" ALTER COLUMN "recorded_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE "entity_edges" ALTER COLUMN "recorded_at" SET NOT NULL;
--> statement-breakpoint
-- Knowledge-time lookups filter on recorded_at.
CREATE INDEX IF NOT EXISTS "entity_edges_recorded_at_idx" ON "entity_edges" ("recorded_at");
