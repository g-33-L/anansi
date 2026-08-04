-- Memory expiry: optional TTL on ingested chunks.
-- expires_at is null for permanent memories; set from the `ttl` field (seconds)
-- on POST /v1/ingest. Expired chunks are filtered out of search and synthesis.

ALTER TABLE "memory_chunks"
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp;

-- Partial index: only chunks that can expire, so the common (null) case costs nothing.
CREATE INDEX IF NOT EXISTS "memory_chunks_expires_at_idx"
  ON "memory_chunks" ("expires_at")
  WHERE "expires_at" IS NOT NULL;
