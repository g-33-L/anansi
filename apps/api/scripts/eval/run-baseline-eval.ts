// Documentation / RAG-over-docs baseline evaluator (Priority 4).
//
//   pnpm --filter @anansi/api eval:baseline
//
// The honest status-quo alternative to Anansi is "read the wiki/runbook" — which
// is what doc-search and RAG-over-docs return. This scores that baseline over the
// SAME enterprise dataset, deterministically (no model, no embeddings): it can
// only surface facts that are written down, and having no temporal model it
// cannot detect that a doc has gone stale. It emits the same-shaped JSON as the
// Anansi harness (evaluator: "docs-baseline") so the two are directly comparable,
// and prints a head-to-head against the most recent Anansi run if one exists.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { scoreDocsBaseline } from "../../src/lib/ai/extraction-eval.js";

const FIX_DIR = fileURLToPath(new URL("./fixtures/enterprise/", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("./results/", import.meta.url));

function pct(n: number): number {
  return Math.round(n * 1000) / 10;
}

const domains = readdirSync(FIX_DIR).filter((d) => existsSync(FIX_DIR + d + "/expected_attestations.json")).sort();

const perDomain = domains.map((domain) => {
  const j = (f: string) => JSON.parse(readFileSync(FIX_DIR + domain + "/" + f, "utf8"));
  const docs = j("notion_docs.json").docs as Array<{ blocks: Array<{ id: string }> }>;
  const oracle = j("expected_attestations.json");
  const docIds = new Set<string>();
  for (const doc of docs) for (const b of doc.blocks) docIds.add(b.id);
  const s = scoreDocsBaseline(oracle, (id) => docIds.has(id));
  return { domain, ...s };
});

const sum = (f: (r: (typeof perDomain)[number]) => number) => perDomain.reduce((a, r) => a + f(r), 0);
const goldTotal = sum((r) => r.goldTotal);
const documentedGold = sum((r) => r.documentedGold);
const divergences = sum((r) => r.divergences);
const aggregate = {
  coverage: goldTotal > 0 ? documentedGold / goldTotal : 0,
  documentedGold,
  goldTotal,
  divergences,
  staleUnderDrift: sum((r) => r.staleUnderDrift),
  driftDetected: sum((r) => r.driftDetected),
};

const timestamp = new Date().toISOString();
const git = {
  sha: (() => { try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return "unknown"; } })(),
  branch: (() => { try { return execSync("git rev-parse --abbrev-ref HEAD").toString().trim(); } catch { return "unknown"; } })(),
};
const json = { evaluator: "docs-baseline", timestamp, git, model: { provider: "none", name: "documentation-only" }, config: { domains }, aggregate, domains: perDomain };

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
const path = RESULTS_DIR + timestamp.replace(/[:.]/g, "-") + "-baseline-eval.json";
writeFileSync(path, JSON.stringify(json, null, 2));

console.log(`\nDOCUMENTATION BASELINE (RAG-over-docs) — ${domains.length} domains\n`);
for (const r of perDomain) {
  console.log(`  ${r.domain.padEnd(22)} coverage ${pct(r.coverage)}%  drift-detected ${r.driftDetected}/${r.divergences}  stale-answers ${r.staleUnderDrift}/${r.divergences}`);
}
console.log(`\nBaseline overall:`);
console.log(`  Coverage of operational reality: ${pct(aggregate.coverage)}%  (${documentedGold}/${goldTotal} facts are documented)`);
console.log(`  Drift detection: ${aggregate.driftDetected}/${divergences}  (documentation has no temporal model)`);
console.log(`  Stale answers under drift: ${aggregate.staleUnderDrift}/${divergences}  (the doc is wrong wherever practice changed)`);

// Head-to-head against the latest Anansi run, if present.
const anansiFiles = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith("-extraction-eval.json")).sort() : [];
if (anansiFiles.length > 0) {
  const a = JSON.parse(readFileSync(RESULTS_DIR + anansiFiles[anansiFiles.length - 1], "utf8"));
  console.log(`\nHEAD-TO-HEAD (Anansi ${a.model.provider}/${a.model.name} vs docs baseline):`);
  console.log(`  Coverage of operational reality:  Anansi ${pct(a.aggregate.extraction.recall)}%   vs   docs ${pct(aggregate.coverage)}%`);
  console.log(`  Drift detection:                  Anansi ${a.aggregate.divergence.detected}/${divergences}   vs   docs 0/${divergences}`);
  console.log(`  Current-state correct under drift: Anansi ${a.aggregate.divergence.detected}/${divergences}   vs   docs 0/${divergences}`);
} else {
  console.log(`\n(no Anansi run found in results/ — run \`pnpm eval:extraction\` first for the head-to-head)`);
}
console.log(`\nwrote ${path.replace(process.cwd() + "/", "")}\n`);
