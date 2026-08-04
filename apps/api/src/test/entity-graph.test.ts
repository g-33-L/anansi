import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, developerAccounts, memoryUsers, entityNodes, entityEdges } from "../lib/db/schema.js";
import { cleanDatabase } from "./setup.js";
import { persistEntityGraph, type ExtractedEntity } from "../lib/ai/entity-graph.js";
import { getEntitiesForUser } from "../lib/ai/query-engine.js";

// ─── Entity graph eval harness ────────────────────────────────────────────────
// Deterministic fixed-input → expected-graph tests for the bi-temporal entity
// graph. This is the genuinely risky code (LLM-driven extraction writing to a
// time-versioned graph), so it gets its own eval beyond the route tests: each
// case feeds a known ExtractedEntity[] into persistEntityGraph and asserts the
// resulting nodes/edges, exercising supersession, edge-closing, dedup, atomicity,
// and race-safety.

let developerId: string;
let memoryUserId: string;

beforeEach(async () => {
  await cleanDatabase();
  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId: ws.id, name: "Test Dev", email: "graph@test.com" })
    .returning({ id: developerAccounts.id });
  developerId = dev.id;
  const [user] = await db
    .insert(memoryUsers)
    .values({ developerId, externalId: "graph_user" })
    .returning({ id: memoryUsers.id });
  memoryUserId = user.id;
});

afterAll(closePool);

// ─── Assertion helpers ────────────────────────────────────────────────────────

async function countActiveEdges(relationship?: string): Promise<number> {
  const conds = [isNull(entityEdges.validUntil)];
  if (relationship) conds.push(eq(entityEdges.relationship, relationship));
  const rows = await db.select().from(entityEdges).where(and(...conds));
  // Scope to this user's nodes
  const userNodeIds = new Set(
    (await db.select({ id: entityNodes.id }).from(entityNodes).where(eq(entityNodes.memoryUserId, memoryUserId))).map((n) => n.id)
  );
  return rows.filter((r) => userNodeIds.has(r.fromEntityId)).length;
}

describe("entity graph — node + edge creation", () => {
  it("creates nodes and an active edge from a fresh extraction", async () => {
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Stripe", targetType: "org", current: true }] },
    ]);

    const entities = await getEntitiesForUser(memoryUserId);
    const alex = entities.find((e) => e.name === "Alex");
    const stripe = entities.find((e) => e.name === "Stripe");

    expect(alex).toBeDefined();
    expect(alex!.type).toBe("person");
    expect(stripe).toBeDefined();
    expect(stripe!.type).toBe("org");

    expect(alex!.relationships).toHaveLength(1);
    expect(alex!.relationships[0]).toMatchObject({
      relationship: "works_at",
      target: { type: "org", name: "Stripe" },
      current: true,
    });
    expect(alex!.relationships[0].validUntil).toBeNull();
  });

  it("normalizes relationship and target-type casing", async () => {
    // persist lowercases the relationship type and the target's entity type.
    // (The entity's own type is lowercased upstream by synthesis sanitize.)
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "WORKS_AT", target: "Stripe", targetType: "Org", current: true }] },
    ]);

    const [edge] = await db.select().from(entityEdges).where(eq(entityEdges.relationship, "works_at"));
    expect(edge.relationship).toBe("works_at");

    const stripe = (await getEntitiesForUser(memoryUserId)).find((e) => e.name === "Stripe")!;
    expect(stripe.type).toBe("org");
  });
});

describe("entity graph — bi-temporal supersession", () => {
  it("supersedes a prior employer when a new current relationship arrives", async () => {
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Stripe", targetType: "org", current: true }] },
    ]);
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Anthropic", targetType: "org", current: true }] },
    ]);

    const entities = await getEntitiesForUser(memoryUserId);
    const alex = entities.find((e) => e.name === "Alex")!;

    const stripeEdge = alex.relationships.find((r) => r.target.name === "Stripe")!;
    const anthropicEdge = alex.relationships.find((r) => r.target.name === "Anthropic")!;

    // History preserved: Stripe closed, Anthropic active
    expect(stripeEdge.current).toBe(false);
    expect(stripeEdge.validUntil).not.toBeNull();
    expect(anthropicEdge.current).toBe(true);
    expect(anthropicEdge.validUntil).toBeNull();

    // Exactly one active works_at edge
    expect(await countActiveEdges("works_at")).toBe(1);
  });

  it("does not supersede relationships of a different type", async () => {
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [
        { type: "works_at", target: "Stripe", targetType: "org", current: true },
        { type: "uses", target: "Postgres", targetType: "tech", current: true },
      ] },
    ]);
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Anthropic", targetType: "org", current: true }] },
    ]);

    // works_at superseded to one active; uses untouched
    expect(await countActiveEdges("works_at")).toBe(1);
    expect(await countActiveEdges("uses")).toBe(1);
  });

  it("closes an active edge when current=false", async () => {
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Stripe", targetType: "org", current: true }] },
    ]);
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Stripe", targetType: "org", current: false }] },
    ]);

    expect(await countActiveEdges("works_at")).toBe(0);
    const entities = await getEntitiesForUser(memoryUserId);
    const stripeEdge = entities.find((e) => e.name === "Alex")!.relationships.find((r) => r.target.name === "Stripe")!;
    expect(stripeEdge.current).toBe(false);
  });
});

describe("entity graph — multi-valued relationships accumulate (BUG_AUDIT H1)", () => {
  it("keeps multiple current 'uses' edges from one extraction pass active", async () => {
    // Regression for H1: the old supersede logic closed active edges of the same
    // type to *other* targets on every insert, so processing the second 'uses'
    // closed the first. Multi-valued types must accumulate.
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [
        { type: "uses", target: "Postgres", targetType: "tech", current: true },
        { type: "uses", target: "React", targetType: "tech", current: true },
        { type: "knows", target: "Sam", targetType: "person", current: true },
        { type: "knows", target: "Jo", targetType: "person", current: true },
      ] },
    ]);

    expect(await countActiveEdges("uses")).toBe(2);
    expect(await countActiveEdges("knows")).toBe(2);

    const alex = (await getEntitiesForUser(memoryUserId)).find((e) => e.name === "Alex")!;
    const usesTargets = alex.relationships.filter((r) => r.relationship === "uses").map((r) => r.target.name).sort();
    expect(usesTargets).toEqual(["Postgres", "React"]);
    // None of them should carry a (zero-width) closed interval
    expect(alex.relationships.filter((r) => r.relationship === "uses").every((r) => r.validUntil === null)).toBe(true);
  });

  it("accumulates multi-valued edges across separate passes without superseding", async () => {
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "uses", target: "Postgres", targetType: "tech", current: true }] },
    ]);
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "uses", target: "Redis", targetType: "tech", current: true }] },
    ]);

    // Both remain active — a new tech a person uses does not end the old one.
    expect(await countActiveEdges("uses")).toBe(2);
  });

  it("still supersedes single-valued works_at across passes while multi-valued survives", async () => {
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [
        { type: "works_at", target: "Stripe", targetType: "org", current: true },
        { type: "uses", target: "Go", targetType: "tech", current: true },
      ] },
    ]);
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [
        { type: "works_at", target: "Anthropic", targetType: "org", current: true },
        { type: "uses", target: "Rust", targetType: "tech", current: true },
      ] },
    ]);

    expect(await countActiveEdges("works_at")).toBe(1); // superseded to the newest employer
    expect(await countActiveEdges("uses")).toBe(2);     // both technologies retained
  });
});

describe("entity graph — dedup & idempotency", () => {
  it("deduplicates repeated entities and targets within one call", async () => {
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Stripe", targetType: "org", current: true }] },
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Stripe", targetType: "org", current: true }] },
      { type: "org", name: "Stripe" },
    ]);

    const alexNodes = await db.select().from(entityNodes).where(and(eq(entityNodes.memoryUserId, memoryUserId), eq(entityNodes.name, "Alex")));
    const stripeNodes = await db.select().from(entityNodes).where(and(eq(entityNodes.memoryUserId, memoryUserId), eq(entityNodes.name, "Stripe")));
    expect(alexNodes).toHaveLength(1);
    expect(stripeNodes).toHaveLength(1);
    expect(await countActiveEdges("works_at")).toBe(1);
  });

  it("re-extracting the same relationship is idempotent (no duplicate active edge)", async () => {
    const input: ExtractedEntity[] = [
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Stripe", targetType: "org", current: true }] },
    ];
    await persistEntityGraph(developerId, memoryUserId, input);
    await persistEntityGraph(developerId, memoryUserId, input);
    await persistEntityGraph(developerId, memoryUserId, input);

    expect(await countActiveEdges("works_at")).toBe(1);
    const allEdges = await db.select().from(entityEdges).where(eq(entityEdges.relationship, "works_at"));
    expect(allEdges).toHaveLength(1); // not even a closed duplicate
  });
});

describe("entity graph — concurrency & atomicity", () => {
  it("never creates duplicate active edges under concurrent persistence (ON CONFLICT race-safety)", async () => {
    const input: ExtractedEntity[] = [
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Stripe", targetType: "org", current: true }] },
    ];
    // Seed the nodes first so both racing calls hit the edge-insert path concurrently.
    await persistEntityGraph(developerId, memoryUserId, [{ type: "person", name: "Alex" }, { type: "org", name: "Stripe" }]);

    // Two persistence passes in parallel. The partial unique index guarantees at
    // most one active edge regardless of interleaving; a transaction that loses
    // the race either no-ops (ON CONFLICT) or rolls back atomically.
    const results = await Promise.allSettled([
      persistEntityGraph(developerId, memoryUserId, input),
      persistEntityGraph(developerId, memoryUserId, input),
    ]);

    // At least one must succeed, and the invariant must hold no matter what.
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await countActiveEdges("works_at")).toBe(1);
  });

  it("a duplicate active edge can never be inserted directly (DB-level guarantee)", async () => {
    await persistEntityGraph(developerId, memoryUserId, [
      { type: "person", name: "Alex", relationships: [{ type: "works_at", target: "Stripe", targetType: "org", current: true }] },
    ]);
    const [alex] = await db.select().from(entityNodes).where(and(eq(entityNodes.memoryUserId, memoryUserId), eq(entityNodes.name, "Alex")));
    const [stripe] = await db.select().from(entityNodes).where(and(eq(entityNodes.memoryUserId, memoryUserId), eq(entityNodes.name, "Stripe")));

    // Bypassing persist's ON CONFLICT, a raw second active edge must be rejected
    // by entity_edges_active_unique.
    await expect(
      db.insert(entityEdges).values({ fromEntityId: alex.id, toEntityId: stripe.id, relationship: "works_at" })
    ).rejects.toThrow();
  });
});
