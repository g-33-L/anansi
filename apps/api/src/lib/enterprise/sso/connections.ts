/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

/*
 * SSO connection storage (Phase 7). One row per org (SAML or OIDC). Non-secret IdP
 * wiring lives in `config` (jsonb); the OIDC client secret is encrypted at rest
 * (AES-256-GCM via lib/utils/crypto) and never returned to the client.
 */
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { ssoConnections, type SsoConnection } from "../../db/schema.js";
import { encrypt, decrypt } from "../../utils/crypto.js";

export interface OidcConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  clientId: string;
  scopes?: string; // default "openid email profile"
  groupsClaim?: string; // userinfo claim holding group names (default "groups")
}

export interface SamlConfig {
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string; // IdP signing cert (public, PEM)
  spEntityId: string;
  groupsAttribute?: string; // assertion attribute holding groups
}

export async function getConnectionByOrg(organizationId: string): Promise<SsoConnection | undefined> {
  return db.query.ssoConnections.findFirst({
    where: eq(ssoConnections.organizationId, organizationId),
  });
}

/** Upsert the org's single SSO connection. `clientSecret` (OIDC) is encrypted. */
export async function upsertConnection(input: {
  organizationId: string;
  protocol: "saml" | "oidc";
  config: OidcConfig | SamlConfig;
  clientSecret?: string | null;
  groupRoleMap?: Record<string, string>;
  enabled?: boolean;
}): Promise<SsoConnection> {
  const secret =
    input.clientSecret != null && input.clientSecret !== "" ? encrypt(input.clientSecret) : null;
  const values = {
    organizationId: input.organizationId,
    protocol: input.protocol,
    config: input.config as unknown as Record<string, unknown>,
    groupRoleMap: input.groupRoleMap ?? {},
    enabled: input.enabled ?? false,
    updatedAt: new Date(),
    ...(secret !== null ? { secret } : {}),
  };
  const [row] = await db
    .insert(ssoConnections)
    .values(values)
    .onConflictDoUpdate({ target: ssoConnections.organizationId, set: values })
    .returning();
  return row;
}

export async function setEnabled(organizationId: string, enabled: boolean): Promise<void> {
  await db
    .update(ssoConnections)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(ssoConnections.organizationId, organizationId));
}

export async function deleteConnection(organizationId: string): Promise<boolean> {
  const rows = await db
    .delete(ssoConnections)
    .where(eq(ssoConnections.organizationId, organizationId))
    .returning({ id: ssoConnections.id });
  return rows.length > 0;
}

/** Decrypt the stored OIDC client secret (server-side only). */
export function connectionClientSecret(conn: SsoConnection): string | null {
  return conn.secret ? decrypt(conn.secret) : null;
}

/** Public view: the config plus flags, with the secret stripped. */
export function publicConnectionView(conn: SsoConnection) {
  return {
    protocol: conn.protocol,
    config: conn.config,
    groupRoleMap: conn.groupRoleMap,
    enabled: conn.enabled,
    hasSecret: Boolean(conn.secret),
    updatedAt: conn.updatedAt,
  };
}
