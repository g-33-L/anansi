/*
 * /console/organizations — list/create orgs, read/update the active org, switch org.
 * Member-management routes live in ./members.ts (also under /organizations).
 */
import { Hono } from "hono";
import { requirePermission, type ConsoleEnv } from "../../lib/auth/console-middleware.js";
import {
  createOrganization,
  getOrganization,
  listOrganizationsForUser,
  updateOrganization,
} from "../../lib/identity/organizations.js";
import { getMembership } from "../../lib/identity/memberships.js";
import { setActiveOrganization } from "../../lib/identity/session.js";

export const organizationRoutes = new Hono<ConsoleEnv>();

organizationRoutes.get("/", async (c) => {
  const { user } = c.get("session");
  const orgs = await listOrganizationsForUser(user.id);
  return c.json({
    organizations: orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      edition: o.edition,
      role: o.role,
    })),
  });
});

organizationRoutes.post("/", async (c) => {
  const { user } = c.get("session");
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 200) return c.json({ error: "name is required (max 200 chars)" }, 400);
  const org = await createOrganization({ name, ownerUserId: user.id });
  return c.json(
    { organization: { id: org.id, name: org.name, slug: org.slug, edition: org.edition, role: "owner" } },
    201
  );
});

organizationRoutes.get("/current", async (c) => {
  const { organization, role } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  return c.json({
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      edition: organization.edition,
      role,
    },
  });
});

organizationRoutes.patch("/current", requirePermission("org:update"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  if (name !== undefined && (name.length === 0 || name.length > 200)) {
    return c.json({ error: "invalid name" }, 400);
  }
  const updated = await updateOrganization(organization.id, { name });
  const o = updated ?? organization;
  return c.json({ organization: { id: o.id, name: o.name, slug: o.slug, edition: o.edition } });
});

// Switch the active org for this session (must be an active member of the target).
organizationRoutes.post("/switch", async (c) => {
  const { user, session } = c.get("session");
  const body = (await c.req.json().catch(() => ({}))) as { organizationId?: unknown };
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  if (!organizationId) return c.json({ error: "organizationId is required" }, 400);
  const membership = await getMembership(user.id, organizationId);
  if (!membership || membership.status !== "active") {
    return c.json({ error: "not a member of that organization" }, 403);
  }
  await setActiveOrganization(session.id, organizationId);
  const org = await getOrganization(organizationId);
  return c.json({
    organization: org
      ? { id: org.id, name: org.name, slug: org.slug, edition: org.edition, role: membership.role }
      : null,
  });
});
