import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { normalizeStripeStatus, resolvePlanFromStripe } from "../lib/billing/billing.js";

// Pure-logic tests for the dunning/grace + status-normalization behavior.
// No DB or Stripe network — these functions are the entitlement decision.

describe("normalizeStripeStatus", () => {
  it("passes through statuses that exist in our enum", () => {
    for (const s of ["active", "trialing", "past_due", "canceled", "incomplete"] as const) {
      expect(normalizeStripeStatus(s)).toBe(s);
    }
  });

  it("maps Stripe statuses outside our enum onto safe values (no enum violation)", () => {
    expect(normalizeStripeStatus("unpaid")).toBe("canceled");
    expect(normalizeStripeStatus("paused")).toBe("canceled");
    expect(normalizeStripeStatus("incomplete_expired")).toBe("incomplete");
  });

  it("defaults unknown/future statuses to canceled (fail safe)", () => {
    expect(normalizeStripeStatus("something_new")).toBe("canceled");
    expect(normalizeStripeStatus("")).toBe("canceled");
  });
});

describe("resolvePlanFromStripe (dunning grace)", () => {
  const PRO = "price_pro_123";
  const SCALE = "price_scale_456";
  const API = "price_api_789";

  beforeEach(() => {
    process.env.STRIPE_SCALE_PRICE_ID = SCALE;
    process.env.STRIPE_API_PRICE_ID = API;
  });
  afterEach(() => {
    delete process.env.STRIPE_SCALE_PRICE_ID;
    delete process.env.STRIPE_API_PRICE_ID;
  });

  it("keeps the paid plan while past_due — the grace window, not an instant downgrade", () => {
    expect(resolvePlanFromStripe("past_due", PRO)).toBe("pro");
    expect(resolvePlanFromStripe("past_due", SCALE)).toBe("scale");
  });

  it("keeps the paid plan for active and trialing", () => {
    expect(resolvePlanFromStripe("active", SCALE)).toBe("scale");
    expect(resolvePlanFromStripe("trialing", PRO)).toBe("pro");
    expect(resolvePlanFromStripe("active", API)).toBe("api");
  });

  it("downgrades to free once retries are exhausted (canceled/unpaid/paused)", () => {
    expect(resolvePlanFromStripe("canceled", PRO)).toBe("free");
    expect(resolvePlanFromStripe("unpaid", PRO)).toBe("free");
    expect(resolvePlanFromStripe("paused", SCALE)).toBe("free");
  });

  it("treats never-activated subscriptions (incomplete) as free", () => {
    expect(resolvePlanFromStripe("incomplete", PRO)).toBe("free");
    expect(resolvePlanFromStripe("incomplete_expired", PRO)).toBe("free");
  });

  it("maps an unrecognized price id on an entitled status to pro (safe default)", () => {
    expect(resolvePlanFromStripe("active", "price_unknown")).toBe("pro");
    expect(resolvePlanFromStripe("active", undefined)).toBe("pro");
  });
});
