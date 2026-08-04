// Runnable ledger demo over the incident_response fixture corpus.
//
//   pnpm --filter @anansi/api demo:ledger          # deterministic (oracle) mode
//   pnpm --filter @anansi/api demo:ledger --live   # run the real model + score it
//
// Needs DATABASE_URL (a local dev DB). Creates a throwaway workspace, ingests the
// corpus into memory_chunks, runs extraction -> attestations, then prints the
// human-readable ledger report. --live also scores the model against the oracle.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, closePool } from "../src/lib/db/index.js";
import { workspaces, developerAccounts, memoryChunks } from "../src/lib/db/schema.js";
import { ingestExtraction } from "../src/lib/ai/attestation-ingest.js";
import { extractAttestations } from "../src/lib/ai/attestation-extraction.js";
import type { ExtractionOutput, ExtractedAttestation } from "../src/lib/ai/attestation-extraction-prompt.js";
import { reconstructLedger } from "../src/lib/ai/ledger.js";
import { computeDivergences, computeTimeline } from "../src/lib/ai/ledger-diff.js";
import { renderLedgerReport } from "../src/lib/ai/ledger-render.js";
import { scoreExtraction } from "../src/lib/ai/extraction-eval.js";

const FX = fileURLToPath(new URL("./eval/fixtures/incident_response/", import.meta.url));
const DOMAIN = "incident_response";
const live = process.argv.includes("--live");

function load<T>(name: string): T {
  return JSON.parse(readFileSync(FX + name, "utf8")) as T;
}

async function main() {
  const slack = load<{ messages: Array<{ id: string; channel: string; author: string; ts: string; text: string }> }>("slack_messages.json").messages;
  const runbook = load<{ doc: { last_edited: string; title: string; blocks: Array<{ id: string; text: string }> } }>("notion_runbook.json").doc;
  const oracle = load<{ attestations: Array<Record<string, any>>; refusals: Array<{ source_id: string; reason: string }> }>("expected_attestations.json");

  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId: ws.id, name: "Demo", email: `demo-${ws.id}@anansi.dev` })
    .returning({ id: developerAccounts.id });

  const idMap = new Map<string, string>();
  for (const m of slack) {
    const [row] = await db
      .insert(memoryChunks)
      .values({ workspaceId: ws.id, sourceType: "message", sourceId: `slack:${m.id}`, content: m.text, metadata: { author: m.author, authorId: m.author, timestamp: m.ts, channelName: m.channel } })
      .returning({ id: memoryChunks.id });
    idMap.set(m.id, row.id);
  }
  for (const b of runbook.blocks) {
    const [row] = await db
      .insert(memoryChunks)
      .values({ workspaceId: ws.id, sourceType: "notion_page", sourceId: `notion:${b.id}`, content: b.text, metadata: { author: "notion", authorId: "notion", timestamp: runbook.last_edited, channelName: runbook.title } })
      .returning({ id: memoryChunks.id });
    idMap.set(b.id, row.id);
  }

  let extraction: ExtractionOutput;
  let extractionMs = 0;
  if (live) {
    const chunks = [
      ...slack.map((m) => ({ id: idMap.get(m.id)!, source: `slack ${m.channel}`, author: m.author, text: m.text })),
      ...runbook.blocks.map((b) => ({ id: idMap.get(b.id)!, source: `notion ${runbook.title}`, text: b.text })),
    ];
    console.log("Running live extraction against the configured model...");
    const t0 = performance.now();
    extraction = await extractAttestations({ domain: DOMAIN, chunks });
    extractionMs = performance.now() - t0;
  } else {
    extraction = {
      attestations: oracle.attestations.map(
        (o): ExtractedAttestation => ({
          claim: o.claim,
          claimType: o.claim_type,
          claimKey: o.claim_key,
          claimFingerprint: o.claim_fingerprint,
          polarity: o.polarity,
          inferenceStatus: o.inference_status,
          domain: DOMAIN,
          evidence: o.evidence.map((e: any) => ({ chunkId: idMap.get(e.source_id)!, quote: e.quote })),
          validTime: { from: o.valid_time.from, fromBasis: o.valid_time.from_basis, fromGranularity: o.valid_time.from_granularity },
          corrects: null,
        })
      ),
      refusals: oracle.refusals.map((r) => ({ sourceId: r.source_id, reason: r.reason })),
    };
  }

  const result = await ingestExtraction({ workspaceId: ws.id, developerId: dev.id, extraction });

  const [view, divergences, timeline] = await Promise.all([
    reconstructLedger(ws.id, { domain: DOMAIN }),
    computeDivergences(ws.id, { domain: DOMAIN }),
    computeTimeline(ws.id, { domain: DOMAIN }),
  ]);

  console.log("\n" + renderLedgerReport({ domain: DOMAIN, view, divergences, timeline }));
  console.log(`\n(written: ${result.written.length}, refused: ${result.refusals.length}, no-ops: ${result.noops})`);

  if (live) {
    const chatterTexts = oracle.refusals
      .map((r) => slack.find((m) => m.id === r.source_id)?.text)
      .filter((t): t is string => !!t);
    const score = scoreExtraction(extraction, oracle, { chatterTexts });
    console.log("\n## Extraction quality vs oracle (semantic claim-text match)");
    console.log(
      `precision ${(score.precision * 100).toFixed(0)}%  recall ${(score.recall * 100).toFixed(0)}%  ` +
        `F1 ${(score.f1 * 100).toFixed(0)}%  citations ${(score.citationRate * 100).toFixed(0)}%  ` +
        `chatter-leaks ${score.chatterLeaks}/${chatterTexts.length} (refusal ${(score.refusalRate * 100).toFixed(0)}%)`
    );
    console.log(
      `matched ${score.recallMatches}/${score.expected} oracle claims; ${score.actual} extracted; ` +
        `extraction latency ${Math.round(extractionMs)}ms`
    );
  }

  // Throwaway workspace — cascade-clean so repeated runs don't accumulate.
  await db.delete(workspaces).where(eq(workspaces.id, ws.id));
}

main()
  .then(() => closePool())
  .catch(async (err) => {
    console.error(err);
    await closePool();
    process.exit(1);
  });
