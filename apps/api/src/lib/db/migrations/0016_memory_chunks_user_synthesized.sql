-- Slack-native per-person memory: a Slack message should feed BOTH the team
-- profile and the author's personal profile. The two synthesis passes need
-- independent tracking, so add a separate per-user synthesis flag. (memory_chunks
-- already carries memory_user_id; previously only API-ingested chunks set it.)

ALTER TABLE "memory_chunks"
  ADD COLUMN IF NOT EXISTS "user_synthesized" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Backfill: existing API user-scoped chunks were tracked by `synthesized`, so carry
-- that state over to the new per-user flag to avoid re-synthesizing them.
UPDATE "memory_chunks"
  SET "user_synthesized" = "synthesized"
  WHERE "memory_user_id" IS NOT NULL;
--> statement-breakpoint
-- Per-user synthesis scan: oldest unsynthesized chunks for one memory user.
CREATE INDEX IF NOT EXISTS "memory_chunks_memory_user_synthesized_idx"
  ON "memory_chunks" ("memory_user_id", "user_synthesized");
