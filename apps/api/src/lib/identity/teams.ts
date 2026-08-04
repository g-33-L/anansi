/*
 * Team repo — sub-groups within an org. Team members are memberships (so a user
 * must belong to the org before joining a team). All ops are org-scoped.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { teams, teamMemberships, memberships, users, type Team } from "../db/schema.js";

export async function listTeams(organizationId: string): Promise<Team[]> {
  return db
    .select()
    .from(teams)
    .where(eq(teams.organizationId, organizationId))
    .orderBy(asc(teams.name));
}

export async function createTeam(organizationId: string, name: string): Promise<Team> {
  const [row] = await db.insert(teams).values({ organizationId, name }).returning();
  return row;
}

export async function deleteTeam(id: string, organizationId: string): Promise<boolean> {
  const rows = await db
    .delete(teams)
    .where(and(eq(teams.id, id), eq(teams.organizationId, organizationId)))
    .returning({ id: teams.id });
  return rows.length > 0;
}

/** Adds an org membership to a team. Both must belong to `organizationId`. */
export async function addTeamMember(
  teamId: string,
  membershipId: string,
  organizationId: string
): Promise<boolean> {
  const team = await db.query.teams.findFirst({
    where: and(eq(teams.id, teamId), eq(teams.organizationId, organizationId)),
  });
  const membership = await db.query.memberships.findFirst({
    where: and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)),
  });
  if (!team || !membership) return false;
  await db.insert(teamMemberships).values({ teamId, membershipId }).onConflictDoNothing();
  return true;
}

export async function removeTeamMember(teamId: string, membershipId: string): Promise<boolean> {
  const rows = await db
    .delete(teamMemberships)
    .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.membershipId, membershipId)))
    .returning({ id: teamMemberships.id });
  return rows.length > 0;
}

export interface TeamMemberRow {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  role: string;
}

export async function listTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
  return db
    .select({
      membershipId: memberships.id,
      userId: users.id,
      email: users.email,
      name: users.name,
      role: memberships.role,
    })
    .from(teamMemberships)
    .innerJoin(memberships, eq(teamMemberships.membershipId, memberships.id))
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(teamMemberships.teamId, teamId))
    .orderBy(asc(users.email));
}
