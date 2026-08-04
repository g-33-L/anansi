-- Entity graph + temporal memory.
-- entity_nodes/entity_edges are populated by the synthesis worker; edges carry
-- bi-temporal validity (valid_until null = currently active). static_documents
-- gains temporal_facts for time-bounded profile facts.

CREATE TABLE IF NOT EXISTS "entity_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "developer_id" uuid NOT NULL REFERENCES "developer_accounts"("id") ON DELETE CASCADE,
  "memory_user_id" uuid REFERENCES "memory_users"("id") ON DELETE CASCADE,
  "entity_type" text NOT NULL,
  "name" text NOT NULL,
  "canonical_name" text,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "first_seen_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "entity_nodes_developer_user_type_name_unique" UNIQUE ("developer_id", "memory_user_id", "entity_type", "name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "entity_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "from_entity_id" uuid NOT NULL REFERENCES "entity_nodes"("id") ON DELETE CASCADE,
  "to_entity_id" uuid NOT NULL REFERENCES "entity_nodes"("id") ON DELETE CASCADE,
  "relationship" text NOT NULL,
  "valid_from" timestamp NOT NULL DEFAULT now(),
  "valid_until" timestamp,
  "source_chunk_id" uuid REFERENCES "memory_chunks"("id") ON DELETE SET NULL,
  "confidence" double precision NOT NULL DEFAULT 1.0,
  "metadata" jsonb NOT NULL DEFAULT '{}'
);
--> statement-breakpoint
ALTER TABLE "static_documents"
  ADD COLUMN IF NOT EXISTS "temporal_facts" jsonb NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_nodes_developer_user_idx" ON "entity_nodes" ("developer_id", "memory_user_id");
--> statement-breakpoint
-- The unique constraint on (developer_id, memory_user_id, entity_type, name) only
-- enforces uniqueness when memory_user_id IS NOT NULL (NULLs are never equal in
-- PostgreSQL unique constraints). This partial index covers the workspace-level case.
CREATE UNIQUE INDEX IF NOT EXISTS "entity_nodes_developer_null_user_type_name_unique"
  ON "entity_nodes" ("developer_id", "entity_type", "name")
  WHERE "memory_user_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_edges_from_idx" ON "entity_edges" ("from_entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entity_edges_to_idx" ON "entity_edges" ("to_entity_id");
