import { describe, it, expect } from "vitest";
import { compareMeterUsage, type LocalUsage } from "../lib/billing/stripe-meters.js";

// Pure comparison logic behind scripts/reconcile-meters.ts — no DB or Stripe.

describe("compareMeterUsage", () => {
  const local: LocalUsage[] = [{ workspaceId: "ws1", ingest: 1000, context: 500 }];

  it("reports no discrepancy when local matches Stripe", () => {
    const reported = new Map([["ws1", { ingest: 1000, context: 500 }]]);
    expect(compareMeterUsage(local, reported)).toEqual([]);
  });

  it("flags under-reporting (dropped meter events = lost revenue) with positive drift", () => {
    const reported = new Map([["ws1", { ingest: 900, context: 500 }]]);
    const d = compareMeterUsage(local, reported);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ workspaceId: "ws1", metric: "ingest", local: 1000, reported: 900, drift: 100 });
  });

  it("flags over-reporting with negative drift", () => {
    const reported = new Map([["ws1", { ingest: 1000, context: 600 }]]);
    const d = compareMeterUsage(local, reported);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ metric: "context", drift: -100 });
  });

  it("treats a workspace missing from Stripe as 0 reported", () => {
    const d = compareMeterUsage(local, new Map());
    expect(d.map((x) => x.metric).sort()).toEqual(["context", "ingest"]);
    expect(d.find((x) => x.metric === "ingest")?.drift).toBe(1000);
  });

  it("ignores drift within the absolute tolerance floor", () => {
    const reported = new Map([["ws1", { ingest: 999, context: 499 }]]); // off by 1, floor is 2
    expect(compareMeterUsage(local, reported)).toEqual([]);
  });

  it("ignores drift within the percentage tolerance for large counts", () => {
    const big: LocalUsage[] = [{ workspaceId: "ws1", ingest: 100_000, context: 0 }];
    const reported = new Map([["ws1", { ingest: 99_500, context: 0 }]]); // 0.5% < 1% default
    expect(compareMeterUsage(big, reported)).toEqual([]);
  });

  it("flags drift once it exceeds the percentage tolerance", () => {
    const big: LocalUsage[] = [{ workspaceId: "ws1", ingest: 100_000, context: 0 }];
    const reported = new Map([["ws1", { ingest: 98_000, context: 0 }]]); // 2% > 1%
    const d = compareMeterUsage(big, reported);
    expect(d).toHaveLength(1);
    expect(d[0].drift).toBe(2000);
  });

  it("honors a custom tolerance", () => {
    const reported = new Map([["ws1", { ingest: 950, context: 500 }]]);
    expect(compareMeterUsage(local, reported, { toleranceAbs: 100 })).toEqual([]); // 50 <= 100
    expect(compareMeterUsage(local, reported, { toleranceAbs: 10 })).toHaveLength(1);
  });
});
