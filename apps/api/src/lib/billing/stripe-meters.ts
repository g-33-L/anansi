import { getStripe } from "./billing.js";
import { db } from "../db/index.js";
import { subscriptions } from "../db/schema.js";
import { eq } from "drizzle-orm";

// Fire-and-forget: report `count` usage units to a Stripe Billing Meter.
// No-ops if STRIPE_SECRET_KEY or the relevant meter event name is not configured.
// count > 1 for batch ingest (one meter event carrying the batch size) so metered
// usage matches the quota charged in checkAndIncrementApiCall.
export async function reportMeterEvent(
  workspaceId: string,
  type: "ingest" | "context",
  count = 1
): Promise<void> {
  const eventName = type === "ingest"
    ? process.env.STRIPE_INGEST_METER_EVENT_NAME
    : process.env.STRIPE_CONTEXT_METER_EVENT_NAME;

  if (!eventName || !process.env.STRIPE_SECRET_KEY) return;
  if (!Number.isFinite(count) || count < 1) return;

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.workspaceId, workspaceId),
    columns: { stripeCustomerId: true },
  });

  if (!sub?.stripeCustomerId) return;

  await getStripe().billing.meterEvents.create({
    event_name: eventName,
    payload: {
      stripe_customer_id: sub.stripeCustomerId,
      value: String(Math.floor(count)),
    },
  });
}

// ─── Reconciliation ───────────────────────────────────────────────────────────
// reportMeterEvent is fire-and-forget: a transient Stripe failure silently drops
// a usage unit, so metered (overage) revenue can quietly diverge from the usage
// we recorded locally. scripts/reconcile-meters.ts compares the two; this pure
// helper is the comparison, split out so it can be unit-tested without Stripe.

export type MeterMetric = "ingest" | "context";

export interface LocalUsage {
  workspaceId: string;
  ingest: number;
  context: number;
}

export interface MeterDiscrepancy {
  workspaceId: string;
  metric: MeterMetric;
  local: number;      // units we counted in usage_stats
  reported: number;   // units Stripe's meter summaries show
  drift: number;      // local - reported; positive = under-reported to Stripe (lost revenue)
}

// Returns only the (workspace, metric) pairs whose drift exceeds the tolerance.
// Tolerance is the larger of an absolute floor and a fraction of local usage, so
// tiny timing skews near a period boundary don't page anyone. `reported` is keyed
// by workspaceId; a missing entry counts as 0 reported.
export function compareMeterUsage(
  local: LocalUsage[],
  reported: Map<string, { ingest: number; context: number }>,
  opts: { tolerancePct?: number; toleranceAbs?: number } = {}
): MeterDiscrepancy[] {
  const tolerancePct = opts.tolerancePct ?? 0.01;
  const toleranceAbs = opts.toleranceAbs ?? 2;
  const out: MeterDiscrepancy[] = [];

  for (const row of local) {
    const rep = reported.get(row.workspaceId) ?? { ingest: 0, context: 0 };
    for (const metric of ["ingest", "context"] as const) {
      const localVal = row[metric];
      const reportedVal = rep[metric];
      const drift = localVal - reportedVal;
      const allowed = Math.max(toleranceAbs, Math.abs(localVal) * tolerancePct);
      if (Math.abs(drift) > allowed) {
        out.push({ workspaceId: row.workspaceId, metric, local: localVal, reported: reportedVal, drift });
      }
    }
  }
  return out;
}
