/*
 * Explicit, single-run, observable migration job (Phase 10.2 / ADR-0010).
 *
 * In managed production this runs as a discrete deploy step BEFORE new app/worker
 * code rolls out (expand → deploy → backfill → contract). To honor the hard
 * constraint "never run multiple migration actors concurrently", it takes a
 * Postgres SESSION-level advisory lock: a second runner (or a booting app that
 * still auto-migrates) blocks until the first finishes, instead of racing drizzle's
 * migration table. Locally / self-host, `pnpm db:migrate` is the same job.
 */
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { POST_MIGRATION_SQL, POST_MIGRATION_CONCURRENT_SQL } from "./post-migration.js";

// Stable 64-bit key for the migration advisory lock. Any actor running migrations
// (this job or a booting server) must use this same key to serialize.
export const MIGRATION_ADVISORY_LOCK_KEY = "4711000023";

/**
 * Run migrations under an advisory lock. Exported so the server startup path can
 * reuse the exact same serialized routine instead of calling drizzle directly.
 */
export async function runMigrationsLocked(connectionString: string): Promise<void> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const startedAt = Date.now();
  try {
    const db = drizzle(pool);

    console.log(JSON.stringify({ event: "migrate.lock.acquire", key: MIGRATION_ADVISORY_LOCK_KEY }));
    // Session-scoped lock — held for the lifetime of this pooled connection. Blocks
    // (does not error) if another actor holds it, then proceeds once released.
    await pool.query("SELECT pg_advisory_lock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);

    try {
      console.log(JSON.stringify({ event: "migrate.start" }));
      await migrate(db, { migrationsFolder: "./src/lib/db/migrations" });

      console.log(JSON.stringify({ event: "migrate.post.start", detail: "HNSW + RLS + GIN" }));
      // Transactional batch, then the CONCURRENTLY index alone (it can't run inside a
      // transaction block, which a multi-statement query implicitly opens).
      await pool.query(POST_MIGRATION_SQL);
      await pool.query(POST_MIGRATION_CONCURRENT_SQL);
    } finally {
      await pool.query("SELECT pg_advisory_unlock($1)", [MIGRATION_ADVISORY_LOCK_KEY]);
      console.log(JSON.stringify({ event: "migrate.lock.release" }));
    }

    console.log(JSON.stringify({ event: "migrate.complete", durationMs: Date.now() - startedAt }));
  } finally {
    await pool.end();
  }
}

// CLI entrypoint (`pnpm db:migrate` / the managed migration deploy step).
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }
  runMigrationsLocked(process.env.DATABASE_URL).catch((err) => {
    console.error(JSON.stringify({ event: "migrate.failed", error: (err as Error).message }));
    process.exit(1);
  });
}
