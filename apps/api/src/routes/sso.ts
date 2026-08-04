/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

/*
 * Public SSO endpoints (Phase 7) — NOT session-authed; they ESTABLISH a session.
 *   GET  /sso/:slug/login     → redirect the user to their org's IdP
 *   GET  /sso/:slug/callback  → OIDC code exchange → JIT provision → session
 *   POST /sso/:slug/acs       → signature-validated SAML assertion consumer
 *   GET  /sso/:slug/metadata  → SP metadata XML for SAML setup
 *
 * The redirect_uri is derived from the incoming request origin so it works behind
 * any proxy without extra config. On success we set the same signed session cookie
 * the magic-link flow uses, then bounce to APP_URL/app.
 */
import { Hono, type Context } from "hono";
import crypto from "crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import { organizations } from "../lib/db/schema.js";
import { setSessionCookie, issueCsrfToken } from "../lib/auth/console-middleware.js";
import { getConnectionByOrg } from "../lib/enterprise/sso/connections.js";
import { buildAuthorizeUrl, exchangeCodeForIdentity } from "../lib/enterprise/sso/oidc.js";
import { buildSpMetadata, buildSamlAuthorizeUrl, consumeSamlAssertion } from "../lib/enterprise/sso/saml.js";
import { provisionSsoLogin } from "../lib/enterprise/sso/provision.js";
import { recordAuditEvent } from "../lib/enterprise/audit.js";

export const ssoRoutes = new Hono();

const STATE_COOKIE = "anansi_sso_state";

function appRedirect(): string {
  return (process.env.APP_URL || "").replace(/\/$/, "") + "/app";
}
function callbackUri(reqUrl: string, slug: string): string {
  return `${new URL(reqUrl).origin}/sso/${slug}/callback`;
}
function clientIp(c: Context): string | null {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

async function orgBySlug(slug: string) {
  return db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
}

ssoRoutes.get("/:slug/login", async (c) => {
  const org = await orgBySlug(c.req.param("slug"));
  if (!org) return c.json({ error: "unknown organization" }, 404);
  const conn = await getConnectionByOrg(org.id);
  if (!conn || !conn.enabled) return c.json({ error: "SSO is not enabled for this organization" }, 404);

  if (conn.protocol === "oidc") {
    const state = crypto.randomBytes(24).toString("hex");
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: `/sso/${org.slug}`,
      maxAge: 600,
    });
    return c.redirect(buildAuthorizeUrl(conn, state, callbackUri(c.req.url, org.slug)));
  }
  try {
    const url = await buildSamlAuthorizeUrl(
      conn,
      `${new URL(c.req.url).origin}/sso/${org.slug}/acs`,
      new URL(c.req.url).host
    );
    return c.redirect(url);
  } catch (err) {
    console.error(`[sso] SAML login setup failed for ${org.slug}:`, (err as Error).message);
    return c.json({ error: "SAML connection is invalid" }, 400);
  }
});

ssoRoutes.get("/:slug/callback", async (c) => {
  const org = await orgBySlug(c.req.param("slug"));
  if (!org) return c.json({ error: "unknown organization" }, 404);
  const conn = await getConnectionByOrg(org.id);
  if (!conn || !conn.enabled || conn.protocol !== "oidc") {
    return c.json({ error: "OIDC is not enabled for this organization" }, 404);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: `/sso/${org.slug}` });
  if (!code || !state || !expected || state !== expected) {
    return c.json({ error: "invalid SSO state" }, 400);
  }

  try {
    const identity = await exchangeCodeForIdentity(conn, code, callbackUri(c.req.url, org.slug));
    const { userId, rawSession } = await provisionSsoLogin({
      organizationId: org.id,
      identity,
      groupRoleMap: conn.groupRoleMap,
    });
    setSessionCookie(c, rawSession);
    issueCsrfToken(c);
    await recordAuditEvent({
      organizationId: org.id,
      actorUserId: userId,
      action: "sso.login",
      targetType: "user",
      targetId: userId,
      metadata: { protocol: "oidc", email: identity.email },
      ip: clientIp(c),
    });
    return c.redirect(appRedirect());
  } catch (err) {
    console.error(`[sso] callback failed for ${org.slug}:`, (err as Error).message);
    return c.json({ error: "SSO login failed" }, 502);
  }
});

ssoRoutes.get("/:slug/metadata", async (c) => {
  const org = await orgBySlug(c.req.param("slug"));
  if (!org) return c.json({ error: "unknown organization" }, 404);
  const conn = await getConnectionByOrg(org.id);
  if (!conn || conn.protocol !== "saml") return c.json({ error: "no SAML connection" }, 404);
  const xml = buildSpMetadata(conn, `${new URL(c.req.url).origin}/sso/${org.slug}/acs`);
  return c.body(xml, 200, { "Content-Type": "application/xml" });
});

ssoRoutes.post("/:slug/acs", async (c) => {
  const org = await orgBySlug(c.req.param("slug"));
  if (!org) return c.json({ error: "unknown organization" }, 404);
  const conn = await getConnectionByOrg(org.id);
  if (!conn || !conn.enabled || conn.protocol !== "saml") {
    return c.json({ error: "SAML is not enabled for this organization" }, 404);
  }
  const form = await c.req.parseBody();
  const samlResponse = typeof form.SAMLResponse === "string" ? form.SAMLResponse : "";
  try {
    const identity = await consumeSamlAssertion(conn, samlResponse, `${new URL(c.req.url).origin}/sso/${org.slug}/acs`);
    const { userId, rawSession } = await provisionSsoLogin({
      organizationId: org.id,
      identity,
      groupRoleMap: conn.groupRoleMap,
    });
    setSessionCookie(c, rawSession);
    issueCsrfToken(c);
    await recordAuditEvent({
      organizationId: org.id,
      actorUserId: userId,
      action: "sso.login",
      targetType: "user",
      targetId: userId,
      metadata: { protocol: "saml", email: identity.email },
      ip: clientIp(c),
    });
    return c.redirect(appRedirect());
  } catch (err) {
    console.error(`[sso] ACS failed for ${org.slug}:`, (err as Error).message);
    return c.json({ error: "SAML login failed" }, 502);
  }
});
