// Fixed test-only keys — 32 bytes hex, not used for real data
process.env.ENCRYPTION_KEY = "0".repeat(64);
process.env.CSRF_SIGNING_KEY = "test-csrf-signing-key";
process.env.SLACK_SIGNING_SECRET = "test-slack-signing-secret";
process.env.QUERY_API_KEY = "test-query-api-key";

// The DB module (../lib/db/index.js) calls process.exit(1) at import time when
// DATABASE_URL is unset. Importing it here eagerly would force EVERY test file —
// including pure-logic suites (chunker, sanitize, mask) — to require a live
// Postgres. Import it lazily inside cleanDatabase() so only suites that actually
// touch the database pull it in.
export async function cleanDatabase(): Promise<void> {
  // Guard against accidental TRUNCATE on a non-local database.
  // cleanDatabase() wipes all workspace data — only safe against a local dev DB.
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes("localhost") && !dbUrl.includes("127.0.0.1") && !dbUrl.includes("::1")) {
    throw new Error(
      `[test] Refusing to run integration tests against non-local database ` +
        `"${dbUrl.replace(/:[^:@]*@/, ":***@")}" — tests do TRUNCATE workspaces CASCADE`
    );
  }
  const { sql } = await import("drizzle-orm");
  const { db } = await import("../lib/db/index.js");
  // CASCADE removes all dependent rows across channels, memory_chunks, etc.
  await db.execute(sql`TRUNCATE workspaces CASCADE`);
}
