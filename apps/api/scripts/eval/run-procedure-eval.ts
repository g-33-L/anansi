// Evaluation-only benchmark for the current skill-extraction contract.
// It intentionally does not modify prompts, parsing, or validation boundaries.
//
// PHASE C PHILOSOPHY: typed graph fields are scored directly when the extractor
// emits them. Legacy prose-only output uses a clearly labelled projection fallback
// so historical scorecards remain comparable. N/A metrics are omitted from averages,
// and coverage counts show exactly what was measured directly.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { getDeploymentConfig } from '../../src/lib/config/deployment.js';
import { resolveLlmProvider } from '../../src/lib/ai/llm.js';
import { extractProcedure, type ExtractedProcedure } from '../../src/lib/ai/skill-extraction.js';
import { scoreProcedureGraph, type MetricValue, type ProcedureGraphScore, type ProcedureOracle, type ProcedureSource } from '../../src/lib/ai/procedure-eval.js';

const fixtureRoot = fileURLToPath(new URL('./fixtures/enterprise_procedures/', import.meta.url));
const manifestPath = fileURLToPath(new URL('./fixtures/enterprise_procedures/fixture_manifest.json', import.meta.url));
const resultsRoot = fileURLToPath(new URL('./results/', import.meta.url));
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

type Material = { docs: Array<{ id: string; last_edited?: string; blocks: Array<{ id: string; text: string }> }>; messages: Array<{ id: string; text: string; ts?: string }> };
type FixtureSplit = 'calibration' | 'holdout';
type FixtureManifest = { schemaVersion: 1; domains: Array<{ id: string; split: FixtureSplit; archetypes: string[] }> };
type ExtractionResult = ExtractedProcedure | { refused: true; reason: string };
type DomainResult = ProcedureGraphScore & {
  domain: string;
  fixture: { split: FixtureSplit; inputHash: string };
  // Saved locally (the results directory is gitignored) so every score can be
  // replayed and audited against the exact parsed extractor output.
  parsedExtraction: ExtractionResult;
  parsedRefusalTrapResults: ExtractionResult[];
};
type MetricKey = {
  [K in keyof ProcedureGraphScore]: ProcedureGraphScore[K] extends MetricValue ? K : never
}[keyof ProcedureGraphScore];

// Aggregated (headline) metrics only. divergenceCitationRecencyProxy is deliberately
// EXCLUDED from the aggregate (H6): it is a degenerate, coincidence-driven proxy (all
// fixtures have documentedStepId == observedStepId and no oracle step cites the slack
// "correction"), so averaging it into the headline gave uncontrolled noise equal visual
// weight. It stays in each domain's full result JSON for research, just not in the ruler.
const METRIC_KEYS: MetricKey[] = [
  'stepPrecision', 'stepRecall', 'stepF1', 'dependencyPrecision', 'dependencyRecall', 'dependencyF1', 'dependencyPrecisionClosure',
  'conditionalLogicAccuracy', 'gateAccuracy', 'deadlineAccuracy', 'roleAttributionAccuracy', 'evidenceCitationF1',
  'parallelismPreservation', 'falseAcceptanceRate',
];

function load(domain: string): { oracle: ProcedureOracle; sources: ProcedureSource[] } {
  const base = `${fixtureRoot}${domain}/`;
  const material = readJson<Material>(`${base}source_material.json`);
  const sources: ProcedureSource[] = [
    ...material.docs.flatMap(doc => doc.blocks.map(block => ({ id: block.id, text: block.text, source: 'document' as const, recordedAt: doc.last_edited }))),
    ...material.messages.map(message => ({ id: message.id, text: message.text, source: 'slack' as const, recordedAt: message.ts })),
  ];
  return { oracle: readJson<ProcedureOracle>(`${base}oracle_procedure.json`), sources };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function loadFixtureManifest(): FixtureManifest {
  const manifest = readJson<unknown>(manifestPath);
  if (typeof manifest !== 'object' || manifest === null || (manifest as { schemaVersion?: unknown }).schemaVersion !== 1 || !Array.isArray((manifest as { domains?: unknown }).domains) || (manifest as { domains: unknown[] }).domains.length === 0) {
    throw new Error('Invalid enterprise procedure fixture manifest');
  }
  const domains = (manifest as { domains: unknown[] }).domains;
  if (domains.some(domain => {
    if (typeof domain !== 'object' || domain === null) return true;
    const entry = domain as { id?: unknown; split?: unknown; archetypes?: unknown };
    return typeof entry.id !== 'string' || entry.id.length === 0 ||
      (entry.split !== 'calibration' && entry.split !== 'holdout') ||
      !Array.isArray(entry.archetypes) || entry.archetypes.length === 0 ||
      entry.archetypes.some(archetype => typeof archetype !== 'string' || archetype.length === 0);
  })) throw new Error('Invalid enterprise procedure fixture manifest domain entry');
  const typed = manifest as FixtureManifest;
  const ids = typed.domains.map(domain => domain.id);
  if (new Set(ids).size !== ids.length) throw new Error('Enterprise procedure fixture manifest contains duplicate domain IDs');
  const fixtureDirectories = readdirSync(fixtureRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (JSON.stringify(ids.slice().sort()) !== JSON.stringify(fixtureDirectories)) {
    throw new Error('Enterprise procedure fixture manifest and fixture directories disagree');
  }
  return typed;
}

function selectedDomains(manifest: FixtureManifest): Array<{ id: string; split: FixtureSplit }> {
  const requested = process.env.EVAL_PROCEDURE_SPLIT ?? 'all';
  if (requested !== 'all' && requested !== 'calibration' && requested !== 'holdout') {
    throw new Error('EVAL_PROCEDURE_SPLIT must be all, calibration, or holdout');
  }
  const requestedIds = process.env.EVAL_PROCEDURE_DOMAINS?.split(',').map(id => id.trim()).filter(Boolean);
  const knownIds = new Set(manifest.domains.map(domain => domain.id));
  if (requestedIds?.some(id => !knownIds.has(id))) {
    throw new Error('EVAL_PROCEDURE_DOMAINS contains an unknown domain ID');
  }
  return manifest.domains
    .filter(domain => requested === 'all' || domain.split === requested)
    .filter(domain => requestedIds === undefined || requestedIds.includes(domain.id))
    .map(({ id, split }) => ({ id, split }));
}

function modelConfig() {
  const deployment = getDeploymentConfig();
  const provider = resolveLlmProvider(deployment);
  const model = provider === 'cerebras'
    ? process.env.CEREBRAS_SYNTHESIS_MODEL ?? 'gpt-oss-120b'
    : provider === 'github'
      ? process.env.GITHUB_MODELS_SYNTHESIS_MODEL ?? 'gpt-4o-mini'
      : process.env.OLLAMA_LLM_MODEL ?? 'llama3.1:8b';
  return { deploymentMode: deployment.mode, inferenceLocation: deployment.inference, provider, model };
}

// Mean over domains where the metric was actually measured (non-null). Reports
// how many domains contributed so a partially-covered metric can't masquerade
// as a full-corpus result.
function aggregate(results: DomainResult[], key: MetricKey): { value: MetricValue; measuredDomains: number; totalDomains: number } {
  const values = results.map(result => result[key]).filter((value): value is number => value !== null);
  return { value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, measuredDomains: values.length, totalDomains: results.length };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Cerebras (and other hosted providers) enforce a tokens-per-minute quota. A bare
// run crashes on the first 429 and writes no results. Retry the extraction with
// exponential backoff on rate-limit / transient errors so a full 5-domain scorecard
// completes. Scoring is untouched — this only governs when we call the model.
async function extractWithRetry(input: Parameters<typeof extractProcedure>[0], attempts = 5): Promise<Awaited<ReturnType<typeof extractProcedure>>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await extractProcedure(input);
    } catch (error) {
      const message = error instanceof Error
        ? error.message + (error.cause instanceof Error ? ' ' + error.cause.message : '')
        : String(error);
      const retryable = /429|too_many_tokens|token_quota_exceeded|rate.?limit|quota|5\d\d|fetch failed|ECONNRESET|EADDRNOTAVAIL|ETIMEDOUT|TimeoutError|aborted/i.test(message);
      if (!retryable || attempt >= attempts - 1) throw error;
      const waitMs = Math.min(60_000, 5_000 * 2 ** attempt);
      process.stdout.write(`[rate-limited, waiting ${Math.round(waitMs / 1000)}s] `);
      await sleep(waitMs);
    }
  }
}

async function runDomain(domain: string, split: FixtureSplit): Promise<DomainResult> {
  const { oracle, sources } = load(domain);
  const trapIds = new Set(oracle.refusalTraps.map(trap => trap.sourceChunkId));
  const extraction = await extractWithRetry({ domain, chunks: sources.filter(source => !trapIds.has(source.id)).map(({ id, text }) => ({ id, text })) });
  const trapResults: ExtractionResult[] = [];
  for (const trap of oracle.refusalTraps) {
    const source = sources.find(candidate => candidate.id === trap.sourceChunkId)!;
    trapResults.push(await extractWithRetry({ domain, chunks: [{ id: source.id, text: source.text }] }));
  }
  return {
    ...scoreProcedureGraph(extraction, oracle, sources, trapResults),
    domain,
    fixture: { split, inputHash: hash({ oracle, sources }) },
    parsedExtraction: extraction,
    parsedRefusalTrapResults: trapResults,
  };
}

const fmt = (value: MetricValue): string => value === null ? 'N/A' : `${(value * 100).toFixed(1)}%`;

async function main() {
  const manifest = loadFixtureManifest();
  const domains = selectedDomains(manifest);
  if (domains.length === 0) throw new Error('No enterprise procedure fixtures selected');
  const results: DomainResult[] = [];
  console.log(`\nANANSI ENTERPRISE PROCEDURE EVAL (projection v3) — ${domains.length} domains`);
  console.log(`Structured graph fields are scored directly when emitted; legacy prose-only fields use a projection fallback.\n`);
  // Daily provider quotas regularly kill multi-domain runs mid-corpus; without
  // incremental persistence every completed domain's artifacts die with the
  // process. Overwrite a partial file after each domain so a crashed run can be
  // resumed (EVAL_PROCEDURE_DOMAINS) and merged instead of repeated.
  if (!existsSync(resultsRoot)) mkdirSync(resultsRoot, { recursive: true });
  const partialPath = `${resultsRoot}${new Date().toISOString().replace(/[:.]/g, '-')}-procedure-eval.partial.json`;
  for (const [index, domain] of domains.entries()) {
    if (index > 0) await sleep(Number(process.env.EVAL_DOMAIN_DELAY_MS ?? 20_000)); // stay under tokens-per-minute quota
    process.stdout.write(`  ${domain.id} ... `);
    const result = await runDomain(domain.id, domain.split); results.push(result);
    console.log(`step F1 ${fmt(result.stepF1)} dep F1 ${fmt(result.dependencyF1)} (aligned ${result.coverage.alignedSteps}/${result.coverage.oracleSteps})`);
    writeFileSync(partialPath, JSON.stringify({ partial: true, model: modelConfig(), results }, null, 2));
  }

  const aggregateMetrics = Object.fromEntries(METRIC_KEYS.map(key => [key, aggregate(results, key)])) as Record<MetricKey, ReturnType<typeof aggregate>>;
  const report = {
    evaluator: 'anansi-procedure-eval-projection-v3',
    projection: {
      contract: 'ExtractedProcedure (grounded step descriptions/evidence/precedes plus optional typed roles, predicates, branches, deadlines, and parallel groups)',
      notice: 'Typed graph fields are scored directly whenever the extractor emits them. Legacy prose-only fields use a projection fallback; structured* coverage counts identify direct measurement. Metrics with zero oracle targets are reported N/A and excluded from averages.',
      divergenceCitationRecencyProxy: 'PROXY ONLY — not skill-extraction divergence detection; measures whether a matched observed step cites a slack source dated at/after the divergence.',
    },
    timestamp: new Date().toISOString(),
    git: {
      sha: execSync('git rev-parse HEAD').toString().trim(),
      branch: execSync('git branch --show-current').toString().trim(),
      dirty: execSync('git status --porcelain').toString().trim() !== '',
    },
    model: modelConfig(),
    runConfig: {
      split: process.env.EVAL_PROCEDURE_SPLIT ?? 'all',
      domainFilter: process.env.EVAL_PROCEDURE_DOMAINS ?? null,
      interDomainDelayMs: Number(process.env.EVAL_DOMAIN_DELAY_MS ?? 20_000),
      retryAttempts: 5,
      fixtureManifestHash: hash(manifest),
      parsedOutputRetention: 'local-only; results directory is gitignored',
    },
    domains: domains.map(domain => domain.id),
    aggregate: aggregateMetrics,
    results,
  };
  const output = `${resultsRoot}${report.timestamp.replace(/[:.]/g, '-')}-procedure-eval.json`;
  writeFileSync(output, JSON.stringify(report, null, 2));
  rmSync(partialPath, { force: true }); // superseded by the complete report

  console.log(`\nAggregate (measured domains / total):`);
  for (const key of METRIC_KEYS) {
    const entry = aggregateMetrics[key];
    console.log(`  ${key.padEnd(32)} ${fmt(entry.value).padStart(6)}   [${entry.measuredDomains}/${entry.totalDomains} domains]`);
  }
  console.log(`\nProjection notice: ${report.projection.notice}`);
  console.log(`wrote ${output.replace(process.cwd(), '.')}`);
}
main().catch(error => { console.error(error); process.exit(1); });
