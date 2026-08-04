/*
 * Membership repo — user × org × role (the RBAC join). All lookups are org-scoped;
 * the last active owner is protected from removal/demotion by countActiveOwners().
 */
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { memberships, users, type Membership, type User } from "../db/schema.js";
import type { Role } from "./roles.js";

export async function getMembership(userId: string, organizationId: string): Promise<Membership | undefined> {
  return db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)),
  });
}

/** Fetch a membership by its id, scoped to an org (prevents cross-org IDOR). */
export async function getMembershipInOrg(
  membershipId: string,
  organizationId: string
): Promise<Membership | undefined> {
  return db.query.memberships.findFirst({
    where: and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)),
  });
}

export interface MemberRow {
  membership: Membership;
  user: Pick<User, "id" | "email" | "name" | "avatarUrl" | "status">;
}

export async function listMembers(organizationId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      membership: memberships,
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        status: users.status,
      },
    })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(asc(users.email));
  return rows;
}

export async function addMember(input: {
  userId: string;
  organizationId: string;
  role: Role;
  invitedBy?: string | null;
}): Promise<Membership> {
  const [row] = await db
    .insert(memberships)
    .values({
      userId: input.userId,
      organizationId: input.organizationId,
      role: input.role,
      invitedBy: input.invitedBy ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  // Already a member — return the existing row.
  const existing = await getMembership(input.userId, input.organizationId);
  if (!existing) throw new Error("addMember: membership missing after conflict");
  return existing;
}

export async function countActiveOwners(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active")
      )
    );
  return row?.n ?? 0;
}

/** Update a member's role, scoped by org for safety. Returns null if not found. */
export async function updateMemberRole(
  membershipId: string,
  organizationId: string,
  role: Role
): Promise<Membership | null> {
  const [row] = await db
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
    .returning();
  return row ?? null;
}

export async function removeMember(membershipId: string, organizationId: string): Promise<boolean> {
  const rows = await db
    .delete(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, organizationId)))
    .returning({ id: memberships.id });
  return rows.length > 0;
}
