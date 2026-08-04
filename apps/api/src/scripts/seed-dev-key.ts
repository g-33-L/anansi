#!/usr/bin/env tsx
/**
 * Creates a local developer account + API key for testing.
 * In Docker:   docker compose exec api node dist/scripts/seed-dev-key.js <email>
 * From source: tsx --env-file=.env src/scripts/seed-dev-key.ts <email>
 *
 * Lives under src/ (not scripts/) so it is compiled into dist/ and therefore
 * exists inside the published image — the Docker quickstart depends on it, and
 * a key-minting step a container cannot run would force every self-hoster to
 * install the toolchain just to get started.
 * The account email comes from the argument or FOUNDER_EMAIL in .env.
 */
import { createHmac, randomBytes } from "crypto";
import { db } from "../lib/db/index.js";
import { developerAccounts, developerApiKeys, workspaces, subscriptions } from "../lib/db/schema.js";
import { eq } from "drizzle-orm";

const EMAIL = process.argv[2] ?? process.env.FOUNDER_EMAIL;
const HMAC_SECRET = process.env.API_KEY_HMAC_SECRET;

if (!EMAIL) {
  console.error("Usage: seed-dev-key <email>   (or set FOUNDER_EMAIL)");
  process.exit(1);
}
if (!HMAC_SECRET) {
  console.error("API_KEY_HMAC_SECRET not set in .env");
  process.exit(1);
}

function hashKey(raw: string): string {
  return createHmac("sha256", HMAC_SECRET!).update(raw).digest("hex");
}

async function main() {
  // 1. Find or create developer account
  let dev = await db.query.developerAccounts.findFirst({
    where: eq(developerAccounts.email, EMAIL),
  });

  if (!dev) {
    const [ws] = await db
      .insert(workspaces)
      .values({ slackTeamName: "Local Dev" })
      .returning({ id: workspaces.id });

    const [inserted] = await db
      .insert(developerAccounts)
      .values({ email: EMAIL, name: "Local Dev", workspaceId: ws.id })
      .returning();

    dev = inserted;
    console.log(`Created developer account for ${EMAIL}`);
  } else {
    console.log(`Found existing developer account for ${EMAIL}`);
  }

  // 2. Ensure enterprise subscription
  await db
    .insert(subscriptions)
    .values({ workspaceId: dev.workspaceId!, plan: "enterprise", status: "active" })
    .onConflictDoUpdate({
      target: subscriptions.workspaceId,
      set: { plan: "enterprise", status: "active" },
    });

  // 3. Generate and store API key
  const raw = "ans_" + randomBytes(32).toString("hex");
  const hash = hashKey(raw);

  await db.insert(developerApiKeys).values({
    developerId: dev.id,
    keyHash: hash,
    name: "Local Dev Key",
  });

  console.log("\n✓ API key created. Add this to your .env files:\n");
  console.log(`  ANANSI_API_KEY=${raw}\n`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
