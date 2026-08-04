import { describe, expect, it } from "vitest";
import type { Profile } from "@node-saml/node-saml";
import { samlIdentityFromProfile, validateSamlConfig } from "../lib/enterprise/sso/saml.js";

const config = {
  idpEntityId: "https://idp.example.test/metadata",
  idpSsoUrl: "https://idp.example.test/sso",
  idpCertificate: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
  spEntityId: "https://anansi.example.test/saml",
  groupsAttribute: "memberOf",
};

describe("SAML configuration and identity mapping", () => {
  it("requires all IdP and SP trust material", () => {
    expect(validateSamlConfig(config)).toBe(true);
    expect(validateSamlConfig({ ...config, idpCertificate: "" })).toBe(false);
    expect(validateSamlConfig({ idpSsoUrl: config.idpSsoUrl })).toBe(false);
  });

  it("maps a verified profile and configured group attribute", () => {
    const identity = samlIdentityFromProfile(
      { nameID: "Owner@Example.Test", displayName: "Owner", memberOf: ["admins", "eng"] } as unknown as Profile,
      config
    );
    expect(identity).toEqual({ email: "owner@example.test", name: "Owner", groups: ["admins", "eng"] });
  });

  it("rejects a verified assertion without an email-shaped subject", () => {
    expect(() => samlIdentityFromProfile({ nameID: "not-an-email" } as unknown as Profile, config)).toThrow(/valid email/);
  });
});
