import { db } from "./index.js";
import { sql } from "drizzle-orm";

// Raw SQL applied after Drizzle migrations — drizzle-kit doesn't generate HNSW indexes or RLS natively.
//
// Split into two parts by transaction requirement:
//  - POST_MIGRATION_SQL is transaction-safe and runs as one batch (the DO $$..$$
//    block contains semicolons, so it must NOT be naively split on ';').
//  - POST_MIGRATION_CONCURRENT_SQL uses CREATE INDEX CONCURRENTLY, which cannot run
//    inside a transaction block and so must be sent as its own standalone query.
export const POST_MIGRATION_SQL = `
-- HNSW index for fast cosine similarity search (O(log n) instead of O(n))
CREATE INDEX IF NOT EXISTS memory_chunks_embedding_hnsw_idx
  ON memory_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- RLS NULL guard — NOT tenant isolation.
-- This policy only prevents rows without a workspace_id from being returned.
-- Real workspace isolation is enforced at the application layer via explicit
-- WHERE workspace_id = $1 on every query. True DB-level isolation would require
-- SET LOCAL app.current_workspace_id and a policy using current_setting(...).
-- The app DB user must NOT be a superuser (superusers bypass RLS entirely).
-- In local dev (docker-compose), POSTGRES_USER is a superuser, so this is bypassed locally.
ALTER TABLE memory_chunks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY workspace_isolation ON memory_chunks
    USING (workspace_id IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
`.trim();

// GIN index for BM25 full-text search (migration 0009 adds the content_tsv column).
// CONCURRENTLY cannot share a transaction with any other statement — runs alone.
export const POST_MIGRATION_CONCURRENT_SQL = `
CREATE INDEX CONCURRENTLY IF NOT EXISTS memory_chunks_tsv_idx
  ON memory_chunks USING gin(content_tsv);
`.trim();

export async function runPostMigration(): Promise<void> {
  // Transactional batch first, then the CONCURRENTLY index as its own statement.
  // Each is idempotent (IF NOT EXISTS / duplicate_object guard); "already exists"
  // is swallowed so reruns are safe.
  for (const statement of [POST_MIGRATION_SQL, POST_MIGRATION_CONCURRENT_SQL]) {
    try {
      await db.execute(sql.raw(statement));
    } catch (err) {
      const msg = (err as Error).message ?? "";
      if (!msg.includes("already exists") && !msg.includes("duplicate")) {
        console.warn("[post-migration] Statement failed (non-fatal):", msg.slice(0, 120));
      }
    }
  }
  console.log("[db] Post-migration SQL applied");
}
