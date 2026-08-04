// Scientifically-fair model benchmark for skill extraction.
//
// Usage: SKILL_BENCHMARK_PROVIDERS=ollama,cerebras SKILL_BENCHMARK_REPS=3
//   pnpm --filter @anansi/api eval:skills:benchmark
//
// Methodology (see benchmark-stats.ts and the assumptions block in the report):
//   * The statistical unit is the evaluation DOMAIN. Uncertainty is reported as a
//     two-sided 95% t confidence interval across domains — NOT the spread of
//     repeated temperature=0 runs, which is near-zero and misleading.
//   * Each per-domain score is the mean of SKILL_BENCHMARK_REPS repetitions, only
//     to average residual provider nondeterminism at temperature 0.
//   * Model-vs-model uses a PAIRED t-test on per-domain deltas (same domains per
//     model), which controls for domain difficulty.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scoreProcedure, type ProcedureScore, type SkillOracle } from '../../src/lib/ai/skill-eval.js';
import { benchmarkModelsFromEnv, createBenchmarkClient, extractWithBenchmarkClient, structuredOutputMode, BENCHMARK_MAX_OUTPUT_TOKENS, type BenchmarkClient, type BenchmarkModel } from './skill-benchmark-client.js';
import { summarize, pairedComparison, type Summary } from './benchmark-stats.js';

const FIX_DIR = fileURLToPath(new URL('./fixtures/skills/', import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL('./results/', import.meta.url));
type Chunk = { id: string; text: string };
const QUALITY_METRICS = ['precision', 'recall', 'f1', 'criticalStepRecall', 'evidenceGrounding', 'orderingCorrectness', 'refusalDecisionAccuracy'] as const;
const METRICS = [...QUALITY_METRICS, 'latencyMs'] as const;
type Metric = (typeof METRICS)[number];
type DomainScore = Record<Metric, number>;

function loadFixture(domain: string): { oracle: SkillOracle; chunks: Chunk[] } {
  const read = (name: string) => JSON.parse(readFileSync(`${FIX_DIR}${domain}/${name}`, 'utf8'));
  const oracle = read('oracle_skill.json') as SkillOracle;
  const source = existsSync(`${FIX_DIR}${domain}/source_material.json`)
    ? read('source_material.json')
    : { docs: read('source_docs.json').docs, messages: read('source_slack.json').messages };
  return {
    oracle,
    chunks: [
      ...(source.docs ?? []).flatMap((doc: { blocks: Chunk[] }) => doc.blocks),
      ...(source.messages ?? []).map((message: Chunk) => ({ id: message.id, text: message.text })),
    ],
  };
}

function pct(value: number): string { return `${(value * 100).toFixed(1)}%`; }

// One extraction + scoring pass over a single domain (main procedure + refusal chunks).
async function scoreDomainOnce(client: BenchmarkClient, domain: string): Promise<DomainScore> {
  const { oracle, chunks } = loadFixture(domain);
  const refusalIds = new Set(oracle.expectedRefusals.map((refusal) => refusal.sourceChunkId));
  const started = performance.now();
  const main = await extractWithBenchmarkClient(client, { domain, chunks: chunks.filter((chunk) => !refusalIds.has(chunk.id)) });
  const score: ProcedureScore = scoreProcedure(main, oracle, false);
  for (const refusalId of refusalIds) {
    const chunk = chunks.find((candidate) => candidate.id === refusalId);
    if (!chunk) throw new Error(`Fixture ${domain} references missing refusal chunk ${refusalId}`);
    const refusalScore = scoreProcedure(await extractWithBenchmarkClient(client, { domain, chunks: [chunk] }), oracle, true);
    score.details.correctRefusals += refusalScore.details.correctRefusals;
    score.details.falseAcceptances += refusalScore.details.falseAcceptances;
    score.details.falsePositives.push(...refusalScore.details.falsePositives);
  }
  // Recompute the metrics that fold in refusal-chunk false positives, matching the
  // canonical harness. Scoring itself (evidence grounding, ordering, criticality)
  // comes straight from the shared, audited scorer.
  score.falsePositives = score.details.falsePositives.length;
  score.precision = score.truePositives + score.falsePositives > 0 ? score.truePositives / (score.truePositives + score.falsePositives) : 0;
  score.f1 = score.precision + score.recall > 0 ? (2 * score.precision * score.recall) / (score.precision + score.recall) : 0;
  const refusalDecisionAccuracy = ((score.details.falseRefusals === 0 ? 1 : 0) + score.details.correctRefusals) / (1 + refusalIds.size);
  return {
    precision: score.precision, recall: score.recall, f1: score.f1,
    criticalStepRecall: score.criticalStepRecall, evidenceGrounding: score.evidenceGrounding, orderingCorrectness: score.orderingCorrectness,
    refusalDecisionAccuracy, latencyMs: Math.round(performance.now() - started),
  };
}

// Per-domain score = mean over `reps` repetitions (averages residual temp=0 nondeterminism).
async function scoreModelPerDomain(model: BenchmarkModel, domains: string[], reps: number): Promise<Record<string, DomainScore>> {
  const client = createBenchmarkClient(model);
  const perDomain: Record<string, DomainScore> = {};
  for (const domain of domains) {
    const runs: DomainScore[] = [];
    for (let rep = 1; rep <= reps; rep++) {
      process.stdout.write(`  ${model.provider}/${model.name} ${domain} rep ${rep}/${reps} ... `);
      const score = await scoreDomainOnce(client, domain);
      runs.push(score);
      console.log(`F1 ${pct(score.f1)}  ${score.latencyMs}ms`);
    }
    perDomain[domain] = Object.fromEntries(
      METRICS.map((metric) => [metric, runs.reduce((sum, run) => sum + run[metric], 0) / runs.length])
    ) as DomainScore;
  }
  return perDomain;
}

async function main(): Promise<void> {
  const reps = Number(process.env.SKILL_BENCHMARK_REPS ?? '3');
  if (!Number.isInteger(reps) || reps < 1 || reps > 50) throw new Error('SKILL_BENCHMARK_REPS must be an integer from 1 through 50.');
  const domains = readdirSync(FIX_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const models = benchmarkModelsFromEnv();

  const perModel: Array<{ model: BenchmarkModel; structuredOutput: string; perDomain: Record<string, DomainScore>; stats: Record<Metric, Summary> }> = [];
  for (const model of models) {
    console.log(`\n${model.provider}/${model.name}: ${reps} rep(s) x ${domains.length} domains`);
    const perDomain = await scoreModelPerDomain(model, domains, reps);
    const stats = Object.fromEntries(
      METRICS.map((metric) => [metric, summarize(domains.map((domain) => perDomain[domain][metric]))])
    ) as Record<Metric, Summary>;
    perModel.push({ model, structuredOutput: structuredOutputMode(model.provider), perDomain, stats });
  }

  // Paired model-vs-model comparison on each quality metric, across domains.
  const pairwise: Array<Record<string, unknown>> = [];
  for (let i = 0; i < perModel.length; i++) {
    for (let j = i + 1; j < perModel.length; j++) {
      const a = perModel[i];
      const b = perModel[j];
      for (const metric of QUALITY_METRICS) {
        const test = pairedComparison(
          domains.map((domain) => a.perDomain[domain][metric]),
          domains.map((domain) => b.perDomain[domain][metric])
        );
        pairwise.push({ metric, a: `${a.model.provider}/${a.model.name}`, b: `${b.model.provider}/${b.model.name}`, ...test });
      }
    }
  }

  const assumptions = [
    `Statistical unit is the evaluation domain (n=${domains.length}); uncertainty is a two-sided 95% Student-t confidence interval across domains.`,
    `Small n means wide intervals — results are directional, not definitive. Add domains to tighten them.`,
    `Each per-domain score is the mean of ${reps} repetition(s) at temperature 0, used only to average residual provider nondeterminism (not treated as independent samples).`,
    `Model-vs-model uses a paired two-sided t-test on per-domain score differences (same domains per model), controlling for domain difficulty; significance threshold p<0.05.`,
    `Fairness: all providers share prompt, strict parser, temperature 0, and a ${BENCHMARK_MAX_OUTPUT_TOKENS}-token output ceiling.`,
    `Structured output is native for ollama/cerebras/gemini; Claude uses assistant-prefill '{' because the Anthropic Messages API (2023-06-01) has no response_format — the one residual provider asymmetry.`,
    `The benchmark runs temperature=0 + JSON-constrained output, which differs from the production llm.ts configuration; numbers characterize an idealized decoding setup, not shipped behavior.`,
    `Fixtures are synthetic; selecting non-local providers sends fixture text to those external APIs.`,
  ];

  const report = {
    evaluator: 'anansi-skill-model-benchmark-v2',
    timestamp: new Date().toISOString(),
    git: { sha: execSync('git rev-parse HEAD').toString().trim(), branch: execSync('git branch --show-current').toString().trim() },
    config: { repsPerDomain: reps, domains, statisticalUnit: 'domain', confidence: 0.95, comparison: 'paired two-sided t-test', maxOutputTokens: BENCHMARK_MAX_OUTPUT_TOKENS },
    assumptions,
    models: perModel.map((entry) => ({ model: entry.model, structuredOutput: entry.structuredOutput, stats: entry.stats, perDomain: entry.perDomain })),
    pairwise,
  };

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const path = `${RESULTS_DIR}${report.timestamp.replace(/[:.]/g, '-')}-skill-model-benchmark.json`;
  writeFileSync(path, JSON.stringify(report, null, 2));

  console.log(`\nwrote ${path.replace(process.cwd(), '.')}\n`);
  for (const entry of perModel) {
    const f1 = entry.stats.f1;
    console.log(`${entry.model.provider}/${entry.model.name}: F1 ${pct(f1.mean)}  95% CI [${pct(f1.ciLow)}, ${pct(f1.ciHigh)}]  (n=${f1.n} domains)`);
  }
  for (const row of pairwise.filter((row) => row.metric === 'f1')) {
    const verdict = row.significant ? 'significant' : 'not significant';
    console.log(`  F1: ${row.a} vs ${row.b}  Δ=${pct(row.meanDiff as number)}  p=${(row.p as number).toFixed(3)}  (${verdict}, paired t, df=${row.df})`);
  }
  console.log(`\nAssumptions (also in report):`);
  for (const assumption of assumptions) console.log(`  - ${assumption}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
