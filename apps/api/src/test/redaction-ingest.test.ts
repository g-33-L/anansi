/*
 * Phase 11.1 integration — proves org redaction rules are actually enforced at the
 * ingest boundary (not just CRUD). Guards the fix for the "redaction engine that
 * nothing calls" gap: redactForWorkspace must resolve workspace → org → rules and
 * apply them ON TOP of the static secret scrub, while an org-less workspace falls
 * back to the scrub only.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { seedOrg, seedOrphanWorkspace, seedRedactionRule, resetOrgState } from "./helpers/fixtures.js";
import { redactForWorkspace, getEnabledRulesForWorkspace } from "../lib/enterprise/redaction.js";

describe("redactForWorkspace (org PII rules applied at ingest)", () => {
  beforeEach(async () => {
    await resetOrgState();
  });

  it("applies the org's email-mask rule AND the static secret scrub", async () => {
    const { organizationId, workspaceId } = await seedOrg();
    await seedRedactionRule(organizationId, "email", "mask");

    const { text, secretsRedacted } = await redactForWorkspace(
      workspaceId,
      "ping jane@acme.test — key sk_live_ABCDEFGHIJKLMNOPQRSTUVWX"
    );

    expect(text).not.toContain("jane@acme.test"); // org rule masked the email
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("sk_live_ABCDEFGHIJKLMNOPQRSTUVWX"); // static scrub caught the secret
    expect(secretsRedacted).toBe(1);
  });

  it("honors the drop action", async () => {
    const { organizationId, workspaceId } = await seedOrg();
    await seedRedactionRule(organizationId, "email", "drop");
    const { text } = await redactForWorkspace(workspaceId, "reach me at bob@x.test now");
    expect(text).not.toContain("bob@x.test");
    expect(text).not.toContain("[REDACTED]"); // dropped, not masked
  });

  it("ignores disabled rules", async () => {
    const { organizationId, workspaceId } = await seedOrg();
    await seedRedactionRule(organizationId, "email", "mask", /* enabled */ false);
    const { text } = await redactForWorkspace(workspaceId, "email amy@x.test");
    expect(text).toContain("amy@x.test");
  });

  it("an org-less workspace applies the static scrub only (back-compat)", async () => {
    const { workspaceId } = await seedOrphanWorkspace();
    expect(await getEnabledRulesForWorkspace(workspaceId)).toHaveLength(0);
    const { text, secretsRedacted } = await redactForWorkspace(
      workspaceId,
      "email carol@x.test key sk_live_ABCDEFGHIJKLMNOPQRSTUVWX"
    );
    expect(text).toContain("carol@x.test"); // no org rule → email survives
    expect(secretsRedacted).toBe(1); // secret still scrubbed
  });
});
