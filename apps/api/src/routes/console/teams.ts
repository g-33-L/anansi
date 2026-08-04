/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

/*
 * /console/teams — sub-groups within the session's active org.
 */
import { Hono } from "hono";
import { requirePermission, type ConsoleEnv } from "../../lib/auth/console-middleware.js";
import {
  addTeamMember,
  createTeam,
  deleteTeam,
  listTeamMembers,
  listTeams,
  removeTeamMember,
} from "../../lib/identity/teams.js";

export const teamRoutes = new Hono<ConsoleEnv>();

async function teamInActiveOrg(organizationId: string, teamId: string): Promise<boolean> {
  const teams = await listTeams(organizationId);
  return teams.some((t) => t.id === teamId);
}

teamRoutes.get("/", requirePermission("team:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const teams = await listTeams(organization.id);
  return c.json({ teams: teams.map((t) => ({ id: t.id, name: t.name })) });
});

teamRoutes.post("/", requirePermission("team:write"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120) return c.json({ error: "name is required (max 120 chars)" }, 400);
  try {
    const team = await createTeam(organization.id, name);
    return c.json({ team: { id: team.id, name: team.name } }, 201);
  } catch {
    return c.json({ error: "a team with that name already exists" }, 409);
  }
});

teamRoutes.delete("/:id", requirePermission("team:write"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const ok = await deleteTeam(c.req.param("id")!, organization.id);
  return ok ? c.json({ ok: true }) : c.json({ error: "team not found" }, 404);
});

teamRoutes.get("/:id/members", requirePermission("team:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  if (!(await teamInActiveOrg(organization.id, c.req.param("id")!))) {
    return c.json({ error: "team not found" }, 404);
  }
  return c.json({ members: await listTeamMembers(c.req.param("id")!) });
});

teamRoutes.post("/:id/members", requirePermission("team:write"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { membershipId?: unknown };
  const membershipId = typeof body.membershipId === "string" ? body.membershipId : "";
  if (!membershipId) return c.json({ error: "membershipId is required" }, 400);
  const ok = await addTeamMember(c.req.param("id")!, membershipId, organization.id);
  return ok ? c.json({ ok: true }) : c.json({ error: "team or member not found in this organization" }, 404);
});

teamRoutes.delete("/:id/members/:membershipId", requirePermission("team:write"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  if (!(await teamInActiveOrg(organization.id, c.req.param("id")!))) {
    return c.json({ error: "team not found" }, 404);
  }
  const ok = await removeTeamMember(c.req.param("id")!, c.req.param("membershipId")!);
  return ok ? c.json({ ok: true }) : c.json({ error: "team member not found" }, 404);
});
