/*
 * Phase 7 enterprise unit tests — pure logic only (no DB): RBAC matrix additions,
 * ed25519 license verification (fail-closed), redaction rule application, and the
 * SSO group→role mapping.
 */
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { roleHasPermission } from "../lib/identity/roles.js";
import { verifyLicense, editionAllowsEnterprise, type LicensePayload } from "../lib/enterprise/license.js";
import { applyRedactionRules, compileRule, isRedactionAction } from "../lib/enterprise/redaction.js";
import { roleFromGroups } from "../lib/enterprise/sso/provision.js";

describe("enterprise RBAC", () => {
  it("owner holds every enterprise permission", () => {
    for (const p of ["sso:write", "scim:manage", "governance:decide", "license:write", "audit:export"] as const) {
      expect(roleHasPermission("owner", p)).toBe(true);
    }
  });

  it("auditor can read + export audit but cannot write config", () => {
    expect(roleHasPermission("auditor", "audit:read")).toBe(true);
    expect(roleHasPermission("auditor", "audit:export")).toBe(true);
    expect(roleHasPermission("auditor", "sso:read")).toBe(true);
    expect(roleHasPermission("auditor", "sso:write")).toBe(false);
    expect(roleHasPermission("auditor", "governance:decide")).toBe(false);
  });

  it("viewer/member hold no enterprise permissions", () => {
    for (const role of ["viewer", "member"] as const) {
      expect(roleHasPermission(role, "sso:read")).toBe(false);
      expect(roleHasPermission(role, "audit:read")).toBe(false);
    }
  });

  it("editionAllowsEnterprise only for 'enterprise'", () => {
    expect(editionAllowsEnterprise("enterprise")).toBe(true);
    for (const e of ["cloud", "self_hosted", "community", "", null, undefined]) {
      expect(editionAllowsEnterprise(e)).toBe(false);
    }
  });
});

describe("license verification (ed25519, fail-closed)", () => {
  let privateKey: crypto.KeyObject;
  const sign = (payload: LicensePayload): string => {
    const bytes = Buffer.from(JSON.stringify(payload), "utf8");
    const sig = crypto.sign(null, bytes, privateKey);
    return `${bytes.toString("base64url")}.${sig.toString("base64url")}`;
  };

  beforeAll(() => {
    const { publicKey, privateKey: pk } = crypto.generateKeyPairSync("ed25519");
    privateKey = pk;
    process.env.LICENSE_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
  });

  it("accepts a valid, unexpired, signed license", () => {
    const payload: LicensePayload = { organizationId: "org-1", edition: "enterprise", seats: 50 };
    const got = verifyLicense(sign(payload));
    expect(got).not.toBeNull();
    expect(got?.edition).toBe("enterprise");
    expect(got?.seats).toBe(50);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = sign({ organizationId: "org-1", edition: "cloud" });
    const [, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ organizationId: "org-1", edition: "enterprise" })).toString("base64url");
    expect(verifyLicense(`${forged}.${sig}`)).toBeNull();
  });

  it("rejects an expired license", () => {
    const expired: LicensePayload = {
      organizationId: "org-1",
      edition: "enterprise",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    expect(verifyLicense(sign(expired))).toBeNull();
  });

  it("returns null when no public key is configured", () => {
    const saved = process.env.LICENSE_PUBLIC_KEY;
    delete process.env.LICENSE_PUBLIC_KEY;
    expect(verifyLicense(sign({ organizationId: "org-1", edition: "enterprise" }))).toBeNull();
    process.env.LICENSE_PUBLIC_KEY = saved;
  });
});

describe("redaction rules", () => {
  it("compiles named detectors and raw regex, rejects garbage", () => {
    expect(compileRule("email")).toBeInstanceOf(RegExp);
    expect(compileRule("\\d{3}")).toBeInstanceOf(RegExp);
    expect(compileRule("(")).toBeNull(); // invalid regex
  });

  it("masks, drops, and hashes matches per action", () => {
    const text = "reach me at jane@acme.test now";
    const masked = applyRedactionRules(text, [{ pattern: "email", action: "mask", enabled: true }]);
    expect(masked).toBe("reach me at [REDACTED] now");

    const dropped = applyRedactionRules(text, [{ pattern: "email", action: "drop", enabled: true }]);
    expect(dropped).toBe("reach me at  now");

    const hashed = applyRedactionRules(text, [{ pattern: "email", action: "hash", enabled: true }]);
    expect(hashed).toMatch(/reach me at \[#[0-9a-f]{8}\] now/);
  });

  it("skips disabled rules", () => {
    const text = "jane@acme.test";
    expect(applyRedactionRules(text, [{ pattern: "email", action: "mask", enabled: false }])).toBe(text);
  });

  it("validates the action set", () => {
    expect(isRedactionAction("mask")).toBe(true);
    expect(isRedactionAction("nuke")).toBe(false);
  });
});

describe("SSO group→role mapping", () => {
  const map = { "eng-admins": "admin", auditors: "auditor" };
  it("maps the first matching group to its role", () => {
    expect(roleFromGroups(["random", "eng-admins"], map)).toBe("admin");
    expect(roleFromGroups(["auditors"], map)).toBe("auditor");
  });
  it("defaults to viewer when no group matches or groups are absent", () => {
    expect(roleFromGroups(["unknown"], map)).toBe("viewer");
    expect(roleFromGroups(undefined, map)).toBe("viewer");
  });
  it("ignores a mapped value that is not a real role", () => {
    expect(roleFromGroups(["x"], { x: "superuser" })).toBe("viewer");
  });
});
