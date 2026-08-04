/*
 * OIDC authorization-code flow (Phase 7), dependency-free (native fetch + crypto).
 *
 * Security model: the code→token exchange is a server-to-server call over TLS, so
 * the token response is trusted without locally verifying the id_token signature.
 * We then call the userinfo endpoint with the access token to read the verified
 * claims (email, name, groups). CSRF on the redirect is covered by a signed,
 * single-use `state` (see routes/sso.ts).
 */
import type { SsoConnection } from "../../db/schema.js";
import { type OidcConfig, connectionClientSecret } from "./connections.js";
import type { SsoIdentity } from "./provision.js";

const DEFAULT_SCOPES = "openid email profile";

export function buildAuthorizeUrl(conn: SsoConnection, state: string, redirectUri: string): string {
  const cfg = conn.config as unknown as OidcConfig;
  const url = new URL(cfg.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", cfg.scopes || DEFAULT_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/** Exchange an authorization code for tokens, then resolve the userinfo claims. */
export async function exchangeCodeForIdentity(
  conn: SsoConnection,
  code: string,
  redirectUri: string
): Promise<SsoIdentity> {
  const cfg = conn.config as unknown as OidcConfig;
  const clientSecret = connectionClientSecret(conn);
  if (!clientSecret) throw new Error("OIDC connection is missing its client secret");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    client_secret: clientSecret,
  });

  const tokenRes = await fetch(cfg.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const token = (await tokenRes.json().catch(() => ({}))) as TokenResponse;
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(`OIDC token exchange failed: ${token.error || tokenRes.status}`);
  }

  const infoRes = await fetch(cfg.userinfoEndpoint, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
  });
  if (!infoRes.ok) throw new Error(`OIDC userinfo failed: ${infoRes.status}`);
  const claims = (await infoRes.json()) as Record<string, unknown>;

  const email = typeof claims.email === "string" ? claims.email : "";
  if (!email) throw new Error("OIDC userinfo did not return an email claim");
  const name =
    (typeof claims.name === "string" && claims.name) ||
    (typeof claims.preferred_username === "string" && claims.preferred_username) ||
    null;

  const groupsClaim = cfg.groupsClaim || "groups";
  const rawGroups = claims[groupsClaim];
  const groups = Array.isArray(rawGroups) ? rawGroups.filter((g): g is string => typeof g === "string") : [];

  return { email, name, groups };
}
