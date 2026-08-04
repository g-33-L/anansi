import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db, closePool } from "../lib/db/index.js";
import {
  developerAccounts,
  memoryChunks,
  memoryUsers,
  staticDocuments,
  synthesisJobs,
  workspaces,
} from "../lib/db/schema.js";
import { cleanDatabase } from "./setup.js";
import { chatSynthesis } from "../lib/ai/llm.js";
import { synthesize, synthesizeUser } from "../workers/synthesis.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../lib/ai/llm.js", () => ({ chatSynthesis: vi.fn() }));
vi.mock("../lib/infra/cache.js", () => ({ invalidateUserCache: vi.fn() }));
vi.mock("../lib/infra/outbound-webhook.js", () => ({ fireWebhook: vi.fn() }));
// persistEntityGraph is tested in entity-graph.test.ts; isolate it here so
// synthesis test failures aren't masked by entity-graph errors.
vi.mock("../lib/ai/entity-graph.js", () => ({ persistEntityGraph: vi.fn() }));
// Avoid opening a real Redis connection when importing the worker module.
vi.mock("../lib/infra/queue.js", () => ({ redis: {}, synthesisQueue: { add: vi.fn() } }));

// ─── LLM response fixtures ────────────────────────────────────────────────────

const TEAM_RESPONSE = JSON.stringify({
  static_facts: ["Engineering team uses TypeScript"],
  dynamic_context: ["Sprint 3 in progress"],
});

const USER_RESPONSE = JSON.stringify({
  static_facts: ["Senior backend engineer"],
  dynamic_context: ["Working on payments service"],
  temporal_facts: [{ fact: "Works at Stripe", validFrom: "2024-01", validUntil: null }],
  entities: [{ type: "org", name: "Stripe", relationships: [{ type: "works_at", target: "User", targetType: "person", current: true }] }],
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let workspaceId: string;
let developerId: string;
let memoryUserId: string;

beforeEach(async () => {
  await cleanDatabase();
  vi.clearAllMocks();
  vi.mocked(chatSynthesis).mockResolvedValue(TEAM_RESPONSE);

  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  workspaceId = ws.id;
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId, name: "Test Dev", email: "synth@test.com" })
    .returning({ id: developerAccounts.id });
  developerId = dev.id;
  const [user] = await db
    .insert(memoryUsers)
    .values({ developerId, externalId: "synth_user" })
    .returning({ id: memoryUsers.id });
  memoryUserId = user.id;
});

afterAll(closePool);

function chunkValues(opts?: {
  memoryUserId?: string | null;
  synthesized?: boolean;
  userSynthesized?: boolean;
  expiresAt?: Date;
}) {
  return {
    workspaceId,
    sourceType: "message" as const,
    sourceId: `msg:C1:${Date.now()}:${Math.random()}`,
    content: "roadmap discussion for next quarter",
    metadata: { author: "Alice", authorId: "U1", timestamp: "1.0", channelName: "general" },
    ...opts,
  };
}

// ─── Team synthesis ───────────────────────────────────────────────────────────

describe("synthesize (team)", () => {
  it("creates a workspace staticDoc and marks chunks synthesized", async () => {
    await db.insert(memoryChunks).values([chunkValues(), chunkValues()]);

    await synthesize(workspaceId);

    const docs = await db
      .select()
      .from(staticDocuments)
      .where(and(eq(staticDocuments.workspaceId, workspaceId), isNull(staticDocuments.memoryUserId)));
    expect(docs).toHaveLength(1);
    expect(docs[0].staticFacts).toEqual(["Engineering team uses TypeScript"]);
    expect(docs[0].dynamicContext).toEqual(["Sprint 3 in progress"]);
    expect(docs[0].chunksSynthesizedCount).toBe(2);
    expect(docs[0].version).toBe(1);

    const remaining = await db
      .select()
      .from(memoryChunks)
      .where(and(eq(memoryChunks.workspaceId, workspaceId), eq(memoryChunks.synthesized, false)));
    expect(remaining).toHaveLength(0);
  });

  it("includes Slack chunks attributed to a memory user — no team-profile exclusion", async () => {
    // Slack messages carry memoryUserId but must still feed the workspace (team) profile.
    await db.insert(memoryChunks).values([
      chunkValues({ memoryUserId }),       // Slack chunk with author
      chunkValues({ memoryUserId: null }), // plain workspace chunk
    ]);

    await synthesize(workspaceId);

    const doc = await db.query.staticDocuments.findFirst({
      where: and(eq(staticDocuments.workspaceId, workspaceId), isNull(staticDocuments.memoryUserId)),
    });
    expect(doc?.chunksSynthesizedCount).toBe(2);
  });

  it("skips expired chunks and leaves them unsynthesized", async () => {
    const past = new Date(Date.now() - 5_000);
    await db.insert(memoryChunks).values([
      chunkValues({ expiresAt: past }), // expired
      chunkValues(),                    // live
    ]);

    await synthesize(workspaceId);

    const doc = await db.query.staticDocuments.findFirst({
      where: and(eq(staticDocuments.workspaceId, workspaceId), isNull(staticDocuments.memoryUserId)),
    });
    // Only the live chunk fed the profile
    expect(doc?.chunksSynthesizedCount).toBe(1);

    // The expired chunk is still in DB, still unsynthesized
    const unsynthesized = await db
      .select()
      .from(memoryChunks)
      .where(and(eq(memoryChunks.workspaceId, workspaceId), eq(memoryChunks.synthesized, false)));
    expect(unsynthesized).toHaveLength(1);
    expect(unsynthesized[0].expiresAt!.getTime()).toBeLessThan(Date.now());
  });

  it("increments version and accumulates chunksSynthesizedCount on subsequent runs", async () => {
    await db.insert(memoryChunks).values(chunkValues());
    await synthesize(workspaceId);

    await db.insert(memoryChunks).values(chunkValues());
    vi.mocked(chatSynthesis).mockResolvedValueOnce(
      JSON.stringify({ static_facts: ["updated fact"], dynamic_context: ["new ctx"] })
    );
    await synthesize(workspaceId);

    const doc = await db.query.staticDocuments.findFirst({
      where: and(eq(staticDocuments.workspaceId, workspaceId), isNull(staticDocuments.memoryUserId)),
    });
    expect(doc?.version).toBe(2);
    expect(doc?.chunksSynthesizedCount).toBe(2);
    expect(doc?.staticFacts).toEqual(["updated fact"]);
  });

  it("records a complete synthesisJob row", async () => {
    await db.insert(memoryChunks).values(chunkValues());

    await synthesize(workspaceId);

    const jobs = await db.select().from(synthesisJobs).where(eq(synthesisJobs.workspaceId, workspaceId));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("complete");
    expect(jobs[0].chunksProcessed).toBe(1);
  });

  it("marks job failed and rethrows when the LLM returns unparseable output", async () => {
    vi.mocked(chatSynthesis).mockResolvedValue("not json at all");
    await db.insert(memoryChunks).values(chunkValues());

    await expect(synthesize(workspaceId)).rejects.toThrow("LLM returned invalid JSON");

    const jobs = await db.select().from(synthesisJobs).where(eq(synthesisJobs.workspaceId, workspaceId));
    expect(jobs[0].status).toBe("failed");
  });

  it("records zero chunksProcessed and complete status when there is nothing to synthesize", async () => {
    await synthesize(workspaceId);

    const jobs = await db.select().from(synthesisJobs).where(eq(synthesisJobs.workspaceId, workspaceId));
    expect(jobs[0].status).toBe("complete");
    expect(jobs[0].chunksProcessed).toBe(0);
    // No staticDoc created when there were no chunks
    const docs = await db.select().from(staticDocuments).where(eq(staticDocuments.workspaceId, workspaceId));
    expect(docs).toHaveLength(0);
  });
});

// ─── Per-user synthesis ───────────────────────────────────────────────────────

describe("synthesizeUser (personal)", () => {
  it("creates a personal staticDoc scoped to the memoryUser", async () => {
    vi.mocked(chatSynthesis).mockResolvedValue(USER_RESPONSE);
    await db.insert(memoryChunks).values(chunkValues({ memoryUserId, userSynthesized: false }));

    await synthesizeUser(memoryUserId, workspaceId);

    const doc = await db.query.staticDocuments.findFirst({
      where: eq(staticDocuments.memoryUserId, memoryUserId),
    });
    expect(doc).toBeDefined();
    expect(doc!.staticFacts).toEqual(["Senior backend engineer"]);
    expect(doc!.temporalFacts).toHaveLength(1);
    expect((doc!.temporalFacts as Array<{ fact: string }>)[0].fact).toBe("Works at Stripe");
  });

  it("tracks userSynthesized independently of the team synthesized flag", async () => {
    vi.mocked(chatSynthesis).mockResolvedValue(USER_RESPONSE);
    // Team pass already ran (synthesized=true) but personal pass hasn't (userSynthesized=false).
    await db.insert(memoryChunks).values(
      chunkValues({ memoryUserId, synthesized: true, userSynthesized: false })
    );

    await synthesizeUser(memoryUserId, workspaceId);

    const [c] = await db
      .select()
      .from(memoryChunks)
      .where(eq(memoryChunks.memoryUserId, memoryUserId));
    expect(c.userSynthesized).toBe(true);
    expect(c.synthesized).toBe(true); // team flag untouched
  });

  it("opt-out: detaches chunks, marks userSynthesized, builds no profile, skips LLM", async () => {
    await db.update(memoryUsers).set({ optedOut: true }).where(eq(memoryUsers.id, memoryUserId));
    await db.insert(memoryChunks).values(chunkValues({ memoryUserId, userSynthesized: false }));

    await synthesizeUser(memoryUserId, workspaceId);

    // No personal profile created
    const doc = await db.query.staticDocuments.findFirst({
      where: eq(staticDocuments.memoryUserId, memoryUserId),
    });
    expect(doc).toBeUndefined();

    // Chunk stays in workspace (team) memory but detached from the user
    const [c] = await db.select().from(memoryChunks).where(eq(memoryChunks.workspaceId, workspaceId));
    expect(c.memoryUserId).toBeNull();
    expect(c.userSynthesized).toBe(true); // won't be re-processed

    // LLM was never called
    expect(vi.mocked(chatSynthesis)).not.toHaveBeenCalled();

    // Job still recorded as complete (not failed)
    const jobs = await db.select().from(synthesisJobs).where(eq(synthesisJobs.workspaceId, workspaceId));
    expect(jobs[0].status).toBe("complete");
    expect(jobs[0].chunksProcessed).toBe(0);
  });

  it("preserves existing temporalFacts when LLM response omits them (older model format)", async () => {
    const existingFacts = [{ fact: "Worked at Google", validFrom: "2020-01", validUntil: "2022-06" }];
    await db.insert(staticDocuments).values({
      memoryUserId,
      staticFacts: ["old fact"],
      dynamicContext: [],
      temporalFacts: existingFacts,
      version: 1,
      chunksSynthesizedCount: 5,
      lastSynthesizedAt: new Date(),
    });

    // Older model returns only static_facts/dynamic_context — no temporal_facts key
    vi.mocked(chatSynthesis).mockResolvedValue(
      JSON.stringify({ static_facts: ["new fact"], dynamic_context: ["new ctx"] })
    );
    await db.insert(memoryChunks).values(chunkValues({ memoryUserId, userSynthesized: false }));

    await synthesizeUser(memoryUserId, workspaceId);

    const doc = await db.query.staticDocuments.findFirst({
      where: eq(staticDocuments.memoryUserId, memoryUserId),
    });
    expect(doc!.temporalFacts).toEqual(existingFacts); // preserved from prior run
    expect(doc!.staticFacts).toEqual(["new fact"]);    // updated
    expect(doc!.version).toBe(2);
  });

  it("does NOT wipe temporalFacts when the LLM returns an empty temporal_facts array (BUG_AUDIT H2)", async () => {
    const existingFacts = [{ fact: "Worked at Google", validFrom: "2020-01", validUntil: "2022-06" }];
    await db.insert(staticDocuments).values({
      memoryUserId,
      staticFacts: ["old fact"],
      dynamicContext: [],
      temporalFacts: existingFacts,
      version: 1,
      chunksSynthesizedCount: 5,
      lastSynthesizedAt: new Date(),
    });

    // Regression: an empty (but present) temporal_facts array must be treated as
    // "nothing new", NOT as "delete all history".
    vi.mocked(chatSynthesis).mockResolvedValue(
      JSON.stringify({ static_facts: ["new fact"], dynamic_context: [], temporal_facts: [] })
    );
    await db.insert(memoryChunks).values(chunkValues({ memoryUserId, userSynthesized: false }));

    await synthesizeUser(memoryUserId, workspaceId);

    const doc = await db.query.staticDocuments.findFirst({
      where: eq(staticDocuments.memoryUserId, memoryUserId),
    });
    expect(doc!.temporalFacts).toEqual(existingFacts); // NOT wiped
  });

  it("merges incoming temporal facts with existing ones — appends new, closes re-emitted (BUG_AUDIT H2)", async () => {
    const existingFacts = [
      { fact: "Worked at Google", validFrom: "2020-01", validUntil: "2022-06" },
      { fact: "Lives in Berlin", validFrom: "2019-01", validUntil: null },
    ];
    await db.insert(staticDocuments).values({
      memoryUserId,
      staticFacts: [],
      dynamicContext: [],
      temporalFacts: existingFacts,
      version: 1,
      chunksSynthesizedCount: 5,
      lastSynthesizedAt: new Date(),
    });

    // LLM appends a new fact and closes an existing one by re-emitting it with a validUntil.
    vi.mocked(chatSynthesis).mockResolvedValue(
      JSON.stringify({
        static_facts: [],
        dynamic_context: [],
        temporal_facts: [
          { fact: "Lives in Berlin", validFrom: "2019-01", validUntil: "2025-03" }, // now closed
          { fact: "Works at Stripe", validFrom: "2022-07", validUntil: null },       // new
        ],
      })
    );
    await db.insert(memoryChunks).values(chunkValues({ memoryUserId, userSynthesized: false }));

    await synthesizeUser(memoryUserId, workspaceId);

    const doc = await db.query.staticDocuments.findFirst({
      where: eq(staticDocuments.memoryUserId, memoryUserId),
    });
    const facts = doc!.temporalFacts as Array<{ fact: string; validUntil: string | null }>;
    const byFact = new Map(facts.map((f) => [f.fact, f]));
    // Untouched historical fact preserved
    expect(byFact.get("Worked at Google")?.validUntil).toBe("2022-06");
    // Re-emitted fact updated (closed)
    expect(byFact.get("Lives in Berlin")?.validUntil).toBe("2025-03");
    // New fact appended
    expect(byFact.get("Works at Stripe")?.validUntil).toBeNull();
    expect(facts).toHaveLength(3);
  });

  it("records a complete synthesisJob for the user run", async () => {
    vi.mocked(chatSynthesis).mockResolvedValue(USER_RESPONSE);
    await db.insert(memoryChunks).values(chunkValues({ memoryUserId, userSynthesized: false }));

    await synthesizeUser(memoryUserId, workspaceId);

    const jobs = await db.select().from(synthesisJobs).where(eq(synthesisJobs.workspaceId, workspaceId));
    expect(jobs[0].status).toBe("complete");
    expect(jobs[0].chunksProcessed).toBe(1);
  });

  it("only consumes chunks not yet user-synthesized, even if team-synthesized chunks exist", async () => {
    vi.mocked(chatSynthesis).mockResolvedValue(USER_RESPONSE);
    // Two chunks: one already user-synthesized, one pending
    await db.insert(memoryChunks).values([
      chunkValues({ memoryUserId, userSynthesized: true }),  // already done
      chunkValues({ memoryUserId, userSynthesized: false }), // pending
    ]);

    await synthesizeUser(memoryUserId, workspaceId);

    const jobs = await db.select().from(synthesisJobs).where(eq(synthesisJobs.workspaceId, workspaceId));
    expect(jobs[0].chunksProcessed).toBe(1); // only the pending one
  });
});
