import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, developerAccounts, memoryChunks } from "../lib/db/schema.js";
import { ingestExtraction } from "../lib/ai/attestation-ingest.js";
import type { ExtractedAttestation } from "../lib/ai/attestation-extraction-prompt.js";
import { reconstructLedger } from "../lib/ai/ledger.js";
import { computeDivergences, computeTimeline } from "../lib/ai/ledger-diff.js";
import { renderLedgerReport } from "../lib/ai/ledger-render.js";
import { cleanDatabase } from "./setup.js";

// PR-6: the demo runs end-to-end over the fixture corpus, deterministically (oracle
// input, no LLM): seed the corpus -> ingest -> reconstruct + diverge + timeline ->
// render. Proves every layer composes into the demo's three beats.

const FX = resolve(process.cwd(), "scripts/eval/fixtures/incident_response");
const SLACK = JSON.parse(readFileSync(resolve(FX, "slack_messages.json"), "utf8")).messages as Array<{ id: string; channel: string; author: string; ts: string; text: string }>;
const RUNBOOK = JSON.parse(readFileSync(resolve(FX, "notion_runbook.json"), "utf8")).doc as { last_edited: string; title: string; blocks: Array<{ id: string; text: string }> };
const ORACLE = JSON.parse(readFileSync(resolve(FX, "expected_attestations.json"), "utf8")) as { attestations: Array<Record<string, any>>; refusals: Array<{ source_id: string; reason: string }> };

let workspaceId: string;
let developerId: string;

beforeEach(async () => {
  await cleanDatabase();
  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  workspaceId = ws.id;
  const [dev] = await db.insert(developerAccounts).values({ workspaceId, name: "Demo", email: "demo-e2e@test.com" }).returning({ id: developerAccounts.id });
  developerId = dev.id;
});

afterAll(closePool);

async function seedAndIngest() {
  const idMap = new Map<string, string>();
  for (const m of SLACK) {
    const [r] = await db.insert(memoryChunks).values({ workspaceId, sourceType: "message", sourceId: `slack:${m.id}`, content: m.text, metadata: { author: m.author, authorId: m.author, timestamp: m.ts, channelName: m.channel } }).returning({ id: memoryChunks.id });
    idMap.set(m.id, r.id);
  }
  for (const b of RUNBOOK.blocks) {
    const [r] = await db.insert(memoryChunks).values({ workspaceId, sourceType: "notion_page", sourceId: `notion:${b.id}`, content: b.text, metadata: { author: "notion", authorId: "notion", timestamp: RUNBOOK.last_edited, channelName: RUNBOOK.title } }).returning({ id: memoryChunks.id });
    idMap.set(b.id, r.id);
  }
  const extraction = {
    attestations: ORACLE.attestations.map(
      (o): ExtractedAttestation => ({
        claim: o.claim, claimType: o.claim_type, claimKey: o.claim_key, claimFingerprint: o.claim_fingerprint,
        polarity: o.polarity, inferenceStatus: o.inference_status, domain: "incident_response",
        evidence: o.evidence.map((e: any) => ({ chunkId: idMap.get(e.source_id)!, quote: e.quote })),
        validTime: { from: o.valid_time.from, fromBasis: o.valid_time.from_basis, fromGranularity: o.valid_time.from_granularity },
        corrects: null,
      })
    ),
    refusals: ORACLE.refusals.map((r) => ({ sourceId: r.source_id, reason: r.reason })),
  };
  return ingestExtraction({ workspaceId, developerId, extraction });
}

describe("ledger demo end-to-end (oracle mode)", () => {
  it("ingests the corpus and renders a report with the procedure, the divergence, and the timeline", async () => {
    const result = await seedAndIngest();
    expect(result.written).toHaveLength(6);
    expect(result.refusals.length).toBeGreaterThanOrEqual(3); // the chatter

    const [view, divergences, timeline] = await Promise.all([
      reconstructLedger(workspaceId, { domain: "incident_response" }),
      computeDivergences(workspaceId, { domain: "incident_response" }),
      computeTimeline(workspaceId, { domain: "incident_response" }),
    ]);

    // Beat 1: the extracted procedure is in the report, cited and tiered.
    expect(view.claims.length).toBe(6);
    // Beat 2: the doc-vs-reality divergence with the March change date.
    expect(divergences).toHaveLength(1);
    expect(divergences[0].changedAt).toBe("2026-03-01T00:00:00.000Z");
    // Beat 3: a timeline exists.
    expect(timeline.length).toBeGreaterThanOrEqual(6);

    const report = renderLedgerReport({ domain: "incident_response", view, divergences, timeline });
    expect(report).toContain("## How the company operates");
    expect(report).toContain("war room in #incidents");
    expect(report).toContain("docs say");
    expect(report).toContain("changed ~2026-03-01");
  });
});
