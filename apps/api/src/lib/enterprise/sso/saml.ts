/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

/*
 * SAML 2.0 assertion consumption. Node-SAML validates the XML-DSig before it
 * returns a profile; this module deliberately has no XML parsing fallback. A
 * malformed, expired, unsigned, incorrectly-issued, or wrong-audience response
 * therefore fails before JIT provisioning can see an identity.
 */
import { SAML, ValidateInResponseTo, type Profile } from "@node-saml/node-saml";
import type { SsoConnection } from "../../db/schema.js";
import type { SamlConfig } from "./connections.js";
import type { SsoIdentity } from "./provision.js";

const esc = (s: string): string => s.replace(/[<>&"]/g, (ch) => `&#${ch.charCodeAt(0)};`);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Validate persisted config before passing it to the SAML library. */
export function validateSamlConfig(value: unknown): value is SamlConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<SamlConfig>;
  return [config.idpEntityId, config.idpSsoUrl, config.idpCertificate, config.spEntityId].every(isNonEmptyString);
}

function configFor(conn: SsoConnection): SamlConfig {
  if (conn.protocol !== "saml" || !validateSamlConfig(conn.config)) {
    throw new Error("SAML connection configuration is incomplete");
  }
  return conn.config;
}

function client(conn: SsoConnection, acsUrl: string): SAML {
  const cfg = configFor(conn);
  return new SAML({
    callbackUrl: acsUrl,
    issuer: cfg.spEntityId,
    entryPoint: cfg.idpSsoUrl,
    idpCert: cfg.idpCertificate,
    idpIssuer: cfg.idpEntityId,
    audience: cfg.spEntityId,
    // Neither an unsigned Response nor an unsigned Assertion is an identity.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: true,
    acceptedClockSkewMs: 60_000,
    maxAssertionAgeMs: 5 * 60_000,
    // SP-initiated responses validate InResponseTo; signed IdP-initiated SSO is
    // also supported when the IdP omits it.
    validateInResponseTo: ValidateInResponseTo.ifPresent,
    requestIdExpirationPeriodMs: 5 * 60_000,
    disableRequestedAuthnContext: true,
  });
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) return value.map(firstString).find((item): item is string => item !== null) ?? null;
  return null;
}

function stringList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const values = raw.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  return values.length ? [...new Set(values)] : undefined;
}

/** Convert a signature-verified node-saml profile into the least privilege JIT identity. */
export function samlIdentityFromProfile(profile: Profile, config: SamlConfig): SsoIdentity {
  const attributes = profile as Record<string, unknown>;
  const email = firstString(attributes.email) ?? firstString(attributes.mail) ?? firstString(attributes.nameID);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("verified SAML assertion did not contain a valid email identity");
  }
  const name = firstString(attributes.displayName) ?? firstString(attributes.name) ?? firstString(attributes.cn) ?? null;
  const groups = stringList(attributes[config.groupsAttribute ?? "groups"]);
  return { email: email.toLowerCase(), name, groups };
}

/** SP-initiated login URL. Node-SAML stores the generated request ID for response validation. */
export async function buildSamlAuthorizeUrl(conn: SsoConnection, acsUrl: string, host?: string): Promise<string> {
  return client(conn, acsUrl).getAuthorizeUrlAsync("", host, {});
}

/** Validate a POST binding response and map only its verified profile. */
export async function consumeSamlAssertion(conn: SsoConnection, samlResponse: string, acsUrl: string): Promise<SsoIdentity> {
  if (!samlResponse) throw new Error("SAMLResponse is required");
  const result = await client(conn, acsUrl).validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (result.loggedOut || !result.profile) throw new Error("SAML response did not contain a login assertion");
  return samlIdentityFromProfile(result.profile, configFor(conn));
}

/** SP metadata XML the customer uploads into their IdP. */
export function buildSpMetadata(conn: SsoConnection, acsUrl: string): string {
  const cfg = configFor(conn);
  const entityId = esc(cfg.spEntityId);
  return [
    '<?xml version="1.0"?>',
    `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">`,
    '  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
    '    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>',
    `    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${esc(acsUrl)}" index="0" isDefault="true"/>`,
    '  </SPSSODescriptor>',
    '</EntityDescriptor>',
  ].join("\n");
}
