/*
 * /console member + invitation management (mounted under /organizations). Operates
 * on the session's ACTIVE org. Guards: only owners may grant/revoke the owner role,
 * and the last active owner can never be demoted or removed.
 */
import { Hono } from "hono";
import { requirePermission, type ConsoleEnv } from "../../lib/auth/console-middleware.js";
import {
  countActiveOwners,
  getMembershipInOrg,
  listMembers,
  removeMember,
  updateMemberRole,
  addMember,
} from "../../lib/identity/memberships.js";
import {
  consumeInvitation,
  createInvitation,
  findPendingInvitation,
  listPendingInvitations,
  revokeInvitation,
} from "../../lib/identity/invitations.js";
import { isRole } from "../../lib/identity/roles.js";
import { recordAuditEvent } from "../../lib/enterprise/audit.js";

export const memberRoutes = new Hono<ConsoleEnv>();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function acceptInviteUrl(token: string): string {
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  return `${base}/accept-invite?token=${token}`;
}

// ── Members ──────────────────────────────────────────────────────────────────

memberRoutes.get("/members", requirePermission("member:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const members = await listMembers(organization.id);
  return c.json({
    members: members.map((m) => ({
      membershipId: m.membership.id,
      role: m.membership.role,
      status: m.membership.status,
      user: m.user,
    })),
  });
});

memberRoutes.patch("/members/:membershipId", requirePermission("member:update"), async (c) => {
  const { organization, role: actorRole } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const membershipId = c.req.param("membershipId")!;
  const body = (await c.req.json().catch(() => ({}))) as { role?: unknown };
  const nextRole = typeof body.role === "string" ? body.role : "";
  if (!isRole(nextRole)) return c.json({ error: "invalid role" }, 400);

  const target = await getMembershipInOrg(membershipId, organization.id);
  if (!target) return c.json({ error: "member not found" }, 404);

  // Only owners may grant or remove the owner role.
  if ((nextRole === "owner" || target.role === "owner") && actorRole !== "owner") {
    return c.json({ error: "only an owner can change owner assignments" }, 403);
  }
  // Never demote the last active owner.
  if (target.role === "owner" && nextRole !== "owner" && (await countActiveOwners(organization.id)) <= 1) {
    return c.json({ error: "cannot demote the last owner" }, 409);
  }

  const updated = await updateMemberRole(membershipId, organization.id, nextRole);
  if (!updated) return c.json({ error: "member not found" }, 404);
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: c.get("session").user.id,
    action: "member.role_change",
    targetType: "membership",
    targetId: membershipId,
    metadata: { from: target.role, to: nextRole },
  });
  return c.json({ member: { membershipId: updated.id, role: updated.role, status: updated.status } });
});

memberRoutes.delete("/members/:membershipId", requirePermission("member:remove"), async (c) => {
  const { organization, role: actorRole } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const membershipId = c.req.param("membershipId")!;

  const target = await getMembershipInOrg(membershipId, organization.id);
  if (!target) return c.json({ error: "member not found" }, 404);
  if (target.role === "owner" && actorRole !== "owner") {
    return c.json({ error: "only an owner can remove an owner" }, 403);
  }
  if (target.role === "owner" && (await countActiveOwners(organization.id)) <= 1) {
    return c.json({ error: "cannot remove the last owner" }, 409);
  }
  await removeMember(membershipId, organization.id);
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: c.get("session").user.id,
    action: "member.remove",
    targetType: "membership",
    targetId: membershipId,
    metadata: { role: target.role },
  });
  return c.json({ ok: true });
});

// ── Invitations ──────────────────────────────────────────────────────────────

memberRoutes.get("/invitations", requirePermission("member:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const invites = await listPendingInvitations(organization.id);
  return c.json({
    invitations: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt })),
  });
});

memberRoutes.post("/invitations", requirePermission("member:invite"), async (c) => {
  const { organization, user, role: actorRole } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; role?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body.role === "string" ? body.role : "member";
  if (!EMAIL_RE.test(email)) return c.json({ error: "a valid email is required" }, 400);
  if (!isRole(role)) return c.json({ error: "invalid role" }, 400);
  if (role === "owner" && actorRole !== "owner") {
    return c.json({ error: "only an owner can invite an owner" }, 403);
  }
  if (await findPendingInvitation(organization.id, email)) {
    return c.json({ error: "a pending invitation for that email already exists" }, 409);
  }

  const { invitation, token } = await createInvitation({
    organizationId: organization.id,
    email,
    role,
    invitedBy: user.id,
  });
  const url = acceptInviteUrl(token);
  const delivered = Boolean(process.env.SMTP_URL && process.env.AUTH_EMAIL_FROM);
  if (!delivered) console.log(`[invite] ${organization.slug} invited ${email} (${role}): ${url}`);
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: user.id,
    action: "member.invite",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { email, role },
  });

  return c.json(
    {
      invitation: { id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt },
      ...(delivered ? {} : { acceptUrl: url }),
    },
    201
  );
});

// Accept an invite as the currently-authenticated user (email must match).
memberRoutes.post("/invitations/accept", async (c) => {
  const { user, session } = c.get("session");
  const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return c.json({ error: "token is required" }, 400);

  const accepted = await consumeInvitation(token);
  if (!accepted) return c.json({ error: "invalid or expired invitation" }, 401);
  if (accepted.email.toLowerCase() !== user.email.toLowerCase()) {
    return c.json({ error: "this invitation was issued to a different email" }, 403);
  }
  await addMember({ userId: user.id, organizationId: accepted.organizationId, role: accepted.role });
  return c.json({ ok: true, organizationId: accepted.organizationId, sessionId: session.id });
});

memberRoutes.delete("/invitations/:id", requirePermission("member:invite"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const ok = await revokeInvitation(c.req.param("id")!, organization.id);
  return ok ? c.json({ ok: true }) : c.json({ error: "invitation not found" }, 404);
});
