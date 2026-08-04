/*
 * /console engine-data proxies (session-authed, org-scoped). Each resolves the
 * active org's engine tenant, then reads the engine keyed by workspace. These are
 * the session-auth front door to the same data the bearer-token /v1 API serves.
 */
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requirePermission, type ConsoleEnv } from "../../lib/auth/console-middleware.js";
import { getOrProvisionEngineTenant } from "../../lib/identity/provisioning.js";
import { getUsageSummary } from "../../lib/billing/usage.js";
import { searchChunks } from "../../lib/ai/query-engine.js";
import { db } from "../../lib/db/index.js";
import {
  connectorTokens,
  entityEdges,
  entityNodes,
  memoryChunks,
  memoryUsers,
  skillDefinitions,
  skillVersions,
  staticDocuments,
  subscriptions,
} from "../../lib/db/schema.js";
import { computeDivergences, computeTimeline } from "../../lib/ai/ledger-diff.js";
import { reconstructLedger } from "../../lib/ai/ledger.js";
import { PLANS, resolveDefaultPlan, type PlanName } from "../../lib/billing/plans.js";
import { signCookieValue } from "../../lib/utils/crypto.js";

export const dataRoutes = new Hono<ConsoleEnv>();

dataRoutes.get("/usage", requirePermission("workspace:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { workspaceId } = await getOrProvisionEngineTenant(organization);
  return c.json({ usage: await getUsageSummary(workspaceId) });
});

// Keyword (BM25) search — no embedding dependency, so it works the moment content
// is ingested. Semantic/hybrid modes arrive with the query-embedding path.
dataRoutes.post("/search", requirePermission("memory:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { q?: unknown; limit?: unknown };
  const query = typeof body.q === "string" ? body.q.trim() : "";
  if (!query) return c.json({ error: "q is required" }, 400);
  const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 50) : 20;
  const { workspaceId } = await getOrProvisionEngineTenant(organization);
  const results = await searchChunks({ workspaceId, query, searchMode: "keyword", limit });
  return c.json({
    results: results.map((r) => ({
      id: r.id,
      content: r.content,
      score: r.score,
      sourceType: r.sourceType,
      createdAt: r.createdAt,
    })),
  });
});

// Workspace-level synthesized profile (static facts + dynamic context + temporal facts).
dataRoutes.get("/memory", requirePermission("memory:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { workspaceId } = await getOrProvisionEngineTenant(organization);
  const doc = await db.query.staticDocuments.findFirst({
    where: and(eq(staticDocuments.workspaceId, workspaceId), isNull(staticDocuments.memoryUserId)),
  });
  return c.json({
    profile: doc
      ? {
          staticFacts: doc.staticFacts,
          dynamicContext: doc.dynamicContext,
          temporalFacts: doc.temporalFacts,
          version: doc.version,
          chunksSynthesized: doc.chunksSynthesizedCount,
          lastSynthesizedAt: doc.lastSynthesizedAt,
        }
      : null,
  });
});

// ─── Product-surface projections ────────────────────────────────────────────
// These read models deliberately stay session-authenticated and organization-scoped.
// They provide the Cloud app with the same data as the public API without exposing
// a bearer token in the browser.

dataRoutes.post("/chat", requirePermission("memory:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return c.json({ error: "message is required" }, 400);
  if (message.length > 2_000) return c.json({ error: "message is too long" }, 400);

  const { workspaceId } = await getOrProvisionEngineTenant(organization);
  const hits = await searchChunks({ workspaceId, query: message, searchMode: "keyword", limit: 6 });
  // The first Cloud release is intentionally extractive: it never claims an LLM
  // generated answer is grounded when no model is configured. Users receive the
  // most relevant evidence, with the source text preserved for verification.
  const evidence = hits.map((hit) => ({
    id: hit.id,
    content: hit.content,
    sourceType: hit.sourceType,
    createdAt: hit.createdAt,
    score: hit.score,
  }));
  const answer = evidence.length
    ? `I found ${evidence.length} relevant memory ${evidence.length === 1 ? "item" : "items"}. Review the cited excerpts below.`
    : "I couldn't find grounded evidence for that question in this workspace yet.";
  return c.json({ answer, evidence });
});

dataRoutes.get("/graph", requirePermission("memory:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { developerId } = await getOrProvisionEngineTenant(organization);
  const [nodes, edges] = await Promise.all([
    db
      .select({
        id: entityNodes.id,
        name: entityNodes.name,
        entityType: entityNodes.entityType,
        firstSeenAt: entityNodes.firstSeenAt,
        lastSeenAt: entityNodes.lastSeenAt,
      })
      .from(entityNodes)
      .where(eq(entityNodes.developerId, developerId))
      .orderBy(desc(entityNodes.lastSeenAt))
      .limit(500),
    db
      .select({
        id: entityEdges.id,
        fromEntityId: entityEdges.fromEntityId,
        toEntityId: entityEdges.toEntityId,
        relationship: entityEdges.relationship,
        validFrom: entityEdges.validFrom,
        validUntil: entityEdges.validUntil,
        confidence: entityEdges.confidence,
      })
      .from(entityEdges)
      .innerJoin(entityNodes, eq(entityEdges.fromEntityId, entityNodes.id))
      .where(eq(entityNodes.developerId, developerId))
      .orderBy(desc(entityEdges.recordedAt))
      .limit(750),
  ]);
  return c.json({ nodes, edges });
});

dataRoutes.get("/ledger", requirePermission("memory:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { workspaceId } = await getOrProvisionEngineTenant(organization);
  const [ledger, timeline, divergences] = await Promise.all([
    reconstructLedger(workspaceId),
    computeTimeline(workspaceId),
    computeDivergences(workspaceId),
  ]);
  return c.json({ ledger, timeline, divergences });
});

dataRoutes.get("/procedures", requirePermission("memory:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { workspaceId } = await getOrProvisionEngineTenant(organization);
  const procedures = await db
    .select({
      id: skillDefinitions.id,
      title: skillDefinitions.title,
      description: skillDefinitions.description,
      domain: skillDefinitions.domain,
      status: skillDefinitions.status,
      currentVersion: skillDefinitions.currentVersion,
      updatedAt: skillDefinitions.updatedAt,
      publishedAt: skillVersions.publishedAt,
      confidenceScore: skillVersions.confidenceScore,
      steps: skillVersions.steps,
    })
    .from(skillDefinitions)
    .leftJoin(
      skillVersions,
      and(
        eq(skillVersions.skillId, skillDefinitions.id),
        eq(skillVersions.version, skillDefinitions.currentVersion)
      )
    )
    .where(eq(skillDefinitions.workspaceId, workspaceId))
    .orderBy(desc(skillDefinitions.updatedAt))
    .limit(200);
  return c.json({ procedures });
});

dataRoutes.get("/people", requirePermission("memory:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { developerId } = await getOrProvisionEngineTenant(organization);
  const [users, entities] = await Promise.all([
    db
      .select({ id: memoryUsers.id, externalId: memoryUsers.externalId, optedOut: memoryUsers.optedOut, createdAt: memoryUsers.createdAt })
      .from(memoryUsers)
      .where(eq(memoryUsers.developerId, developerId))
      .orderBy(desc(memoryUsers.createdAt))
      .limit(500),
    db
      .select({ id: entityNodes.id, name: entityNodes.name, firstSeenAt: entityNodes.firstSeenAt, lastSeenAt: entityNodes.lastSeenAt })
      .from(entityNodes)
      .where(and(eq(entityNodes.developerId, developerId), eq(entityNodes.entityType, "person")))
      .orderBy(desc(entityNodes.lastSeenAt))
      .limit(500),
  ]);
  return c.json({ users, entities });
});

dataRoutes.get("/sources", requirePermission("memory:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { workspaceId } = await getOrProvisionEngineTenant(organization);
  const [sourceTypes, recent] = await Promise.all([
    db
      .select({
        sourceType: memoryChunks.sourceType,
        count: sql<number>`count(*)::int`,
        latestAt: sql<Date | null>`max(${memoryChunks.createdAt})`,
      })
      .from(memoryChunks)
      .where(eq(memoryChunks.workspaceId, workspaceId))
      .groupBy(memoryChunks.sourceType)
      .orderBy(desc(sql`max(${memoryChunks.createdAt})`)),
    db
      .select({
        id: memoryChunks.id,
        sourceType: memoryChunks.sourceType,
        sourceId: memoryChunks.sourceId,
        content: memoryChunks.content,
        createdAt: memoryChunks.createdAt,
      })
      .from(memoryChunks)
      .where(eq(memoryChunks.workspaceId, workspaceId))
      .orderBy(desc(memoryChunks.createdAt))
      .limit(100),
  ]);
  return c.json({ sourceTypes, recent });
});

dataRoutes.get("/connectors", requirePermission("workspace:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { workspaceId } = await getOrProvisionEngineTenant(organization);
  const connectors = await db
    .select({ provider: connectorTokens.provider, expiresAt: connectorTokens.expiresAt, lastSyncedAt: connectorTokens.lastSyncedAt, createdAt: connectorTokens.createdAt })
    .from(connectorTokens)
    .where(eq(connectorTokens.workspaceId, workspaceId));
  return c.json({ connectors });
});

// The connector OAuth endpoints predate the Cloud console and authenticate with
// the signed dashboard-workspace cookie. Bridge an authorized console session to
// that bounded compatibility flow; it is still server-side org scoped, and the
// provider's callback state remains HMAC-signed by the connector route.
dataRoutes.get("/connectors/:provider/connect", requirePermission("workspace:write"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const provider = c.req.param("provider");
  const path = provider === "notion" ? "notion" : provider === "google_docs" ? "google-docs" : null;
  if (!path) return c.json({ error: "unsupported OAuth connector" }, 404);
  const { workspaceId } = await getOrProvisionEngineTenant(organization);
  setCookie(c, "dash_ws", signCookieValue(workspaceId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60,
  });
  return c.redirect(`/connectors/${path}/connect`, 302);
});

dataRoutes.get("/billing", requirePermission("billing:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const { workspaceId } = await getOrProvisionEngineTenant(organization);
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.workspaceId, workspaceId),
    columns: { plan: true, status: true, currentPeriodEnd: true },
  });
  const plan = (sub?.plan as PlanName | undefined) ?? resolveDefaultPlan();
  const config = PLANS[plan];
  return c.json({
    subscription: {
      plan,
      displayName: config.displayName,
      status: sub?.status ?? "active",
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      monthlyPriceUsd: config.monthlyPriceUsd,
      supportTier: config.supportTier,
    },
  });
});
