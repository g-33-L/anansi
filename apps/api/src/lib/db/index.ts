import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => {
  console.error("Unexpected pg pool error", err);
});

export const db = drizzle(pool, { schema });
export type Db = typeof db;

// Exported for use cases that require a dedicated connection (e.g. advisory locks)
export { pool };

export async function closePool(): Promise<void> {
  await pool.end();
}
