#!/usr/bin/env tsx
// Meter reconciliation — compares locally-counted API usage (usage_stats) against
// what Stripe's billing meters actually recorded, so a silently-dropped
// reportMeterEvent (fire-and-forget) doesn't quietly lose overage revenue.
//
//   pnpm --filter @anansi/api reconcile:meters               # current month, report only
//   … reconcile:meters -- --month=2026-06                    # a specific YYYY-MM
//   … reconcile:meters -- --strict                           # exit 1 if any drift (for cron alerting)
//
// Caveat: usage_stats is per calendar month; Stripe meters aggregate per billing
// period. Over a full closed month they line up closely; near a period boundary
// expect small skew (hence the tolerance). This is a drift ALARM, not a ledger.
//
// Requires STRIPE_SECRET_KEY and the meter event names. No-ops loudly if meters
// aren't configured (usage is then local-only by design).

import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/index.js";
import { subscriptions, usageStats } from "../src/lib/db/schema.js";
import { getStripe } from "../src/lib/billing/billing.js";
import { compareMeterUsage, type LocalUsage } from "../src/lib/billing/stripe-meters.js";
import { captureMessage } from "../src/lib/infra/error-reporting.js";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const strict = process.argv.includes("--strict");
const month = arg("month") ?? new Date().toISOString().slice(0, 7);

if (!/^\d{4}-\d{2}$/.test(month)) {
  console.error(`Invalid --month "${month}" — expected YYYY-MM`);
  process.exit(2);
}
if (!process.env.STRIPE_SECRET_KEY) {
  console.error("STRIPE_SECRET_KEY not set — nothing to reconcile.");
  process.exit(2);
}

const ingestEvent = process.env.STRIPE_INGEST_METER_EVENT_NAME;
const contextEvent = process.env.STRIPE_CONTEXT_METER_EVENT_NAME;
if (!ingestEvent && !contextEvent) {
  console.error("No STRIPE_*_METER_EVENT_NAME configured — usage is local-only, nothing reported to Stripe to reconcile.");
  process.exit(2);
}

// [start, end) epoch seconds for the calendar month (UTC).
const [y, m] = month.split("-").map(Number);
const startTime = Math.floor(Date.UTC(y, m - 1, 1) / 1000);
const endTime = Math.floor(Date.UTC(y, m, 1) / 1000);

const stripe = getStripe();

async function meterIdForEvent(eventName: string): Promise<string | null> {
  // Meters are few; a single list is fine. Match by event_name.
  for await (const meter of stripe.billing.meters.list({ limit: 100 })) {
    if (meter.event_name === eventName) return meter.id;
  }
  return null;
}

async function sumMeter(meterId: string, customerId: string): Promise<number> {
  // listEventSummaries returns a single (non-auto-paginating) page. Default
  // day-grouping yields at most ~31 summaries for a month — well under 100 — so
  // one page suffices; warn (rather than silently truncate) if Stripe returns more.
  const summaries = await stripe.billing.meters.listEventSummaries(meterId, {
    customer: customerId,
    start_time: startTime,
    end_time: endTime,
    limit: 100,
  });
  if (summaries.has_more) {
    console.warn(`⚠ meter ${meterId} / customer ${customerId}: >100 summaries in window — total may be truncated`);
  }
  return summaries.data.reduce((sum, s) => sum + (s.aggregated_value ?? 0), 0);
}

async function main(): Promise<void> {
  console.log(`\nMeter reconciliation for ${month} (UTC ${new Date(startTime * 1000).toISOString()} → ${new Date(endTime * 1000).toISOString()})\n`);

  const ingestMeterId = ingestEvent ? await meterIdForEvent(ingestEvent) : null;
  const contextMeterId = contextEvent ? await meterIdForEvent(contextEvent) : null;
  if (ingestEvent && !ingestMeterId) console.warn(`⚠ No Stripe meter found for event "${ingestEvent}"`);
  if (contextEvent && !contextMeterId) console.warn(`⚠ No Stripe meter found for event "${contextEvent}"`);

  // Local usage for the month, joined to the workspace's Stripe customer.
  const rows = await db
    .select({
      workspaceId: usageStats.workspaceId,
      ingest: usageStats.ingestCallsCount,
      context: usageStats.contextCallsCount,
      stripeCustomerId: subscriptions.stripeCustomerId,
    })
    .from(usageStats)
    .innerJoin(subscriptions, eq(subscriptions.workspaceId, usageStats.workspaceId))
    .where(eq(usageStats.month, month));

  const local: LocalUsage[] = [];
  const reported = new Map<string, { ingest: number; context: number }>();

  for (const r of rows) {
    if (!r.stripeCustomerId) continue; // no Stripe customer → not billed via meters
    local.push({ workspaceId: r.workspaceId, ingest: r.ingest, context: r.context });
    const ing = ingestMeterId ? await sumMeter(ingestMeterId, r.stripeCustomerId) : 0;
    const ctx = contextMeterId ? await sumMeter(contextMeterId, r.stripeCustomerId) : 0;
    reported.set(r.workspaceId, { ingest: ing, context: ctx });
  }

  const discrepancies = compareMeterUsage(local, reported);

  console.log(`Workspaces reconciled: ${local.length}`);
  if (discrepancies.length === 0) {
    console.log("✓ No drift beyond tolerance — local usage matches Stripe meters.\n");
    return;
  }

  console.log(`\n✗ ${discrepancies.length} discrepancy(ies):\n`);
  for (const d of discrepancies) {
    const dir = d.drift > 0 ? "UNDER-reported to Stripe (lost revenue)" : "OVER-reported to Stripe";
    console.log(`  ${d.workspaceId}  ${d.metric.padEnd(7)} local=${d.local} stripe=${d.reported} drift=${d.drift > 0 ? "+" : ""}${d.drift}  ${dir}`);
  }
  console.log("");

  captureMessage(
    `[reconcile-meters] ${month}: ${discrepancies.length} usage/meter discrepancy(ies) across ${local.length} workspace(s)`,
    "warning"
  );

  if (strict) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[reconcile-meters] failed:", err);
    process.exit(1);
  });
