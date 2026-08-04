/*
 * /console profile routes — the current principal (GET /me refreshes the CSRF
 * cookie for the SPA) and profile updates.
 */
import { Hono } from "hono";
import { issueCsrfToken, type ConsoleEnv } from "../../lib/auth/console-middleware.js";
import { updateProfile } from "../../lib/identity/users.js";
import { listOrganizationsForUser } from "../../lib/identity/organizations.js";

export const profileRoutes = new Hono<ConsoleEnv>();

profileRoutes.get("/me", async (c) => {
  const { user, organization, role } = c.get("session");
  issueCsrfToken(c);
  const orgs = await listOrganizationsForUser(user.id);
  return c.json({
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    activeOrganization: organization
      ? { id: organization.id, name: organization.name, slug: organization.slug, role }
      : null,
    organizations: orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
  });
});

profileRoutes.patch("/me", async (c) => {
  const { user } = c.get("session");
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; avatarUrl?: unknown };
  const patch: { name?: string; avatarUrl?: string } = {};
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 200);
  if (typeof body.avatarUrl === "string") patch.avatarUrl = body.avatarUrl.trim().slice(0, 2000);
  const updated = await updateProfile(user.id, patch);
  const u = updated ?? user;
  return c.json({ user: { id: u.id, email: u.email, name: u.name, avatarUrl: u.avatarUrl } });
});
