// Anansi extraction evaluation harness (Priority 3).
//
//   pnpm --filter @anansi/api eval:extraction
//
// Discovers every domain under scripts/eval/fixtures/enterprise/*, runs the REAL
// extraction pipeline for each (seed chunks -> extract -> ingest -> divergence
// detection), scores against the hand-labeled oracle, and emits three outputs:
// a terminal summary, a machine-readable JSON, and a Markdown report. Needs a
// chat model (set DEPLOYMENT_MODE + a provider key in apps/api/.env). Adding a
// sixth domain requires only dropping in a fixture folder — nothing here changes.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { db, closePool } from "../../src/lib/db/index.js";
import { workspaces, developerAccounts, memoryChunks } from "../../src/lib/db/schema.js";
import { extractAttestations } from "../../src/lib/ai/attestation-extraction.js";
import { ingestExtraction } from "../../src/lib/ai/attestation-ingest.js";
import { computeDivergences } from "../../src/lib/ai/ledger-diff.js";
import {
  scoreExtraction,
  scoreDivergence,
  claimsMatch,
  type ExpectedDivergence,
} from "../../src/lib/ai/extraction-eval.js";
import { getDeploymentConfig } from "../../src/lib/config/deployment.js";
import { resolveLlmProvider } from "../../src/lib/ai/llm.js";

const FIX_DIR = fileURLToPath(new URL("./fixtures/enterprise/", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));
// Refusal reasons that indicate the model's evidence did not verify (a citation defect).
const EVIDENCE_REASONS = new Set(["no_evidence", "chunk_not_found", "cross_workspace_evidence", "quote_not_verbatim"]);

interface Fixture {
  slack: Array<{ id: string; channel: string; author: string; ts: string; text: string }>;
  docs: Array<{ id: string; title: string; last_edited: string; blocks: Array<{ id: string; text: string }> }>;
  oracle: {
    attestations: Array<{ claim: string; claim_fingerprint: string }>;
    refusals: Array<{ source_id: string; reason: string }>;
    divergences: Array<{ claim_key: string; documented: string; observed: string; changed_at: string }>;
  };
}

interface Failure {
  domain: string;
  category: string;
  extractedClaim?: string;
  expectedClaim?: string;
  citation?: string;
  sourceChunk?: string;
}

type DomainResult = Awaited<ReturnType<typeof runDomain>>;

interface EvalReport {
  evaluator: string;
  timestamp: string;
  git: { sha: string; branch: string };
  model: { provider: string; name: string };
  config: { domains: string[]; runsPerDomain: number; matchThreshold: number; matcher: string };
  aggregate: {
    extraction: { precision: number; recall: number; f1: number; truePositives: number; falsePositives: number; falseNegatives: number; gold: number };
    evidence: { integrity: number; invalidCitations: number; proposed: number };
    refusal: { expected: number; correct: number; falseAcceptances: number; recall: number };
    divergence: { fireRate: number; detected: number; missed: number; falseAlerts: number };
    changedDateAccuracy: number;
    performance: { totalRuntimeMs: number; avgLatencyMs: number; p50LatencyMs: number; p95LatencyMs: number | null };
  };
  domains: DomainResult[];
  failures: Failure[];
}

function loadFixture(domain: string): Fixture {
  const j = (f: string) => JSON.parse(readFileSync(FIX_DIR + domain + "/" + f, "utf8"));
  return { slack: j("slack_messages.json").messages, docs: j("notion_docs.json").docs, oracle: j("expected_attestations.json") };
}

function pct(n: number): number {
  return Math.round(n * 1000) / 10;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cloud providers rate-limit tokens-per-minute; retry after the window clears so
// a multi-domain run completes rather than crashing halfway.
async function extractWithRetry(opts: { domain: string; chunks: Array<{ id: string; source: string; author?: string; text: string }> }) {
  for (let attempt = 0; ; attempt++) {
    try {
      const t0 = performance.now();
      const output = await extractAttestations(opts);
      return { output, latencyMs: Math.round(performance.now() - t0) };
    } catch (e) {
      const err = e as { message?: string; code?: string; cause?: { code?: string } };
      const msg = `${err?.message ?? ""} ${err?.code ?? ""} ${err?.cause?.code ?? ""} ${String(e)}`;
      const isRate = /429|too_many_tokens|rate.?limit|quota/i.test(msg);
      const isNet = /fetch failed|EADDR|ECONN|ETIMEDOUT|ENOTFOUND|socket|network/i.test(msg);
      if (attempt < 5 && (isRate || isNet)) {
        const wait = isRate ? 60_000 : 6_000;
        process.stdout.write(`(${isRate ? "rate limited" : "net error"}, retry in ${wait / 1000}s) `);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function runDomain(domain: string) {
  const fx = loadFixture(domain);
  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId: ws.id, name: "Eval", email: `eval-${domain}-${ws.id}@anansi.dev` })
    .returning({ id: developerAccounts.id });

  // Seed the corpus into memory_chunks exactly as the pipeline would.
  const srcText = new Map<string, string>();
  const chunks: Array<{ id: string; source: string; author?: string; text: string }> = [];
  for (const m of fx.slack) {
    const [r] = await db
      .insert(memoryChunks)
      .values({ workspaceId: ws.id, sourceType: "message", sourceId: `slack:${m.id}`, content: m.text, metadata: { author: m.author, timestamp: m.ts, channelName: m.channel } })
      .returning({ id: memoryChunks.id });
    chunks.push({ id: r.id, source: `slack ${m.channel}`, author: m.author, text: m.text });
    srcText.set(m.id, m.text);
  }
  for (const doc of fx.docs) {
    for (const b of doc.blocks) {
      const [r] = await db
        .insert(memoryChunks)
        .values({ workspaceId: ws.id, sourceType: "notion_page", sourceId: `notion:${b.id}`, content: b.text, metadata: { author: "notion", timestamp: doc.last_edited, channelName: doc.title } })
        .returning({ id: memoryChunks.id });
      chunks.push({ id: r.id, source: `notion ${doc.title}`, text: b.text });
      srcText.set(b.id, b.text);
    }
  }

  const { output: extraction, latencyMs } = await extractWithRetry({ domain, chunks });

  const result = await ingestExtraction({ workspaceId: ws.id, developerId: dev.id, extraction });
  const fired = await computeDivergences(ws.id, { domain });

  // ── Extraction quality (semantic) + refusal ───────────────────────────────
  const chatterTexts = fx.oracle.refusals.map((r) => srcText.get(r.source_id)).filter((t): t is string => !!t);
  const s = scoreExtraction(extraction, fx.oracle as never, { chatterTexts });

  // ── Evidence integrity: proposed attestations whose evidence verified ──────
  const proposed = extraction.attestations.length;
  const invalidCitations = result.refusals.filter((r) => EVIDENCE_REASONS.has(r.reason)).length;
  const evidenceIntegrity = proposed > 0 ? (proposed - invalidCitations) / proposed : 1;
  const citationValidity = result.written.length > 0 ? result.written.filter((w) => w.evidence.length > 0).length / result.written.length : 1;

  // ── Refusal precision/recall ───────────────────────────────────────────────
  const expectedRefusals = fx.oracle.refusals.length;
  const falseAcceptances = s.chatterLeaks;
  const correctRefusals = expectedRefusals - falseAcceptances;
  const falseRefusals = extraction.refusals.filter((r) => r.candidate && fx.oracle.attestations.some((a) => claimsMatch(r.candidate!, a.claim))).length;
  const refusalPrecision = correctRefusals + falseRefusals > 0 ? correctRefusals / (correctRefusals + falseRefusals) : 1;

  // ── Divergence (temporal) ──────────────────────────────────────────────────
  const claimOf = (fp: string) => fx.oracle.attestations.find((a) => a.claim_fingerprint === fp)?.claim;
  const plantedRaw = fx.oracle.divergences[0];
  const planted: ExpectedDivergence | null = plantedRaw
    ? { documentedClaim: claimOf(plantedRaw.documented) ?? "", observedClaim: claimOf(plantedRaw.observed) ?? "", changedAt: plantedRaw.changed_at }
    : null;
  const divScore = scoreDivergence(fired, planted);

  // ── TP / FP / FN + inspectable failures ────────────────────────────────────
  const oracleClaims = fx.oracle.attestations.map((a) => ({ claim: a.claim, matched: false }));
  const truePositives: string[] = [];
  const falsePositives: string[] = [];
  const failures: Failure[] = [];
  for (const a of extraction.attestations) {
    const hit = oracleClaims.find((o) => !o.matched && claimsMatch(a.claim, o.claim));
    if (hit) {
      hit.matched = true;
      truePositives.push(a.claim);
    } else {
      falsePositives.push(a.claim);
      const ev = a.evidence[0];
      failures.push({ domain, category: "spurious_attestation", extractedClaim: a.claim, citation: ev?.quote, sourceChunk: ev?.chunkId });
    }
  }
  const falseNegatives = oracleClaims.filter((o) => !o.matched).map((o) => o.claim);
  for (const fnClaim of falseNegatives) failures.push({ domain, category: "missed_attestation", expectedClaim: fnClaim });
  if (planted && !divScore.expectedDetected) failures.push({ domain, category: "missed_divergence", expectedClaim: `${planted.documentedClaim}  ↔  ${planted.observedClaim}` });
  if (planted && divScore.expectedDetected && !divScore.changedDateCorrect) failures.push({ domain, category: "wrong_change_date", expectedClaim: `changed ${planted.changedAt}` });
  if (s.chatterLeaks > 0) failures.push({ domain, category: "refusal_failure", extractedClaim: `${s.chatterLeaks} chatter item(s) extracted as attestations` });

  await db.delete(workspaces).where(eq(workspaces.id, ws.id));

  return {
    domain,
    expected: { attestations: fx.oracle.attestations.length, refusals: expectedRefusals, divergences: fx.oracle.divergences.length },
    extracted: { attestations: result.written.length, proposed, refusals: result.refusals.length, divergences: fired.length },
    metrics: {
      precision: s.precision,
      recall: s.recall,
      f1: s.f1,
      evidenceIntegrity,
      citationValidity,
      invalidCitations,
      refusalPrecision,
      refusalRecall: s.refusalRate,
      expectedRefusals,
      correctRefusals,
      falseAcceptances,
      divergenceDetected: divScore.expectedDetected,
      falseDivergenceAlerts: divScore.falseAlerts,
      changedDateCorrect: divScore.changedDateCorrect,
      latencyMs,
    },
    counts: { truePositives: truePositives.length, falsePositives: falsePositives.length, falseNegatives: falseNegatives.length },
    truePositives,
    falsePositives,
    falseNegatives,
    failures,
    rawAttestations: result.written.map((w) => ({ claim: w.claim, claimKey: w.claimKey, fingerprint: w.claimFingerprint, status: w.status, confidence: w.confidence, validFrom: w.validFrom?.toISOString() ?? null, evidence: w.evidence })),
  };
}

// A slow local model can outlast the DB pool's idle timeout, and this machine has
// intermittent socket errors; retry the whole domain on transient DB/network faults
// so one blip doesn't abort a multi-minute run.
async function runDomainWithRetry(domain: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await runDomain(domain);
    } catch (e) {
      const err = e as { message?: string; cause?: { code?: string } };
      const msg = `${err?.message ?? ""} ${err?.cause?.code ?? ""} ${String(e)}`;
      const transient = /EADDR|ECONN|ETIMEDOUT|ENOTFOUND|socket|fetch failed|Failed query|connection|terminat|timeout|aborted/i.test(msg);
      if (attempt < 3 && transient) {
        process.stdout.write(`(transient error, retry in 5s) `);
        await sleep(5_000);
        continue;
      }
      throw e;
    }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const domains = readdirSync(FIX_DIR).filter((d) => existsSync(FIX_DIR + d + "/expected_attestations.json")).sort();
  if (domains.length === 0) throw new Error(`No fixture domains found under ${FIX_DIR}`);

  const cfg = getDeploymentConfig();
  const provider = resolveLlmProvider(cfg);
  const modelName =
    provider === "cerebras" ? process.env.CEREBRAS_SYNTHESIS_MODEL ?? "gpt-oss-120b"
    : provider === "github" ? process.env.GITHUB_MODELS_SYNTHESIS_MODEL ?? "gpt-4o-mini"
    : process.env.OLLAMA_LLM_MODEL ?? "llama3.1:8b";

  console.log(`\nANANSI EXTRACTION EVALUATION`);
  console.log(`model: ${provider}/${modelName}   domains: ${domains.length}\n`);

  const runStart = performance.now();
  const perDomain = [];
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    process.stdout.write(`  running ${d} ... `);
    const r = await runDomainWithRetry(d);
    perDomain.push(r);
    console.log(`P ${pct(r.metrics.precision)}%  R ${pct(r.metrics.recall)}%  div ${r.metrics.divergenceDetected ? "✓" : "✗"}  ${r.metrics.latencyMs}ms`);
    if (i < domains.length - 1) await sleep(15_000); // ease the provider's per-minute token limit
  }
  const totalRuntimeMs = Math.round(performance.now() - runStart);

  // ── Aggregate (micro-averaged) ─────────────────────────────────────────────
  const sum = (f: (r: (typeof perDomain)[number]) => number) => perDomain.reduce((a, r) => a + f(r), 0);
  const totalExpected = sum((r) => r.expected.attestations);
  const totalProposed = sum((r) => r.extracted.proposed);
  const totalTP = sum((r) => r.counts.truePositives);
  const totalFP = sum((r) => r.counts.falsePositives);
  const totalFN = sum((r) => r.counts.falseNegatives);
  const totalInvalid = sum((r) => r.metrics.invalidCitations);
  const totalExpRef = sum((r) => r.metrics.expectedRefusals);
  const totalCorrectRef = sum((r) => r.metrics.correctRefusals);
  const totalFalseAccept = sum((r) => r.metrics.falseAcceptances);
  const detected = perDomain.filter((r) => r.metrics.divergenceDetected).length;
  const dateCorrect = perDomain.filter((r) => r.metrics.changedDateCorrect).length;
  const falseAlerts = sum((r) => r.metrics.falseDivergenceAlerts);
  const precision = totalTP + totalFP > 0 ? totalTP / (totalTP + totalFP) : 1;
  const recall = totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const latencies = perDomain.map((r) => r.metrics.latencyMs).sort((a, b) => a - b);
  const aggregate = {
    extraction: { precision, recall, f1, truePositives: totalTP, falsePositives: totalFP, falseNegatives: totalFN, gold: totalExpected },
    evidence: { integrity: (totalProposed - totalInvalid) / Math.max(1, totalProposed), invalidCitations: totalInvalid, proposed: totalProposed },
    refusal: {
      expected: totalExpRef,
      correct: totalCorrectRef,
      falseAcceptances: totalFalseAccept,
      recall: totalExpRef > 0 ? totalCorrectRef / totalExpRef : 1,
    },
    divergence: { fireRate: detected / domains.length, detected, missed: domains.length - detected, falseAlerts },
    changedDateAccuracy: detected > 0 ? dateCorrect / detected : 0,
    performance: {
      totalRuntimeMs,
      avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: latencies.length >= 20 ? percentile(latencies, 95) : null,
    },
  };

  // ── Machine-readable JSON (baseline-comparison ready) ──────────────────────
  const timestamp = new Date().toISOString();
  const git = {
    sha: (() => { try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return "unknown"; } })(),
    branch: (() => { try { return execSync("git rev-parse --abbrev-ref HEAD").toString().trim(); } catch { return "unknown"; } })(),
  };
  const json: EvalReport = {
    evaluator: "anansi",
    timestamp,
    git,
    model: { provider, name: modelName },
    config: { domains, runsPerDomain: 1, matchThreshold: 0.5, matcher: "token-overlap" },
    aggregate,
    domains: perDomain,
    failures: perDomain.flatMap((r) => r.failures),
  };

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = timestamp.replace(/[:.]/g, "-");
  const jsonPath = RESULTS_DIR + stamp + "-extraction-eval.json";
  const mdPath = RESULTS_DIR + stamp + "-extraction-eval.md";
  writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  writeFileSync(mdPath, renderMarkdown(json));

  // ── Terminal summary ───────────────────────────────────────────────────────
  console.log(`\nOverall:`);
  console.log(`  Precision: ${pct(precision)}%   Recall: ${pct(recall)}%   F1: ${pct(f1)}%`);
  console.log(`  Evidence integrity: ${pct(aggregate.evidence.integrity)}%   (invalid citations: ${totalInvalid})`);
  console.log(`  Refusal recall: ${pct(aggregate.refusal.recall)}%   (false acceptances: ${totalFalseAccept}/${totalExpRef})`);
  console.log(`  Divergence: ${detected}/${domains.length} detected   false alerts: ${falseAlerts}   changed-date: ${dateCorrect}/${detected}`);
  console.log(`  Latency: avg ${aggregate.performance.avgLatencyMs}ms  p50 ${aggregate.performance.p50LatencyMs}ms  p95 ${aggregate.performance.p95LatencyMs ?? "n/a (<20 samples)"}`);
  const totalFailures = perDomain.flatMap((r) => r.failures).length;
  console.log(`  Failures logged: ${totalFailures}`);
  console.log(`\nwrote ${jsonPath.replace(process.cwd() + "/", "")}`);
  console.log(`wrote ${mdPath.replace(process.cwd() + "/", "")}\n`);

  await closePool();
}

function renderMarkdown(j: EvalReport): string {
  const a = j.aggregate;
  const L: string[] = [];
  L.push(`# Anansi Extraction Evaluation`);
  L.push("");
  L.push(`- **Run:** ${j.timestamp}`);
  L.push(`- **Model:** ${j.model.provider} / ${j.model.name}`);
  L.push(`- **Commit:** \`${j.git.sha.slice(0, 12)}\` (${j.git.branch})`);
  L.push(`- **Evaluator:** ${j.evaluator}`);
  L.push("");
  L.push(`## Dataset`);
  const gold = a.extraction.gold;
  L.push(`${j.config.domains.length} enterprise domains — ${j.config.domains.join(", ")}. ${gold} hand-labeled gold attestations, ${a.refusal.expected} intentional chatter items, ${j.domains.length} planted doc-vs-reality divergences (one per domain). Every oracle quote is a verified verbatim substring of its source.`);
  L.push("");
  L.push(`## Methodology`);
  L.push(`Each domain is run through the same pipeline used in production: chunks are seeded into Postgres, extracted by the model into cited attestations, verified (quotes must be verbatim substrings of their source chunk), ingested append-only, then divergence detection runs over the ledger. Attestations are matched to the oracle by semantic claim-text overlap (threshold ${j.config.matchThreshold}), not exact identifiers. This is a single run per domain; the model is non-deterministic, so treat point values as indicative.`);
  L.push("");
  L.push(`## Results (aggregate)`);
  L.push("");
  L.push(`| Metric | Value |`);
  L.push(`|---|---|`);
  L.push(`| Precision | ${pct(a.extraction.precision)}% |`);
  L.push(`| Recall | ${pct(a.extraction.recall)}% |`);
  L.push(`| F1 | ${pct(a.extraction.f1)}% |`);
  L.push(`| Evidence integrity | ${pct(a.evidence.integrity)}% (invalid citations: ${a.evidence.invalidCitations}) |`);
  L.push(`| Refusal recall | ${pct(a.refusal.recall)}% (false acceptances: ${a.refusal.falseAcceptances}/${a.refusal.expected}) |`);
  L.push(`| Divergence detection | ${a.divergence.detected}/${j.config.domains.length} (false alerts: ${a.divergence.falseAlerts}) |`);
  L.push(`| Changed-date accuracy | ${pct(a.changedDateAccuracy)}% of detected |`);
  L.push(`| Latency (avg / p50) | ${a.performance.avgLatencyMs}ms / ${a.performance.p50LatencyMs}ms |`);
  L.push("");
  L.push(`## Per-domain scorecards`);
  for (const d of j.domains) {
    L.push("");
    L.push(`### ${d.domain}`);
    L.push(`Expected: ${d.expected.attestations} attestations, ${d.expected.refusals} refusals, ${d.expected.divergences} divergence — Extracted: ${d.extracted.attestations} attestations, ${d.extracted.refusals} refusals, ${d.extracted.divergences} divergences`);
    L.push("");
    L.push(`precision ${pct(d.metrics.precision)}% · recall ${pct(d.metrics.recall)}% · F1 ${pct(d.metrics.f1)}% · evidence ${pct(d.metrics.evidenceIntegrity)}% · refusal ${pct(d.metrics.refusalRecall)}% · divergence ${d.metrics.divergenceDetected ? "detected" : "MISSED"}${d.metrics.divergenceDetected ? ` (date ${d.metrics.changedDateCorrect ? "✓" : "✗"})` : ""} · ${d.metrics.latencyMs}ms`);
    L.push(`TP ${d.counts.truePositives} · FP ${d.counts.falsePositives} · FN ${d.counts.falseNegatives}`);
    if (d.failures.length) {
      L.push("");
      L.push(`Failures:`);
      for (const f of d.failures) L.push(`- \`${f.category}\`${f.expectedClaim ? ` expected: "${f.expectedClaim}"` : ""}${f.extractedClaim ? ` extracted: "${f.extractedClaim}"` : ""}`);
    }
  }
  L.push("");
  L.push(`## Strengths`);
  L.push(`- Evidence integrity ${pct(a.evidence.integrity)}%: extracted claims are grounded in verbatim source quotes, not paraphrase.`);
  L.push(`- Divergence detection surfaced ${a.divergence.detected}/${j.config.domains.length} stale-doc-vs-reality gaps with change dates — a capability plain retrieval cannot produce.`);
  L.push(`- Chatter refusal: ${a.refusal.correct}/${a.refusal.expected} non-operational messages correctly excluded.`);
  L.push("");
  L.push(`## Failure cases`);
  const allF = j.failures;
  if (allF.length === 0) L.push(`No failures in this run.`);
  else {
    const byCat: Record<string, number> = {};
    for (const f of allF) byCat[f.category] = (byCat[f.category] ?? 0) + 1;
    for (const [c, n] of Object.entries(byCat)) L.push(`- **${c}**: ${n}`);
    L.push("");
    L.push(`See the JSON artifact for the full inspectable list (extracted claim, expected claim, citation, source chunk).`);
  }
  L.push("");
  return L.join("\n");
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
