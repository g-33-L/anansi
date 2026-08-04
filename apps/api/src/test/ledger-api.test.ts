import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createApp } from "../app.js";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, developerAccounts, developerApiKeys, type NewAttestation } from "../lib/db/schema.js";
import { insertAttestation } from "../lib/db/attestations-repo.js";
import { cleanDatabase } from "./setup.js";
import { hashApiKey } from "../lib/auth/api-auth.js";

// PR-5: REST surface for the ledger read layer. Exercised end-to-end through the
// real app (auth + rate limit + DB), same harness as v1.test.ts.

vi.mock("../lib/ai/embed.js", () => ({
  embedBatch: vi.fn(),
  embedOne: vi.fn(),
  getEmbedStats: vi.fn().mockReturnValue({ calls: 0, chunks: 0, tokens: 0 }),
}));

const RAW_KEY = "ans_" + "b".repeat(32);
let workspaceId: string;
let developerId: string;

beforeEach(async () => {
  await cleanDatabase();
  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  workspaceId = ws.id;
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId, name: "Dev", email: "ledger-api@test.com" })
    .returning({ id: developerAccounts.id });
  developerId = dev.id;
  process.env.API_KEY_HMAC_SECRET = "test-hmac-secret-32-bytes-minimum-x";
  await db.insert(developerApiKeys).values({ developerId, keyHash: hashApiKey(RAW_KEY), name: "Test key" });

  // Seed a doc-vs-reality divergence: documented #engineering, observed #incidents (since March).
  await seed({
    claim: "Incidents are escalated in #engineering",
    claimKey: "escalation_channel",
    claimFingerprint: "escalation_channel:#engineering",
    evidence: [{ chunkId: "b1", quote: "escalated in #engineering", source: "notion runbook", author: "notion" }],
  });
  await seed({
    claim: "Incident comms happen in #incidents",
    claimKey: "escalation_channel",
    claimFingerprint: "escalation_channel:#incidents",
    status: "observed",
    validFrom: new Date("2026-03-01T00:00:00Z"),
    validFromBasis: "stated",
    evidence: [{ chunkId: "m4", quote: "since March", source: "slack #incidents", author: "sarah" }],
  });
});

afterAll(closePool);

function seed(o: Partial<NewAttestation>) {
  const base: NewAttestation = {
    workspaceId,
    developerId,
    claim: "c",
    claimFingerprint: "k:c",
    claimKey: "k",
    domain: "incident_response",
    status: "candidate",
    confidence: 0.6,
    evidence: [{ chunkId: "x", quote: "q", source: "slack", author: "dan" }],
  };
  return insertAttestation({ ...base, ...o });
}

function req(path: string, key = RAW_KEY) {
  const app = createApp();
  return app.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${key}` } }));
}

describe("GET /v1/ledger", () => {
  it("requires authentication", async () => {
    const app = createApp();
    const res = await app.fetch(new Request("http://localhost/v1/ledger"));
    expect(res.status).toBe(401);
  });

  it("returns cited, trust-tiered claims and flags the dispute", async () => {
    const res = await req("/v1/ledger?domain=incident_response");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.claims).toHaveLength(2);
    expect(body.claims.every((c: { evidence: unknown[] }) => c.evidence.length >= 1)).toBe(true);
    expect(body.disputes).toHaveLength(1);
    expect(body.disputes[0].claimKey).toBe("escalation_channel");
  });

  it("rejects an invalid asOf", async () => {
    const res = await req("/v1/ledger?asOf=not-a-date");
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/ledger/divergences", () => {
  it("surfaces the doc-vs-reality divergence with the change date", async () => {
    const res = await req("/v1/ledger/divergences?domain=incident_response");
    expect(res.status).toBe(200);
    const { divergences } = await res.json();
    expect(divergences).toHaveLength(1);
    expect(divergences[0].documented.fingerprint).toBe("escalation_channel:#engineering");
    expect(divergences[0].observed.fingerprint).toBe("escalation_channel:#incidents");
    expect(divergences[0].changedAt).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("GET /v1/ledger/timeline", () => {
  it("returns chronological adoption events", async () => {
    const res = await req("/v1/ledger/timeline?domain=incident_response");
    expect(res.status).toBe(200);
    const { timeline } = await res.json();
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    // sorted ascending by instant
    const times = timeline.map((e: { at: string }) => e.at);
    expect([...times]).toEqual([...times].sort());
  });
});
