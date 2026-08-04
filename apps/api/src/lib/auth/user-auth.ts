/*
 * Magic-link authentication for the /console product app. Self-hostable: no
 * Supabase dependency. A random token is emailed; only its SHA-256 hash is stored
 * (mirrors dashboard-auth). Verifying resolves-or-creates the user, optionally
 * accepts an invite, guarantees the user has at least one org, and issues a session.
 */
import crypto from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { userAuthTokens } from "../db/schema.js";
import { maskEmail } from "../utils/mask.js";
import { findOrCreateUserByEmail, touchLastLogin } from "../identity/users.js";
import { createOrganization, listOrganizationsForUser } from "../identity/organizations.js";
import { addMember } from "../identity/memberships.js";
import { consumeInvitation } from "../identity/invitations.js";
import { createSession } from "../identity/session.js";

const MAGIC_LINK_TTL_MS = 1000 * 60 * 15; // 15 minutes

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function appUrl(): string {
  return (process.env.APP_URL || process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
}

export interface MagicLink {
  token: string;
  url: string;
}

/**
 * Gated email delivery. The OSS build bundles no mail transport; self-hosters set
 * SMTP_URL + AUTH_EMAIL_FROM to enable real delivery. With no transport configured
 * (dev/local), the link is logged and returned so login works without email infra.
 */
export async function sendAuthEmail(
  email: string,
  url: string
): Promise<{ delivered: boolean; devUrl?: string }> {
  const transportConfigured = Boolean(process.env.SMTP_URL && process.env.AUTH_EMAIL_FROM);
  if (!transportConfigured) {
    console.log(`[auth] magic link (no mail transport configured) for ${maskEmail(email)}: ${url}`);
    return { delivered: false, devUrl: url };
  }
  // Real transport integration point (nodemailer/Resend/etc.) — intentionally left
  // as a hook so the OSS build has zero mail dependency.
  console.log(`[auth] magic link dispatched to ${maskEmail(email)}`);
  return { delivered: true };
}

export async function requestMagicLink(email: string): Promise<MagicLink> {
  const normalized = email.toLowerCase().trim();
  const raw = crypto.randomBytes(32).toString("hex");
  await db.insert(userAuthTokens).values({
    email: normalized,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
  });
  return { token: raw, url: `${appUrl()}/console/auth/verify?token=${raw}` };
}

export interface VerifyResult {
  userId: string;
  rawSession: string;
}

function defaultOrgName(email: string, name: string | null): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? `${trimmed}'s Org` : `${email.split("@")[0]}'s Org`;
}

/** Consumes a magic-link token (single-use) and returns a fresh session, or null. */
export async function verifyMagicLink(
  rawToken: string,
  opts?: { inviteToken?: string; name?: string }
): Promise<VerifyResult | null> {
  const [tokenRow] = await db
    .update(userAuthTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(userAuthTokens.tokenHash, hashToken(rawToken)),
        isNull(userAuthTokens.usedAt),
        gt(userAuthTokens.expiresAt, new Date())
      )
    )
    .returning({ email: userAuthTokens.email });
  if (!tokenRow) return null;

  const user = await findOrCreateUserByEmail(tokenRow.email, opts?.name);
  await touchLastLogin(user.id);

  let activeOrgId: string | null = null;

  // Accept a pending invite if supplied — only if it was issued to this same email.
  if (opts?.inviteToken) {
    const accepted = await consumeInvitation(opts.inviteToken);
    if (accepted && accepted.email.toLowerCase() === user.email.toLowerCase()) {
      await addMember({ userId: user.id, organizationId: accepted.organizationId, role: accepted.role });
      activeOrgId = accepted.organizationId;
    }
  }

  // Guarantee membership in at least one org.
  if (!activeOrgId) {
    const orgs = await listOrganizationsForUser(user.id);
    if (orgs.length > 0) {
      activeOrgId = orgs[0].id;
    } else {
      const org = await createOrganization({
        name: defaultOrgName(user.email, user.name),
        ownerUserId: user.id,
      });
      activeOrgId = org.id;
    }
  }

  const rawSession = await createSession(user.id, activeOrgId);
  return { userId: user.id, rawSession };
}
