/*
 * API key scope enforcement.
 *
 * The console has always offered to narrow a key to a subset of
 * ["ingest","read","admin","entities","ledger"] and wrote the choice to
 * api_key_scopes — but validateApiKey never selected those rows, so the
 * restriction was cosmetic and every "scoped" key carried full access. These
 * tests exist so that cannot silently regress: a scope that is displayed must
 * be a scope that is enforced.
 *
 * The back-compat rule is equally load-bearing and equally tested: a key with
 * no scope rows is unrestricted. Every key minted before scoping existed has an
 * empty set, and breaking that would lock out every current caller.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createApp } from "../app.js";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, developerAccounts, developerApiKeys, apiKeyScopes } from "../lib/db/schema.js";
import { cleanDatabase } from "./setup.js";
import { hashApiKey, hasScope, type DeveloperContext } from "../lib/auth/api-auth.js";

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

vi.mock("../lib/billing/usage.js", () => ({
  checkAndIncrementApiCall: vi.fn().mockResolvedValue({ allowed: true }),
  incrementQueryIfUnderLimit: vi.fn().mockResolvedValue({ allowed: true, current: 0, limit: 50, plan: "free" }),
  incrementMessages: vi.fn().mockResolvedValue(undefined),
  getUsageSummary: vi.fn().mockResolvedValue({ plan: "api", month: "2026-06", queries: { used: 0, limit: 0 }, messages: { used: 0, limit: 0 }, channels: { used: 0, limit: 0 } }),
}));

// Distinct 32+ char suffixes so each key hashes differently.
const UNSCOPED_KEY = "ans_" + "a".repeat(32);
const READ_KEY = "ans_" + "b".repeat(32);
const INGEST_KEY = "ans_" + "c".repeat(32);

async function mintKey(developerId: string, rawKey: string, scopes: string[]) {
  const [key] = await db
    .insert(developerApiKeys)
    .values({ developerId, keyHash: hashApiKey(rawKey), name: `key ${scopes.join(",") || "unscoped"}` })
    .returning({ id: developerApiKeys.id });
  if (scopes.length) {
    await db.insert(apiKeyScopes).values(scopes.map((scope) => ({ apiKeyId: key.id, scope })));
  }
}

beforeEach(async () => {
  await cleanDatabase();
  process.env.API_KEY_HMAC_SECRET = "test-hmac-secret-32-bytes-minimum-x";

  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId: ws.id, name: "Scope Dev", email: "scopes@test.com" })
    .returning({ id: developerAccounts.id });

  await mintKey(dev.id, UNSCOPED_KEY, []);
  await mintKey(dev.id, READ_KEY, ["read"]);
  await mintKey(dev.id, INGEST_KEY, ["ingest"]);
});

afterAll(async () => {
  await closePool();
});

function req(path: string, key: string, init: RequestInit = {}) {
  return createApp().fetch(
    new Request(`http://localhost${path}`, {
      ...init,
      headers: { "content-type": "application/json", Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
    })
  );
}

const ingestBody = JSON.stringify({ userId: "u1", content: "hello world", sourceType: "conversation" });

describe("hasScope", () => {
  const ctx = (scopes: string[]): DeveloperContext => ({
    developerId: "d",
    workspaceId: "w",
    plan: "free",
    scopes,
  });

  it("treats an empty scope set as unrestricted", () => {
    expect(hasScope(ctx([]), "ingest")).toBe(true);
    expect(hasScope(ctx([]), "admin")).toBe(true);
  });

  it("grants only the listed scopes once any scope is set", () => {
    expect(hasScope(ctx(["read"]), "read")).toBe(true);
    expect(hasScope(ctx(["read"]), "ingest")).toBe(false);
  });
});

describe("scope enforcement on /v1", () => {
  it("an unscoped key still reaches both read and write routes", async () => {
    const ingest = await req("/v1/ingest", UNSCOPED_KEY, { method: "POST", body: ingestBody });
    expect(ingest.status).not.toBe(403);

    const context = await req("/v1/context?userId=u1", UNSCOPED_KEY);
    expect(context.status).toBe(200);
  });

  it("a read-only key cannot ingest", async () => {
    const res = await req("/v1/ingest", READ_KEY, { method: "POST", body: ingestBody });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      code: "insufficient_scope",
      required_scope: "ingest",
      key_scopes: ["read"],
    });
  });

  it("a read-only key can still read", async () => {
    const res = await req("/v1/context?userId=u1", READ_KEY);
    expect(res.status).toBe(200);
  });

  it("an ingest-only key cannot read context", async () => {
    const res = await req("/v1/context?userId=u1", INGEST_KEY);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ required_scope: "read" });
  });

  it("an ingest-only key can ingest", async () => {
    const res = await req("/v1/ingest", INGEST_KEY, { method: "POST", body: ingestBody });
    expect(res.status).not.toBe(403);
  });

  // The destructive routes are the reason enforcement matters: a key handed out
  // for read access must not be able to delete a user's entire memory.
  it("a read-only key cannot delete a user", async () => {
    const res = await req("/v1/user?userId=u1", READ_KEY, { method: "DELETE" });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ required_scope: "admin" });
  });

  it("scope denial is 403, not 401 — the credential is valid, just not permitted", async () => {
    const denied = await req("/v1/ingest", READ_KEY, { method: "POST", body: ingestBody });
    expect(denied.status).toBe(403);

    const unauthenticated = await req("/v1/ingest", "ans_" + "z".repeat(32), { method: "POST", body: ingestBody });
    expect(unauthenticated.status).toBe(401);
  });
});
