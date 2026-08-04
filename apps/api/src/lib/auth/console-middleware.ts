/*
 * /console auth middleware: session resolution, RBAC, CSRF.
 *
 * - Session: signed httpOnly cookie carries the raw session token (HMAC-signed via
 *   CSRF_SIGNING_KEY so it's tamper-evident); requireSession resolves it to a
 *   SessionContext (user + active org + membership + role).
 * - CSRF: stateless double-submit. A random token in a readable cookie must match
 *   the X-CSRF-Token header on any state-changing request.
 * - RBAC: requirePermission(perm) checks the active-org role via roles.ts.
 */
import crypto from "crypto";
import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import {
  readSignedCookieValue,
  signCookieValue,
  timingSafeEqual,
} from "../utils/crypto.js";
import { validateSession } from "../identity/session.js";
import { getOrganization } from "../identity/organizations.js";
import { getMembership } from "../identity/memberships.js";
import { isRole, roleHasPermission, type Permission, type Role } from "../identity/roles.js";
import type { SessionContext } from "../identity/context.js";

export const SESSION_COOKIE = "anansi_session";
export const CSRF_COOKIE = "anansi_csrf";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export type ConsoleEnv = { Variables: { session: SessionContext } };

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setSessionCookie(c: Context, rawToken: string): void {
  setCookie(c, SESSION_COOKIE, signCookieValue(rawToken), {
    httpOnly: true,
    secure: isProd(),
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export function getRawSessionToken(c: Context): string | null {
  return readSignedCookieValue(getCookie(c, SESSION_COOKIE));
}

/** Issues a CSRF token in a readable cookie (call after login and on GET /me). */
export function issueCsrfToken(c: Context): string {
  const token = crypto.randomBytes(24).toString("hex");
  setCookie(c, CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isProd(),
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return token;
}

/** Authenticates the request and attaches the resolved SessionContext. */
export async function requireSession(c: Context<ConsoleEnv>, next: Next): Promise<Response | void> {
  const validated = await validateSession(getRawSessionToken(c));
  if (!validated) return c.json({ error: "unauthorized" }, 401);

  const { user, session } = validated;
  let organization: SessionContext["organization"] = null;
  let membership: SessionContext["membership"] = null;
  let role: Role | null = null;

  if (session.activeOrganizationId) {
    const org = await getOrganization(session.activeOrganizationId);
    if (org) {
      const m = await getMembership(user.id, org.id);
      // Only expose the org if the user is still an active member of it.
      if (m && m.status === "active" && isRole(m.role)) {
        organization = org;
        membership = m;
        role = m.role;
      }
    }
  }

  c.set("session", { user, session, organization, membership, role });
  await next();
}

/** Rejects state-changing requests without a valid double-submit CSRF token. */
export async function requireCsrf(c: Context, next: Next): Promise<Response | void> {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    await next();
    return;
  }
  const cookie = getCookie(c, CSRF_COOKIE);
  const header = c.req.header("x-csrf-token");
  if (!cookie || !header || !timingSafeEqual(cookie, header)) {
    return c.json({ error: "invalid csrf token" }, 403);
  }
  await next();
}

/** Requires the active-org role to hold `permission` (else 403). */
export function requirePermission(permission: Permission) {
  return async (c: Context<ConsoleEnv>, next: Next): Promise<Response | void> => {
    const { role } = c.get("session");
    if (!role) return c.json({ error: "no active organization selected" }, 403);
    if (!roleHasPermission(role, permission)) {
      return c.json({ error: "forbidden", requiredPermission: permission }, 403);
    }
    await next();
  };
}
