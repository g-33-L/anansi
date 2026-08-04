import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closePool } from "../lib/db/index.js";
import {
  workspaces,
  developerAccounts,
  memoryUsers,
  entityNodes,
  entityEdges,
  staticDocuments,
} from "../lib/db/schema.js";
import { cleanDatabase } from "./setup.js";
import { getEntitiesForUser, queryUser } from "../lib/ai/query-engine.js";

// ─── Temporal / bi-temporal query eval harness ────────────────────────────────
// Fixed timeline → expected "as of" snapshot. This is the headline differentiator
// ("memory that knows what was true when"), so its correctness is pinned by a
// deterministic eval: we seed a known history (employer changes, residence
// changes with explicit valid-time bounds) and assert the snapshot returned for
// various asOf instants — including the exact switch boundaries.
//
// Timeline:
//   Alex works_at Google   [2022-01-01 .. 2024-01-01)
//   Alex works_at Stripe   [2024-01-01 .. open)
//   fact "Lived in NYC"    [2020-01 .. 2023-01)
//   fact "Lives in SF"     [2023-01 .. open)

let workspaceId: string;
let memoryUserId: string;

const GOOGLE_FROM = new Date("2022-01-01T00:00:00Z");
const SWITCH = new Date("2024-01-01T00:00:00Z"); // Google→Stripe boundary

beforeEach(async () => {
  await cleanDatabase();
  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  workspaceId = ws.id;
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId, name: "Test Dev", email: "temporal@test.com" })
    .returning({ id: developerAccounts.id });
  const [user] = await db
    .insert(memoryUsers)
    .values({ developerId: dev.id, externalId: "temporal_user" })
    .returning({ id: memoryUsers.id });
  memoryUserId = user.id;

  const [alex] = await db.insert(entityNodes).values({ developerId: dev.id, memoryUserId, entityType: "person", name: "Alex" }).returning({ id: entityNodes.id });
  const [google] = await db.insert(entityNodes).values({ developerId: dev.id, memoryUserId, entityType: "org", name: "Google" }).returning({ id: entityNodes.id });
  const [stripe] = await db.insert(entityNodes).values({ developerId: dev.id, memoryUserId, entityType: "org", name: "Stripe" }).returning({ id: entityNodes.id });

  await db.insert(entityEdges).values([
    { fromEntityId: alex.id, toEntityId: google.id, relationship: "works_at", validFrom: GOOGLE_FROM, validUntil: SWITCH },
    { fromEntityId: alex.id, toEntityId: stripe.id, relationship: "works_at", validFrom: SWITCH, validUntil: null },
  ]);

  await db.insert(staticDocuments).values({
    memoryUserId,
    staticFacts: [],
    dynamicContext: [],
    temporalFacts: [
      { fact: "Lived in NYC", validFrom: "2020-01", validUntil: "2023-01" },
      { fact: "Lives in SF", validFrom: "2023-01", validUntil: null },
    ],
  });
});

afterAll(closePool);

function employerAt(entities: Awaited<ReturnType<typeof getEntitiesForUser>>): string[] {
  const alex = entities.find((e) => e.name === "Alex");
  return (alex?.relationships ?? [])
    .filter((r) => r.relationship === "works_at")
    .map((r) => r.target.name);
}

describe("entity graph — point-in-time (valid-time) queries", () => {
  it("full history (no asOf): both employers, only the latest is current", async () => {
    const entities = await getEntitiesForUser(memoryUserId);
    const alex = entities.find((e) => e.name === "Alex")!;
    const google = alex.relationships.find((r) => r.target.name === "Google")!;
    const stripe = alex.relationships.find((r) => r.target.name === "Stripe")!;

    expect(employerAt(entities).sort()).toEqual(["Google", "Stripe"]);
    expect(google.current).toBe(false);
    expect(stripe.current).toBe(true);
  });

  it("asOf mid-Google: snapshot shows Google only, current as of then", async () => {
    const entities = await getEntitiesForUser(memoryUserId, { asOf: new Date("2023-06-01T00:00:00Z") });
    expect(employerAt(entities)).toEqual(["Google"]);
    const google = entities.find((e) => e.name === "Alex")!.relationships[0];
    expect(google.current).toBe(true);
  });

  it("asOf mid-Stripe: snapshot shows Stripe only", async () => {
    const entities = await getEntitiesForUser(memoryUserId, { asOf: new Date("2024-06-01T00:00:00Z") });
    expect(employerAt(entities)).toEqual(["Stripe"]);
  });

  it("asOf exactly at the switch boundary: half-open [from, until) → Stripe only", async () => {
    const entities = await getEntitiesForUser(memoryUserId, { asOf: SWITCH });
    // Google ends at SWITCH (valid_until > asOf is false), Stripe starts at SWITCH (valid_from <= asOf)
    expect(employerAt(entities)).toEqual(["Stripe"]);
  });

  it("asOf before any employment: no relationships, node still present", async () => {
    const entities = await getEntitiesForUser(memoryUserId, { asOf: new Date("2019-01-01T00:00:00Z") });
    const alex = entities.find((e) => e.name === "Alex");
    expect(alex).toBeDefined();
    expect(employerAt(entities)).toEqual([]);
  });
});

describe("temporal facts — point-in-time filtering via queryUser", () => {
  it("no asOf: returns all facts, current reflects now", async () => {
    const ctx = await queryUser(workspaceId, memoryUserId);
    const nyc = ctx.temporal.find((f) => f.fact === "Lived in NYC")!;
    const sf = ctx.temporal.find((f) => f.fact === "Lives in SF")!;
    expect(nyc.current).toBe(false); // ended 2023-01
    expect(sf.current).toBe(true); // open-ended
  });

  it("asOf 2021: only the NYC fact, marked current", async () => {
    const ctx = await queryUser(workspaceId, memoryUserId, undefined, { asOf: new Date("2021-06-01T00:00:00Z") });
    expect(ctx.temporal.map((f) => f.fact)).toEqual(["Lived in NYC"]);
    expect(ctx.temporal[0].current).toBe(true);
  });

  it("asOf 2024: only the SF fact", async () => {
    const ctx = await queryUser(workspaceId, memoryUserId, undefined, { asOf: new Date("2024-06-01T00:00:00Z") });
    expect(ctx.temporal.map((f) => f.fact)).toEqual(["Lives in SF"]);
  });

  it("asOf at the residence boundary (2023-01): half-open → SF only", async () => {
    const ctx = await queryUser(workspaceId, memoryUserId, undefined, { asOf: new Date("2023-01-01T00:00:00Z") });
    expect(ctx.temporal.map((f) => f.fact)).toEqual(["Lives in SF"]);
  });

  it("entities and temporal facts agree at the same asOf", async () => {
    const at = new Date("2023-06-01T00:00:00Z");
    const ctx = await queryUser(workspaceId, memoryUserId, undefined, { asOf: at });
    expect(employerAt(ctx.entities)).toEqual(["Google"]);
    expect(ctx.temporal.map((f) => f.fact)).toEqual(["Lives in SF"]); // SF since 2023-01
  });
});

// ─── Bi-temporal: the knowledge-time (transaction-time) axis ──────────────────
// Same valid-time timeline as above, but now we also model WHEN we learned each
// fact. The Google→Stripe switch happened (valid-time) at 2024-01, but suppose we
// only RECORDED it later. asOfKnowledge reconstructs what we believed at a past
// instant — which can differ from what was actually true.

describe("entity graph — knowledge-time (bi-temporal) queries", () => {
  // We learned of the Stripe move, and of Google ending, at this instant:
  const LEARNED_SWITCH = new Date("2024-03-01T00:00:00Z"); // 2 months after it happened

  beforeEach(async () => {
    // Reset the two works_at edges to carry explicit transaction-time stamps.
    const nodes = await db.select().from(entityNodes).where(eq(entityNodes.memoryUserId, memoryUserId));
    const alex = nodes.find((n) => n.name === "Alex")!;
    const google = nodes.find((n) => n.name === "Google")!;
    const stripe = nodes.find((n) => n.name === "Stripe")!;
    await db.delete(entityEdges).where(eq(entityEdges.fromEntityId, alex.id));
    await db.insert(entityEdges).values([
      // Google: valid 2022-01..2024-01, recorded at start, end learned at 2024-03
      { fromEntityId: alex.id, toEntityId: google.id, relationship: "works_at",
        validFrom: GOOGLE_FROM, validUntil: SWITCH, recordedAt: GOOGLE_FROM, validUntilRecordedAt: LEARNED_SWITCH },
      // Stripe: valid from 2024-01, but only recorded (learned) at 2024-03
      { fromEntityId: alex.id, toEntityId: stripe.id, relationship: "works_at",
        validFrom: SWITCH, validUntil: null, recordedAt: LEARNED_SWITCH, validUntilRecordedAt: null },
    ]);
  });

  it("before we learned of the move: we still believed Alex was at Google", async () => {
    // Knowledge-time mid-2023-... actually Feb 2024: switch happened (valid) but not yet recorded
    const entities = await getEntitiesForUser(memoryUserId, { asOfKnowledge: new Date("2024-02-01T00:00:00Z") });
    expect(employerAt(entities)).toEqual(["Google"]);
    const google = entities.find((e) => e.name === "Alex")!.relationships[0];
    // We hadn't recorded the end yet → it reads as still open / current
    expect(google.current).toBe(true);
    expect(google.validUntil).toBeNull();
  });

  it("after we learned of the move: current state (Google closed, Stripe active)", async () => {
    const entities = await getEntitiesForUser(memoryUserId, { asOfKnowledge: new Date("2024-06-01T00:00:00Z") });
    expect(employerAt(entities).sort()).toEqual(["Google", "Stripe"]);
    const rels = entities.find((e) => e.name === "Alex")!.relationships;
    expect(rels.find((r) => r.target.name === "Google")!.current).toBe(false);
    expect(rels.find((r) => r.target.name === "Stripe")!.current).toBe(true);
  });

  it("knowledge-time excludes edges not yet recorded", async () => {
    // As of 2024-02 we hadn't recorded Stripe at all
    const entities = await getEntitiesForUser(memoryUserId, { asOfKnowledge: new Date("2024-02-01T00:00:00Z") });
    expect(employerAt(entities)).not.toContain("Stripe");
  });

  it("bi-temporal divergence: as of what we knew in Feb 2024, Alex worked at Google even at 2024-06 valid-time", async () => {
    // Belief at 2024-02 had Google open-ended, so a future valid-time still resolves to Google.
    const entities = await getEntitiesForUser(memoryUserId, {
      asOfKnowledge: new Date("2024-02-01T00:00:00Z"),
      asOf: new Date("2024-06-01T00:00:00Z"),
    });
    expect(employerAt(entities)).toEqual(["Google"]);
  });

  it("full knowledge (no asOfKnowledge) sees the recorded end", async () => {
    const entities = await getEntitiesForUser(memoryUserId);
    const rels = entities.find((e) => e.name === "Alex")!.relationships;
    expect(rels.find((r) => r.target.name === "Google")!.current).toBe(false);
    expect(rels.find((r) => r.target.name === "Stripe")!.current).toBe(true);
  });
});
