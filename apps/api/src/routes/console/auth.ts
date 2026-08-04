/*
 * Public /console/auth routes — magic-link login (no session required).
 */
import { Hono } from "hono";
import { requestMagicLink, verifyMagicLink, sendAuthEmail } from "../../lib/auth/user-auth.js";
import {
  clearSessionCookie,
  getRawSessionToken,
  issueCsrfToken,
  setSessionCookie,
} from "../../lib/auth/console-middleware.js";
import { revokeSession } from "../../lib/identity/session.js";

export const authRoutes = new Hono();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Request a magic link. Always returns ok (never leaks whether the email exists);
// devUrl is included only when no mail transport is configured (self-host/dev).
authRoutes.post("/magic-link", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown };
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
    return c.json({ error: "a valid email is required" }, 400);
  }
  const link = await requestMagicLink(email);
  const sent = await sendAuthEmail(email, link.url);
  return c.json({ ok: true, ...(sent.devUrl ? { devUrl: sent.devUrl } : {}) });
});

// Consume a magic link (from the emailed URL) and establish a session, then
// redirect into the product app. `invite` optionally accepts a pending invite.
authRoutes.get("/verify", async (c) => {
  const token = c.req.query("token");
  const inviteToken = c.req.query("invite");
  if (!token) return c.json({ error: "token is required" }, 400);
  const result = await verifyMagicLink(token, inviteToken ? { inviteToken } : undefined);
  if (!result) return c.json({ error: "invalid or expired link" }, 401);
  setSessionCookie(c, result.rawSession);
  issueCsrfToken(c);
  const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
  return c.redirect(`${appUrl}/app`);
});

// Log out — revoke the session server-side and clear the cookie. Idempotent.
authRoutes.post("/logout", async (c) => {
  const raw = getRawSessionToken(c);
  if (raw) await revokeSession(raw);
  clearSessionCookie(c);
  return c.json({ ok: true });
});
