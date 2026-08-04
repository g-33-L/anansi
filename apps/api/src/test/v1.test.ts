import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../app.js";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, developerAccounts, developerApiKeys, memoryUsers, staticDocuments, entityNodes, entityEdges } from "../lib/db/schema.js";
import { cleanDatabase } from "./setup.js";
import { hashApiKey } from "../lib/auth/api-auth.js";

// ─── Mock heavy dependencies ──────────────────────────────────────────────────

vi.mock("../lib/ai/embed.js", () => ({
  embedBatch: vi.fn().mockImplementation((texts: string[]) =>
    Promise.resolve(texts.map(() => new Array(768).fill(0.1)))
  ),
  embedOne: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
  getEmbedStats: vi.fn().mockReturnValue({ calls: 0, chunks: 0, tokens: 0 }),
}));

vi.mock("../lib/ai/query-engine.js", () => ({
  queryUser: vi.fn().mockResolvedValue({ static: [], dynamic: [], relevant: [], temporal: [], entities: [] }),
  queryWorkspace: vi.fn().mockResolvedValue({ answer: "", sources: [], citedSf: [], citedDc: [] }),
}));

// Rate limiting, caching, and queue adds hit the real local Redis (docker
// compose), same as the other integration suites.

vi.mock("../lib/billing/usage.js", () => ({
  checkAndIncrementApiCall: vi.fn().mockResolvedValue({ allowed: true }),
  incrementQueryIfUnderLimit: vi.fn().mockResolvedValue({ allowed: true, current: 0, limit: 50, plan: "free" }),
  incrementMessages: vi.fn().mockResolvedValue(undefined),
  getUsageSummary: vi.fn().mockResolvedValue({ plan: "api", month: "2026-06", queries: { used: 0, limit: 0 }, messages: { used: 0, limit: 0 }, channels: { used: 0, limit: 0 } }),
}));

// ─── Test fixtures ────────────────────────────────────────────────────────────

// Must match ^ans_[A-Za-z0-9]{32,}$ to pass the format guard in validateApiKey
const RAW_KEY = "ans_" + "a".repeat(32);
let workspaceId: string;
let developerId: string;

beforeEach(async () => {
  await cleanDatabase();

  // API-only workspace (no Slack credentials)
  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  workspaceId = ws.id;

  const [dev] = await db.insert(developerAccounts).values({
    workspaceId,
    name: "Test Developer",
    email: "dev@test.com",
  }).returning({ id: developerAccounts.id });
  developerId = dev.id;

  // Set env required by api-auth (must be before hashApiKey call below)
  process.env.API_KEY_HMAC_SECRET = "test-hmac-secret-32-bytes-minimum-x";

  await db.insert(developerApiKeys).values({
    developerId,
    keyHash: hashApiKey(RAW_KEY),
    name: "Test key",
  });
});

afterAll(async () => {
  await closePool();
});

function apiRequest(path: string, init?: RequestInit) {
  const app = createApp();
  return app.fetch(new Request(`http://localhost${path}`, init));
}

function authHeaders(key = RAW_KEY) {
  return { Authorization: `Bearer ${key}` };
}

// ─── validateApiKey fast-reject (M2) ─────────────────────────────────────────

describe("validateApiKey format guard", () => {
  it("rejects a token that does not start with ans_", async () => {
    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "u1", content: "hello" }),
      headers: { "content-type": "application/json", Authorization: "Bearer sk-abc123" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token with ans_ prefix but fewer than 32 trailing chars", async () => {
    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "u1", content: "hello" }),
      headers: { "content-type": "application/json", Authorization: "Bearer ans_short" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects an empty Bearer token", async () => {
    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "u1", content: "hello" }),
      headers: { "content-type": "application/json", Authorization: "Bearer " },
    });
    expect(res.status).toBe(401);
  });

  it("passes format check for a valid-looking ans_ key (then 401 on bad hash)", async () => {
    // ans_ + exactly 32 hex chars — format is valid but not in DB (different from RAW_KEY)
    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "u1", content: "hello" }),
      headers: { "content-type": "application/json", Authorization: "Bearer ans_" + "b".repeat(32) },
    });
    expect(res.status).toBe(401);
  });
});

// ─── POST /v1/ingest ──────────────────────────────────────────────────────────

describe("POST /v1/ingest", () => {
  it("returns 401 with no auth", async () => {
    const res = await apiRequest("/v1/ingest", { method: "POST", body: JSON.stringify({ userId: "u1", content: "hello" }), headers: { "content-type": "application/json" } });
    expect(res.status).toBe(401);
  });

  it("returns 401 with bad key", async () => {
    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "u1", content: "hello" }),
      headers: { "content-type": "application/json", Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 when userId missing", async () => {
    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ content: "hello" }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/userId/);
  });

  it("returns 400 when content missing", async () => {
    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "u1" }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/content/);
  });

  it("returns 202 and upserts memoryUser on valid ingest", async () => {
    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "user_abc", content: "User prefers TypeScript." }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(res.status).toBe(202);
    const body = await res.json() as { id: string; queued: boolean };
    expect(body.queued).toBe(true);
    expect(typeof body.id).toBe("string");

    const memUser = await db.query.memoryUsers.findFirst({
      where: eq(memoryUsers.externalId, "user_abc"),
    });
    expect(memUser).toBeTruthy();
    expect(memUser?.developerId).toBe(developerId);
  });

  it("is idempotent — same userId ingested twice reuses memoryUser", async () => {
    const ingest = () => apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "user_idem", content: "Some content." }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    await ingest();
    await ingest();

    const rows = await db.select().from(memoryUsers).where(eq(memoryUsers.externalId, "user_idem"));
    expect(rows).toHaveLength(1);
  });

  it("returns 413 when content exceeds 100 KB", async () => {
    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "u1", content: "x".repeat(105_000) }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(res.status).toBe(413);
  });

  it("returns 402 when quota exceeded", async () => {
    const { checkAndIncrementApiCall } = await import("../lib/billing/usage.js");
    vi.mocked(checkAndIncrementApiCall).mockResolvedValueOnce({ allowed: false });

    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "u1", content: "hello" }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(res.status).toBe(402);
  });

  it("respects sourceType=meeting as meeting_transcript", async () => {
    const res = await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "u1", content: "Alice: hello. Bob: hi.", sourceType: "meeting" }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(res.status).toBe(202);
  });
});

// ─── POST /v1/ingest/batch ────────────────────────────────────────────────────

describe("POST /v1/ingest/batch", () => {
  it("charges the monthly ingest quota per item, not per request", async () => {
    // Regression for the batch-quota undercount: a 3-item batch must charge 3
    // ingest units, matching the rate-limit cost — not 1.
    const { checkAndIncrementApiCall } = await import("../lib/billing/usage.js");
    vi.mocked(checkAndIncrementApiCall).mockClear();

    const items = [
      { userId: "bu1", content: "Fact one." },
      { userId: "bu2", content: "Fact two." },
      { userId: "bu3", content: "Fact three." },
    ];
    const res = await apiRequest("/v1/ingest/batch", {
      method: "POST",
      body: JSON.stringify({ items }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(res.status).toBe(202);
    expect(checkAndIncrementApiCall).toHaveBeenCalledWith(workspaceId, "ingest", items.length);
  });

  it("returns 402 when the batch would exceed quota", async () => {
    const { checkAndIncrementApiCall } = await import("../lib/billing/usage.js");
    vi.mocked(checkAndIncrementApiCall).mockResolvedValueOnce({ allowed: false });

    const res = await apiRequest("/v1/ingest/batch", {
      method: "POST",
      body: JSON.stringify({ items: [{ userId: "bu1", content: "x" }, { userId: "bu2", content: "y" }] }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(res.status).toBe(402);
  });

  it("returns 400 when items is empty or over the 50-item cap", async () => {
    const empty = await apiRequest("/v1/ingest/batch", {
      method: "POST",
      body: JSON.stringify({ items: [] }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(empty.status).toBe(400);

    const tooMany = await apiRequest("/v1/ingest/batch", {
      method: "POST",
      body: JSON.stringify({ items: Array.from({ length: 51 }, (_, i) => ({ userId: `u${i}`, content: "x" })) }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(tooMany.status).toBe(400);
  });
});

// ─── GET /v1/context ─────────────────────────────────────────────────────────

describe("GET /v1/context", () => {
  it("returns 401 with no auth", async () => {
    const res = await apiRequest("/v1/context?userId=u1");
    expect(res.status).toBe(401);
  });

  it("returns 400 when userId missing", async () => {
    const res = await apiRequest("/v1/context", { headers: authHeaders() });
    expect(res.status).toBe(400);
  });

  it("returns 400 when userId exceeds 256 chars", async () => {
    const res = await apiRequest(`/v1/context?userId=${"x".repeat(257)}`, { headers: authHeaders() });
    expect(res.status).toBe(400);
  });

  it("returns empty context for unknown userId", async () => {
    const res = await apiRequest("/v1/context?userId=nobody", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json() as { static: unknown[]; dynamic: unknown[]; relevant: unknown[] };
    expect(body.static).toEqual([]);
    expect(body.dynamic).toEqual([]);
    expect(body.relevant).toEqual([]);
  });

  it("returns context for known userId", async () => {
    // Create memoryUser first via ingest
    await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "ctx_user", content: "Context test." }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });

    const { queryUser } = await import("../lib/ai/query-engine.js");
    vi.mocked(queryUser).mockResolvedValueOnce({
      static: ["User is a developer"],
      dynamic: ["Working on memory API"],
      temporal: [],
      relevant: [],
      entities: [],
    });

    const res = await apiRequest("/v1/context?userId=ctx_user&q=what+are+they+building", { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json() as { static: string[]; dynamic: string[] };
    expect(body.static).toEqual(["User is a developer"]);
    expect(body.dynamic).toEqual(["Working on memory API"]);
  });

  it("returns 402 when quota exceeded", async () => {
    const { checkAndIncrementApiCall } = await import("../lib/billing/usage.js");
    vi.mocked(checkAndIncrementApiCall).mockResolvedValueOnce({ allowed: false });
    const res = await apiRequest("/v1/context?userId=u1", { headers: authHeaders() });
    expect(res.status).toBe(402);
  });

});

// ─── DELETE /v1/memory ────────────────────────────────────────────────────────

describe("DELETE /v1/memory", () => {
  it("returns 401 with no auth", async () => {
    const res = await apiRequest("/v1/memory?userId=u1", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when userId missing", async () => {
    const res = await apiRequest("/v1/memory", { method: "DELETE", headers: authHeaders() });
    expect(res.status).toBe(400);
  });

  it("returns { deleted: 0 } for unknown userId", async () => {
    const res = await apiRequest("/v1/memory?userId=nobody", { method: "DELETE", headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: number };
    expect(body.deleted).toBe(0);
  });

  it("deletes all chunks for a userId after ingest", async () => {
    // First ingest so there is something to delete
    await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "del_user", content: "Some content to delete." }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });

    const res = await apiRequest("/v1/memory?userId=del_user", { method: "DELETE", headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: number };
    // embedBatch is mocked — embedAndInsert inserts exactly 1 chunk for this short content
    expect(body.deleted).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — second delete returns { deleted: 0 }", async () => {
    await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "del_idem", content: "Content." }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });

    await apiRequest("/v1/memory?userId=del_idem", { method: "DELETE", headers: authHeaders() });
    const res = await apiRequest("/v1/memory?userId=del_idem", { method: "DELETE", headers: authHeaders() });
    const body = await res.json() as { deleted: number };
    expect(body.deleted).toBe(0);
  });

  it("full wipe also removes the entity graph and synthesized profile", async () => {
    await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "del_graph", content: "Alex works at Stripe." }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    const memUser = await db.query.memoryUsers.findFirst({
      where: eq(memoryUsers.externalId, "del_graph"),
    });
    expect(memUser).toBeTruthy();

    // Seed a synthesized profile + entity graph as the synthesis worker would
    await db.insert(staticDocuments).values({
      memoryUserId: memUser!.id,
      staticFacts: ["Works at Stripe"],
      dynamicContext: [],
    });
    const [alex] = await db.insert(entityNodes).values({
      developerId, memoryUserId: memUser!.id, entityType: "person", name: "Alex",
    }).returning({ id: entityNodes.id });
    const [stripe] = await db.insert(entityNodes).values({
      developerId, memoryUserId: memUser!.id, entityType: "org", name: "Stripe",
    }).returning({ id: entityNodes.id });
    await db.insert(entityEdges).values({
      fromEntityId: alex.id, toEntityId: stripe.id, relationship: "works_at",
    });

    const res = await apiRequest("/v1/memory?userId=del_graph", { method: "DELETE", headers: authHeaders() });
    expect(res.status).toBe(200);

    const nodes = await db.select().from(entityNodes).where(eq(entityNodes.memoryUserId, memUser!.id));
    expect(nodes).toHaveLength(0);
    const edges = await db.select().from(entityEdges).where(eq(entityEdges.fromEntityId, alex.id));
    expect(edges).toHaveLength(0);
    const doc = await db.query.staticDocuments.findFirst({
      where: eq(staticDocuments.memoryUserId, memUser!.id),
    });
    expect(doc).toBeUndefined();
  });
});

// ─── DELETE /v1/user (GDPR hard-delete, H6) ───────────────────────────────────

describe("DELETE /v1/user", () => {
  it("returns 401 with no auth", async () => {
    const res = await apiRequest("/v1/user?userId=u1", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when userId missing", async () => {
    const res = await apiRequest("/v1/user", { method: "DELETE", headers: authHeaders() });
    expect(res.status).toBe(400);
  });

  it("returns { deleted: true } for unknown userId (idempotent)", async () => {
    const res = await apiRequest("/v1/user?userId=nobody", { method: "DELETE", headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it("hard-deletes memoryUser row and all child data after ingest", async () => {
    // Ingest so memoryUser exists
    await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "gdpr_user", content: "Delete me." }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });

    let memUser = await db.query.memoryUsers.findFirst({
      where: eq(memoryUsers.externalId, "gdpr_user"),
    });
    expect(memUser).toBeTruthy();

    const res = await apiRequest("/v1/user?userId=gdpr_user", { method: "DELETE", headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: boolean };
    expect(body.deleted).toBe(true);

    // The memoryUsers row itself must be gone
    memUser = await db.query.memoryUsers.findFirst({
      where: eq(memoryUsers.externalId, "gdpr_user"),
    });
    expect(memUser).toBeUndefined();
  });

  it("accepts userId in JSON body", async () => {
    await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "gdpr_body_user", content: "Body delete test." }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });

    const res = await apiRequest("/v1/user", {
      method: "DELETE",
      body: JSON.stringify({ userId: "gdpr_body_user" }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    expect(res.status).toBe(200);

    const memUser = await db.query.memoryUsers.findFirst({
      where: eq(memoryUsers.externalId, "gdpr_body_user"),
    });
    expect(memUser).toBeUndefined();
  });

  it("is idempotent — second delete returns { deleted: true }", async () => {
    await apiRequest("/v1/ingest", {
      method: "POST",
      body: JSON.stringify({ userId: "gdpr_idem", content: "Idempotent." }),
      headers: { "content-type": "application/json", ...authHeaders() },
    });
    await apiRequest("/v1/user?userId=gdpr_idem", { method: "DELETE", headers: authHeaders() });
    const res = await apiRequest("/v1/user?userId=gdpr_idem", { method: "DELETE", headers: authHeaders() });
    const body = await res.json() as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });
});
