/*
 * Engine-tenant provisioning. The engine (memory/search/entities, API keys) is
 * keyed by workspace + developer_account. Backfilled orgs already have one (migration
 * 0021); console-created orgs get one lazily on first engine use. The
 * developer_account email is a synthetic per-org identifier — NOT a login email — so
 * it satisfies the unique constraint without colliding with `users`.
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { developerAccounts, workspaces } from "../db/schema.js";

export interface EngineTenant {
  workspaceId: string;
  developerId: string;
}

export async function getOrProvisionEngineTenant(org: {
  id: string;
  name: string;
  slug: string;
}): Promise<EngineTenant> {
  let ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.organizationId, org.id),
  });
  if (!ws) {
    const [created] = await db
      .insert(workspaces)
      .values({ organizationId: org.id, slackTeamName: org.name })
      .returning();
    ws = created;
  }

  let dev = await db.query.developerAccounts.findFirst({
    where: eq(developerAccounts.workspaceId, ws.id),
  });
  if (!dev) {
    const [created] = await db
      .insert(developerAccounts)
      .values({
        email: `org+${org.slug}@tenant.anansi.local`,
        name: org.name,
        workspaceId: ws.id,
      })
      .returning();
    dev = created;
  }

  return { workspaceId: ws.id, developerId: dev.id };
}
