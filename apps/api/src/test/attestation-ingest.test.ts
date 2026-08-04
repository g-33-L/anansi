import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, developerAccounts, memoryChunks, attestations } from "../lib/db/schema.js";
import {
  getActive,
  getActiveByClaimKey,
  getActiveByFingerprint,
  getAsOfValidTime,
} from "../lib/db/attestations-repo.js";
import {
  ingestExtraction,
  computeConfidence,
  normalizeValidTime,
  parseStatedStart,
} from "../lib/ai/attestation-ingest.js";
import type { ExtractedAttestation, ExtractionOutput } from "../lib/ai/attestation-extraction-prompt.js";
import { cleanDatabase } from "./setup.js";

// ─── Fixture corpus ───────────────────────────────────────────────────────────

const FX = resolve(process.cwd(), "scripts/eval/fixtures/incident_response");
const SLACK = JSON.parse(readFileSync(resolve(FX, "slack_messages.json"), "utf8")).messages as Array<{
  id: string; channel: string; author: string; ts: string; text: string;
}>;
const RUNBOOK = JSON.parse(readFileSync(resolve(FX, "notion_runbook.json"), "utf8")).doc as {
  last_edited: string; title: string; blocks: Array<{ id: string; heading: string; text: string }>;
};
const ORACLE = JSON.parse(readFileSync(resolve(FX, "expected_attestations.json"), "utf8")) as {
  attestations: Array<Record<string, any>>;
  refusals: Array<{ source_id: string; reason: string }>;
};

const NOW = new Date("2026-07-15T00:00:00Z");

let workspaceId: string;
let developerId: string;
let otherWorkspaceId: string;
let idMap: Map<string, string>; // fixture source_id ("m1"/"b1") -> real chunk uuid

async function makeWorkspace(email: string) {
  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId: ws.id, name: "Dev", email })
    .returning({ id: developerAccounts.id });
  return { workspaceId: ws.id, developerId: dev.id };
}

// Seed the fixture corpus into memory_chunks and return a source_id -> chunk_id map.
async function seedCorpus(ws: string): Promise<Map<string, string>> {
  const rows = [
    ...SLACK.map((m) => ({
      workspaceId: ws,
      sourceType: "message" as const,
      sourceId: `slack:${m.id}`,
      content: m.text,
      metadata: { author: m.author, authorId: m.author, timestamp: m.ts, channelName: m.channel },
      _fx: m.id,
    })),
    ...RUNBOOK.blocks.map((b) => ({
      workspaceId: ws,
      sourceType: "notion_page" as const,
      sourceId: `notion:${b.id}`,
      content: b.text,
      metadata: { author: "notion", authorId: "notion", timestamp: RUNBOOK.last_edited, channelName: RUNBOOK.title, title: b.heading },
      _fx: b.id,
    })),
  ];
  const map = new Map<string, string>();
  for (const r of rows) {
    const { _fx, ...values } = r;
    const [inserted] = await db.insert(memoryChunks).values(values).returning({ id: memoryChunks.id });
    map.set(_fx, inserted.id);
  }
  return map;
}

// Build a model-shaped ExtractedAttestation from an oracle entry, resolving fixture
// source_ids to the real seeded chunk ids.
function fromOracle(o: Record<string, any>, overrides: Partial<ExtractedAttestation> = {}): ExtractedAttestation {
  return {
    claim: o.claim,
    claimType: o.claim_type,
    claimKey: o.claim_key,
    claimFingerprint: o.claim_fingerprint,
    polarity: o.polarity,
    inferenceStatus: o.inference_status,
    domain: "incident_response",
    evidence: o.evidence.map((e: any) => ({ chunkId: idMap.get(e.source_id)!, quote: e.quote })),
    validTime: {
      from: o.valid_time.from,
      fromBasis: o.valid_time.from_basis,
      fromGranularity: o.valid_time.from_granularity,
    },
    corrects: null,
    ...overrides,
  };
}

const oracleBy = (fp: string) => ORACLE.attestations.find((a) => a.claim_fingerprint === fp)!;

function extraction(atts: ExtractedAttestation[], refusals: ExtractionOutput["refusals"] = []): ExtractionOutput {
  return { attestations: atts, refusals };
}

beforeEach(async () => {
  await cleanDatabase();
  ({ workspaceId, developerId } = await makeWorkspace("attest-ingest@test.com"));
  ({ workspaceId: otherWorkspaceId } = await makeWorkspace("attest-ingest-other@test.com"));
  idMap = await seedCorpus(workspaceId);
});

afterAll(closePool);

// ─── Evidence verification (hard gate) ────────────────────────────────────────

describe("evidence verification", () => {
  it("a verbatim quote succeeds and persists evidence", async () => {
    const a = fromOracle(oracleBy("p0_war_room_channel:#incidents"));
    const r = await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });
    expect(r.written).toHaveLength(1);
    expect(r.refusals).toHaveLength(0);
    expect(r.written[0].evidence.length).toBeGreaterThanOrEqual(1);
    expect(r.written[0].evidence[0].chunkId).toBe(idMap.get("m1"));
  });

  it("rejects a quote that is not a verbatim substring", async () => {
    const a = fromOracle(oracleBy("p0_war_room_channel:#incidents"), {
      evidence: [{ chunkId: idMap.get("m1")!, quote: "this text is not in the chunk" }],
    });
    const r = await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });
    expect(r.written).toHaveLength(0);
    expect(r.refusals.some((x) => x.reason === "quote_not_verbatim")).toBe(true);
  });

  it("rejects evidence referencing a non-existent chunk", async () => {
    const a = fromOracle(oracleBy("p0_war_room_channel:#incidents"), {
      evidence: [{ chunkId: randomUUID(), quote: "anything" }],
    });
    const r = await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });
    expect(r.written).toHaveLength(0);
    expect(r.refusals.some((x) => x.reason === "chunk_not_found")).toBe(true);
  });

  it("rejects evidence from another workspace's chunk", async () => {
    const [leak] = await db
      .insert(memoryChunks)
      .values({ workspaceId: otherWorkspaceId, sourceType: "message", sourceId: "slack:leak", content: "secret in #incidents", metadata: { author: "x", authorId: "x", timestamp: "2026-05-01T00:00:00Z", channelName: "#x" } })
      .returning({ id: memoryChunks.id });
    const a = fromOracle(oracleBy("p0_war_room_channel:#incidents"), {
      evidence: [{ chunkId: leak.id, quote: "secret in #incidents" }],
    });
    const r = await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });
    expect(r.written).toHaveLength(0);
    expect(r.refusals.some((x) => x.reason === "cross_workspace_evidence")).toBe(true);
  });
});

// ─── Temporal honesty ─────────────────────────────────────────────────────────

describe("parseStatedStart (deterministic date recovery)", () => {
  const ref = new Date("2026-04-02T00:00:00Z");
  it("resolves a bare month name against the message year", () => {
    expect(parseStatedStart("since April, escalations go to the CSM", ref)?.date.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });
  it("parses an explicit YYYY-MM and YYYY-MM-DD", () => {
    expect(parseStatedStart("effective 2026-02 access reviews are monthly", null)?.date.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    const d = parseStatedStart("starting 2026-03-15 we page via PagerDuty", null);
    expect(d?.date.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(d?.granularity).toBe("day");
  });
  it("wraps to the prior year when the month is after the reference month", () => {
    expect(parseStatedStart("since December we do X", new Date("2026-01-10T00:00:00Z"))?.date.toISOString()).toBe("2025-12-01T00:00:00.000Z");
  });
  it("does not fire without a start marker or on non-months", () => {
    expect(parseStatedStart("escalations are routed to the support lead", ref)).toBeNull();
    expect(parseStatedStart("from the support lead onward", ref)).toBeNull();
  });
});

describe("stated-date recovery through ingest", () => {
  it("recovers the start date from the source when the model omitted valid_time.from", async () => {
    // Model extracted the claim but left valid_time.from null; the source says "since March".
    const a = fromOracle(oracleBy("escalation_channel:#incidents"), {
      validTime: { from: null, fromBasis: "unknown", fromGranularity: "unknown" },
    });
    const r = await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });
    expect(r.written[0].validFrom?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(r.written[0].validFromBasis).toBe("stated");
  });
});

describe("temporal rules", () => {
  it("preserves an explicitly stated valid_from", async () => {
    const a = fromOracle(oracleBy("escalation_channel:#incidents")); // from "2026-03", stated
    const r = await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });
    expect(r.written[0].validFrom?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(r.written[0].validFromBasis).toBe("stated");
    expect(r.written[0].validFromGranularity).toBe("month");
  });

  it("never invents valid_from when no date is stated", async () => {
    const a = fromOracle(oracleBy("p0_war_room_channel:#incidents")); // from null
    const r = await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });
    expect(r.written[0].validFrom).toBeNull();
    expect(r.written[0].validFromBasis).toBe("unknown");
  });

  it("downgrades a 'stated' basis with no parseable date to unknown (never guesses)", () => {
    const t = normalizeValidTime({ from: null, fromBasis: "stated", fromGranularity: "month" });
    expect(t.validFrom).toBeNull();
    expect(t.validFromBasis).toBe("unknown");
  });

  it("always stamps recorded_at", async () => {
    const a = fromOracle(oracleBy("p0_war_room_channel:#incidents"));
    const r = await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });
    expect(r.written[0].recordedAt.toISOString()).toBe(NOW.toISOString());
  });
});

// ─── Confidence (system-computed) ─────────────────────────────────────────────

describe("confidence", () => {
  it("never returns 1.0, even in the best case", () => {
    const { confidence } = computeConfidence({
      independentSourceCount: 5,
      inferenceStatus: "stated",
      validFromBasis: "stated",
      newestEventTime: NOW,
      now: NOW,
    });
    expect(confidence).toBeLessThan(1);
    expect(confidence).toBeLessThanOrEqual(0.95);
  });

  it("grows with more independent sources", () => {
    const base = { inferenceStatus: "stated" as const, validFromBasis: "stated" as const, newestEventTime: NOW, now: NOW };
    const one = computeConfidence({ ...base, independentSourceCount: 1 }).confidence;
    const two = computeConfidence({ ...base, independentSourceCount: 2 }).confidence;
    expect(two).toBeGreaterThan(one);
  });

  it("persists a confidence breakdown, and no written claim is fully certain", async () => {
    const a = fromOracle(oracleBy("p0_war_room_channel:#incidents"));
    const r = await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });
    const row = r.written[0];
    expect(row.confidence).toBeGreaterThan(0);
    expect(row.confidence).toBeLessThan(1);
    expect((row.confidenceBreakdown as Record<string, unknown>).independentSourceCount).toBeDefined();
  });
});

// ─── Append-only corrections ──────────────────────────────────────────────────

describe("append-only corrections", () => {
  it("closes the superseded row without mutating its content, and keeps it queryable in the past", async () => {
    // 1. The documented answer (#engineering) becomes active.
    const eng = fromOracle(oracleBy("escalation_channel:#engineering"));
    const r1 = await ingestExtraction({ workspaceId, developerId, extraction: extraction([eng]), now: new Date("2026-01-01T00:00:00Z") });
    const engRow = r1.written[0];
    const snapshot = { claim: engRow.claim, evidence: JSON.stringify(engRow.evidence), confidence: engRow.confidence };

    // 2. The observed answer (#incidents) supersedes it via a stated change.
    const inc = fromOracle(oracleBy("escalation_channel:#incidents"), {
      corrects: { claimKey: "escalation_channel", reason: "change" },
    });
    await ingestExtraction({ workspaceId, developerId, extraction: extraction([inc]), now: NOW });

    const [engAfter] = await db.select().from(attestations).where(eq(attestations.id, engRow.id));
    // Closed at the new claim's start; learned now.
    expect(engAfter.validUntil?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(engAfter.validUntilRecordedAt?.toISOString()).toBe(NOW.toISOString());
    // Content untouched — no mutation of claim/evidence/confidence.
    expect(engAfter.claim).toBe(snapshot.claim);
    expect(JSON.stringify(engAfter.evidence)).toBe(snapshot.evidence);
    expect(engAfter.confidence).toBe(snapshot.confidence);

    // Active view has only the successor; the past still reconstructs #engineering.
    const active = await getActive(workspaceId, { domain: "incident_response" });
    expect(active.map((a) => a.claimFingerprint)).toEqual(["escalation_channel:#incidents"]);
    const past = await getAsOfValidTime(workspaceId, { asOf: new Date("2026-02-01T00:00:00Z"), domain: "incident_response" });
    expect(past.map((a) => a.claimFingerprint)).toContain("escalation_channel:#engineering");
  });
});

// ─── Disputes ─────────────────────────────────────────────────────────────────

describe("disputes", () => {
  it("keeps conflicting answers as separate coexisting active attestations", async () => {
    const inc = fromOracle(oracleBy("escalation_channel:#incidents"));
    const eng = fromOracle(oracleBy("escalation_channel:#engineering"));
    await ingestExtraction({ workspaceId, developerId, extraction: extraction([inc, eng]), now: NOW });

    const group = await getActiveByClaimKey(workspaceId, "escalation_channel");
    expect(group).toHaveLength(2);
    expect(new Set(group.map((a) => a.claimFingerprint))).toEqual(
      new Set(["escalation_channel:#incidents", "escalation_channel:#engineering"])
    );
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe("idempotency", () => {
  it("re-running the same extraction does not duplicate the active claim", async () => {
    const a = fromOracle(oracleBy("p0_war_room_channel:#incidents"));
    await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });
    const r2 = await ingestExtraction({ workspaceId, developerId, extraction: extraction([a]), now: NOW });

    expect(r2.written).toHaveLength(0);
    expect(r2.noops).toBe(1);
    const active = await getActiveByFingerprint(workspaceId, "p0_war_room_channel:#incidents");
    expect(active).toBeDefined();
    const all = await db
      .select()
      .from(attestations)
      .where(and(eq(attestations.workspaceId, workspaceId), eq(attestations.claimFingerprint, "p0_war_room_channel:#incidents")));
    expect(all).toHaveLength(1);
  });
});

// ─── End-to-end trust (the success condition) ─────────────────────────────────

describe("end-to-end over the fixture corpus", () => {
  it("produces evidence-backed, uncertainty-aware, append-only attestations and refuses chatter", async () => {
    const atts = ORACLE.attestations.map((o) => fromOracle(o));
    const refusals = ORACLE.refusals.map((r) => ({ sourceId: r.source_id, reason: r.reason }));
    const r = await ingestExtraction({ workspaceId, developerId, extraction: extraction(atts, refusals), now: NOW });

    // All six evidenced claims land; the three chatter items are refused.
    expect(r.written).toHaveLength(6);
    for (const w of r.written) {
      expect(w.evidence.length).toBeGreaterThanOrEqual(1);
      expect(w.confidence).toBeGreaterThan(0);
      expect(w.confidence).toBeLessThan(1); // never certain
    }
    for (const reason of ["opinion", "proposal_not_adopted", "not_operational"]) {
      expect(r.refusals.some((x) => x.reason === reason)).toBe(true);
    }

    // Corroboration tiers: multi-source -> observed, single-source -> candidate.
    const byFp = new Map(r.written.map((w) => [w.claimFingerprint, w]));
    expect(byFp.get("p0_war_room_channel:#incidents")!.status).toBe("observed"); // priya + dan
    expect(byFp.get("oncall_ack_sla:5min_escalate_team_lead")!.status).toBe("candidate"); // dan only (two dan chunks = 1 source)
    expect(byFp.get("incident_commander_role:eng_manager_on_call")!.status).toBe("candidate"); // priya only

    // The escalation disagreement is preserved as a query-derivable dispute.
    const group = await getActiveByClaimKey(workspaceId, "escalation_channel");
    expect(group).toHaveLength(2);
  });
});
