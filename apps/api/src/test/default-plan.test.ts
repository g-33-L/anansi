/*
 * Which plan a workspace gets when it has no subscription row.
 *
 * This is not a billing detail. The free tier sets memoryRetentionDays: 7, and
 * the retention worker enforces that by hard-deleting chunks — so defaulting a
 * self-hosted install to "free" meant a memory engine that silently forgot
 * everything after a week, on hardware the operator owns outright.
 *
 * The hosted service must keep defaulting to "free", or paid tiers stop meaning
 * anything. Both halves are load-bearing, so both are pinned here.
 */
import { describe, it, expect } from "vitest";
import { resolveDefaultPlan, getLimits, getFeatures } from "../lib/billing/plans.js";
import { buildUpgradeError, gateFeature } from "../lib/billing/feature-gate.js";

const hosted = { STRIPE_SECRET_KEY: "sk_test_fixture" } as NodeJS.ProcessEnv;
const selfHosted = {} as NodeJS.ProcessEnv;

describe("resolveDefaultPlan", () => {
  it("defaults a self-hosted install to unlimited", () => {
    expect(resolveDefaultPlan(selfHosted)).toBe("enterprise");
  });

  it("keeps the hosted service on free — Stripe present means upgrades are purchasable", () => {
    expect(resolveDefaultPlan(hosted)).toBe("free");
  });

  it("lets an operator override either way", () => {
    expect(resolveDefaultPlan({ ANANSI_DEFAULT_PLAN: "free" } as NodeJS.ProcessEnv)).toBe("free");
    expect(
      resolveDefaultPlan({ STRIPE_SECRET_KEY: "sk_test", ANANSI_DEFAULT_PLAN: "pro" } as NodeJS.ProcessEnv)
    ).toBe("pro");
  });

  it("ignores an unrecognised override rather than trusting it", () => {
    expect(resolveDefaultPlan({ ANANSI_DEFAULT_PLAN: "unlimited" } as NodeJS.ProcessEnv)).toBe("enterprise");
  });

  // The specific regression: 7-day retention is what the retention worker acts on.
  it("does not put a self-hosted default under finite retention", () => {
    expect(getLimits(resolveDefaultPlan(selfHosted)).memoryRetentionDays).toBe(Infinity);
    expect(getLimits(resolveDefaultPlan(hosted)).memoryRetentionDays).toBe(7);
  });

  it("gives a self-hosted default the search features the product is sold on", () => {
    const features = getFeatures(resolveDefaultPlan(selfHosted));
    expect(features.hybridSearch).toBe(true);
    expect(features.entityGraph).toBe(true);
  });
});

// Changing the *default* must not weaken the gate itself. If a workspace is
// genuinely on "free", the restrictions still apply.
describe("gateFeature still enforces an explicitly-free plan", () => {
  it("blocks a gated feature on free and allows it on enterprise", () => {
    expect(gateFeature("free", "hybridSearch", "Hybrid search")).not.toBeNull();
    expect(gateFeature("enterprise", "hybridSearch", "Hybrid search")).toBeNull();
  });
});

describe("buildUpgradeError", () => {
  it("points hosted users at the portal", () => {
    expect(buildUpgradeError("hybridSearch", "Hybrid search", hosted).error).toContain("/portal");
  });

  it("never points a self-hoster at a portal their install does not serve", () => {
    const { error } = buildUpgradeError("hybridSearch", "Hybrid search", selfHosted);
    expect(error).not.toContain("/portal");
    expect(error).toContain("ANANSI_DEFAULT_PLAN");
  });
});
