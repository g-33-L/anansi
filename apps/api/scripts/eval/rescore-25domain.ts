// Deterministic re-scorer: replays saved parsedExtraction artifacts against the
// current oracle files and current evaluator. No model calls — isolates the impact
// of evaluator + oracle changes from model nondeterminism.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scoreProcedureGraph, type MetricValue, type ProcedureGraphScore, type ProcedureOracle, type ProcedureSource } from '../../src/lib/ai/procedure-eval.js';
import type { ExtractedProcedure } from '../../src/lib/ai/skill-extraction.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/enterprise_procedures/', import.meta.url));
const artifactPath = fileURLToPath(new URL('./results/2026-07-22T13-46-56-698Z-procedure-eval.json', import.meta.url));
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

type ExtractionResult = ExtractedProcedure | { refused: true; reason: string };
type SavedDomainResult = ProcedureGraphScore & {
  domain: string;
  parsedExtraction: ExtractionResult;
  parsedRefusalTrapResults: ExtractionResult[];
};
type SavedReport = { results: SavedDomainResult[] };
type Material = { docs: Array<{ id: string; last_edited?: string; blocks: Array<{ id: string; text: string }> }>; messages: Array<{ id: string; text: string; ts?: string }> };

const METRIC_KEYS = [
  'stepPrecision', 'stepRecall', 'stepF1', 'dependencyPrecision', 'dependencyRecall', 'dependencyF1', 'dependencyPrecisionClosure',
  'conditionalLogicAccuracy', 'gateAccuracy', 'deadlineAccuracy', 'roleAttributionAccuracy',
  'evidenceCitationF1', 'parallelismPreservation', 'falseAcceptanceRate',
] as const;

type MetricKey = typeof METRIC_KEYS[number];

const fmt = (v: MetricValue) => v === null ? 'N/A   ' : `${(v * 100).toFixed(1)}%`;

function aggregate(results: ProcedureGraphScore[], key: MetricKey) {
  const values = results.map(r => r[key as keyof ProcedureGraphScore]).filter((v): v is number => v !== null);
  return { value: values.length ? values.reduce((s, v) => s + v, 0) / values.length : null, measured: values.length, total: results.length };
}

function loadSources(domain: string): ProcedureSource[] {
  const m = readJson<Material>(`${fixtureRoot}${domain}/source_material.json`);
  return [
    ...m.docs.flatMap(doc => doc.blocks.map(b => ({ id: b.id, text: b.text, source: 'document' as const, recordedAt: doc.last_edited }))),
    ...m.messages.map(msg => ({ id: msg.id, text: msg.text, source: 'slack' as const, recordedAt: msg.ts })),
  ];
}

const saved = readJson<SavedReport>(artifactPath);

console.log('\nDETERMINISTIC RE-SCORE — same model outputs, updated oracle + evaluator');
console.log('Artifact: 2026-07-22T13-46-56-698Z-procedure-eval.json (gpt-oss-120b via Cerebras, 25 domains)\n');

const rescored: ProcedureGraphScore[] = [];

for (const prev of saved.results) {
  const oracle = readJson<ProcedureOracle>(`${fixtureRoot}${prev.domain}/oracle_procedure.json`);
  const sources = loadSources(prev.domain);
  const score = scoreProcedureGraph(prev.parsedExtraction, oracle, sources, prev.parsedRefusalTrapResults);
  rescored.push(score);

  const changed = METRIC_KEYS.some(k => {
    const oldVal = prev[k as keyof ProcedureGraphScore] as MetricValue;
    const newVal = score[k as keyof ProcedureGraphScore] as MetricValue;
    return oldVal !== newVal;
  });

  if (changed) {
    process.stdout.write(`  ${prev.domain.padEnd(36)}`);
    for (const k of ['conditionalLogicAccuracy', 'gateAccuracy', 'deadlineAccuracy'] as MetricKey[]) {
      const oldVal = prev[k as keyof ProcedureGraphScore] as MetricValue;
      const newVal = score[k as keyof ProcedureGraphScore] as MetricValue;
      if (oldVal !== newVal) process.stdout.write(`  ${k}: ${fmt(oldVal)} → ${fmt(newVal)}`);
    }
    console.log();
  }
}

console.log('\nAggregate (old → new):');
for (const k of METRIC_KEYS) {
  const saved_agg = (() => {
    const vals = saved.results.map(r => r[k as keyof ProcedureGraphScore] as MetricValue).filter((v): v is number => v !== null);
    return { value: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null, measured: vals.length };
  })();
  const new_agg = aggregate(rescored, k);
  const changed = saved_agg.value !== new_agg.value;
  const marker = changed ? ' ◄' : '';
  console.log(`  ${k.padEnd(32)} ${fmt(saved_agg.value).padStart(6)} [${saved_agg.measured}/25] → ${fmt(new_agg.value).padStart(6)} [${new_agg.measured}/25]${marker}`);
}
