import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { subscriptions, usageStats, channels } from "../db/schema.js";
import { getLimits, resolveDefaultPlan, type PlanName } from "./plans.js";
import { reportMeterEvent } from "./stripe-meters.js";

export type LimitType = "queries" | "messages" | "channels";

export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  plan: PlanName;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

async function getSubscription(workspaceId: string) {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.workspaceId, workspaceId),
  });
  return sub ?? { plan: resolveDefaultPlan(), status: "active" as const };
}

export async function checkLimit(
  workspaceId: string,
  type: LimitType
): Promise<LimitCheckResult> {
  const sub = await getSubscription(workspaceId);
  const plan = sub.plan as PlanName;
  const limits = getLimits(plan);

  if (type === "channels") {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(channels)
      .where(and(eq(channels.workspaceId, workspaceId), eq(channels.isActive, true)));
    const current = rows[0]?.count ?? 0;
    return { allowed: current < limits.maxChannels, current, limit: limits.maxChannels, plan };
  }

  const month = currentMonth();
  const stats = await db.query.usageStats.findFirst({
    where: and(eq(usageStats.workspaceId, workspaceId), eq(usageStats.month, month)),
  });

  if (type === "queries") {
    const current = stats?.queriesCount ?? 0;
    return { allowed: current < limits.maxQueriesPerMonth, current, limit: limits.maxQueriesPerMonth, plan };
  }

  // messages
  const current = stats?.messagesCount ?? 0;
  return { allowed: current < limits.maxMessagesPerMonth, current, limit: limits.maxMessagesPerMonth, plan };
}

export async function incrementQuery(workspaceId: string): Promise<void> {
  const month = currentMonth();
  await db
    .insert(usageStats)
    .values({ workspaceId, month, queriesCount: 1, messagesCount: 0 })
    .onConflictDoUpdate({
      target: [usageStats.workspaceId, usageStats.month],
      set: { queriesCount: sql`${usageStats.queriesCount} + 1` },
    });
}

export async function incrementMessages(workspaceId: string, count = 1): Promise<void> {
  const month = currentMonth();
  await db
    .insert(usageStats)
    .values({ workspaceId, month, queriesCount: 0, messagesCount: count })
    .onConflictDoUpdate({
      target: [usageStats.workspaceId, usageStats.month],
      set: { messagesCount: sql`${usageStats.messagesCount} + ${count}` },
    });
}

export async function incrementQueryIfUnderLimit(workspaceId: string): Promise<LimitCheckResult> {
  const sub = await getSubscription(workspaceId);
  const plan = sub.plan as PlanName;
  const limits = getLimits(plan);
  const limit = limits.maxQueriesPerMonth;
  const month = currentMonth();

  if (!Number.isFinite(limit)) {
    await incrementQuery(workspaceId);
    return { allowed: true, current: 0, limit, plan };
  }

  // Ensure the row exists before the atomic update (noop if already present)
  await db
    .insert(usageStats)
    .values({ workspaceId, month, queriesCount: 0, messagesCount: 0 })
    .onConflictDoNothing();

  const [row] = await db
    .update(usageStats)
    .set({ queriesCount: sql`${usageStats.queriesCount} + 1` })
    .where(
      and(
        eq(usageStats.workspaceId, workspaceId),
        eq(usageStats.month, month),
        lt(usageStats.queriesCount, limit),
      )
    )
    .returning({ queriesCount: usageStats.queriesCount });

  if (row) return { allowed: true, current: row.queriesCount, limit, plan };

  const stats = await db.query.usageStats.findFirst({
    where: and(eq(usageStats.workspaceId, workspaceId), eq(usageStats.month, month)),
  });
  return { allowed: false, current: stats?.queriesCount ?? limit, limit, plan };
}

export async function incrementApiIngest(workspaceId: string, count = 1): Promise<void> {
  const month = currentMonth();
  await db
    .insert(usageStats)
    .values({ workspaceId, month, ingestCallsCount: count })
    .onConflictDoUpdate({
      target: [usageStats.workspaceId, usageStats.month],
      set: { ingestCallsCount: sql`${usageStats.ingestCallsCount} + ${count}` },
    });
}

export async function incrementApiContext(workspaceId: string, count = 1): Promise<void> {
  const month = currentMonth();
  await db
    .insert(usageStats)
    .values({ workspaceId, month, contextCallsCount: count })
    .onConflictDoUpdate({
      target: [usageStats.workspaceId, usageStats.month],
      set: { contextCallsCount: sql`${usageStats.contextCallsCount} + ${count}` },
    });
}

// Returns true if the workspace is within its monthly API limits.
// Non-blocking: increments and checks atomically, returns allowed=false only at limit.
//
// `count` is the units to charge — 1 for a single call, N for a batch of N items
// (POST /v1/ingest/batch). The charge is all-or-nothing: if the whole batch would
// exceed the monthly cap the counter is left unchanged and allowed=false, so a
// batch can't push usage past the limit or be undercounted as a single unit.
export async function checkAndIncrementApiCall(
  workspaceId: string,
  type: "ingest" | "context",
  count = 1
): Promise<{ allowed: boolean }> {
  const charge = Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1;
  const sub = await getSubscription(workspaceId);
  const plan = sub.plan as PlanName;
  const limits = getLimits(plan);
  const limit = type === "ingest" ? limits.maxIngestCallsPerMonth : limits.maxContextCallsPerMonth;

  if (limit === 0) return { allowed: false }; // plan doesn't include API access
  if (!Number.isFinite(limit)) {
    // Unlimited — increment and meter fire-and-forget
    if (type === "ingest") incrementApiIngest(workspaceId, charge).catch(() => null);
    else incrementApiContext(workspaceId, charge).catch(() => null);
    reportMeterEvent(workspaceId, type, charge).catch(() => null);
    return { allowed: true };
  }

  const month = currentMonth();
  const col = type === "ingest" ? usageStats.ingestCallsCount : usageStats.contextCallsCount;

  await db
    .insert(usageStats)
    .values({ workspaceId, month })
    .onConflictDoNothing();

  // Only charge if the ENTIRE batch fits under the cap (col + charge <= limit).
  const [row] = await db
    .update(usageStats)
    .set({ [type === "ingest" ? "ingestCallsCount" : "contextCallsCount"]: sql`${col} + ${charge}` })
    .where(
      and(
        eq(usageStats.workspaceId, workspaceId),
        eq(usageStats.month, month),
        lt(col, limit - charge + 1)
      )
    )
    .returning({ count: col });

  if (row) reportMeterEvent(workspaceId, type, charge).catch(() => null);
  return { allowed: !!row };
}

export async function getUsageSummary(workspaceId: string) {
  const month = currentMonth();
  const [sub, stats, channelRows] = await Promise.all([
    getSubscription(workspaceId),
    db.query.usageStats.findFirst({
      where: and(eq(usageStats.workspaceId, workspaceId), eq(usageStats.month, month)),
    }),
    db.select({ count: sql<number>`count(*)::int` })
      .from(channels)
      .where(and(eq(channels.workspaceId, workspaceId), eq(channels.isActive, true))),
  ]);

  const plan = sub.plan as PlanName;
  const limits = getLimits(plan);
  return {
    plan,
    month,
    queries: { used: stats?.queriesCount ?? 0, limit: limits.maxQueriesPerMonth },
    messages: { used: stats?.messagesCount ?? 0, limit: limits.maxMessagesPerMonth },
    channels: { used: channelRows[0]?.count ?? 0, limit: limits.maxChannels },
    apiIngest: { used: stats?.ingestCallsCount ?? 0, limit: limits.maxIngestCallsPerMonth },
    apiContext: { used: stats?.contextCallsCount ?? 0, limit: limits.maxContextCallsPerMonth },
  };
}
