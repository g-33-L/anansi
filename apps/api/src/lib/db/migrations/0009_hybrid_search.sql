-- Hybrid search: add tsvector generated column + GIN index for BM25 full-text search.
-- The generated column is maintained by Postgres automatically on insert/update.
-- The GIN index is created in post-migration.ts (CONCURRENTLY cannot run inside a transaction).

ALTER TABLE "memory_chunks"
  ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
    GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;
