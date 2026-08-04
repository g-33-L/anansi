/*
 * Invitation repo — pending email invites with a hashed, single-use token. The
 * partial unique index (org, lower(email)) WHERE accepted_at IS NULL is the DB
 * backstop against duplicate pending invites; findPendingInvitation() is the UX pre-check.
 */
import crypto from "crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { invitations, type Invitation } from "../db/schema.js";
import type { Role } from "./roles.js";

const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function findPendingInvitation(
  organizationId: string,
  email: string
): Promise<Invitation | undefined> {
  return db.query.invitations.findFirst({
    where: and(
      eq(invitations.organizationId, organizationId),
      sql`lower(${invitations.email}) = ${email.toLowerCase().trim()}`,
      isNull(invitations.acceptedAt)
    ),
  });
}

export async function createInvitation(input: {
  organizationId: string;
  email: string;
  role: Role;
  invitedBy: string;
}): Promise<{ invitation: Invitation; token: string }> {
  const raw = crypto.randomBytes(32).toString("hex");
  const [invitation] = await db
    .insert(invitations)
    .values({
      organizationId: input.organizationId,
      email: input.email.toLowerCase().trim(),
      role: input.role,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      invitedBy: input.invitedBy,
    })
    .returning();
  return { invitation, token: raw };
}

export async function listPendingInvitations(organizationId: string): Promise<Invitation[]> {
  return db
    .select()
    .from(invitations)
    .where(and(eq(invitations.organizationId, organizationId), isNull(invitations.acceptedAt)))
    .orderBy(desc(invitations.createdAt));
}

export interface AcceptedInvitation {
  organizationId: string;
  email: string;
  role: Role;
}

/** Atomically consumes a valid, unexpired, unaccepted invite (single-use). */
export async function consumeInvitation(rawToken: string): Promise<AcceptedInvitation | null> {
  const [row] = await db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(
      and(
        eq(invitations.tokenHash, hashToken(rawToken)),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date())
      )
    )
    .returning({
      organizationId: invitations.organizationId,
      email: invitations.email,
      role: invitations.role,
    });
  if (!row) return null;
  return { organizationId: row.organizationId, email: row.email, role: row.role as Role };
}

export async function revokeInvitation(id: string, organizationId: string): Promise<boolean> {
  const rows = await db
    .delete(invitations)
    .where(and(eq(invitations.id, id), eq(invitations.organizationId, organizationId)))
    .returning({ id: invitations.id });
  return rows.length > 0;
}
