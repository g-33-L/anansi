// Anansi skill/procedure extraction evaluation harness.
//
//   pnpm --filter @anansi/api eval:skills
//
// Discovers every domain under scripts/eval/fixtures/skills/*, runs the LLM-backed
// extraction pipeline, scores against the hand-labeled skill oracle, and emits
// a summary report.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { extractProcedure } from '../../src/lib/ai/skill-extraction.js';
import { scoreProcedure, ProcedureScore } from '../../src/lib/ai/skill-eval.js';
import { getDeploymentConfig } from '../../src/lib/config/deployment.js';
import { resolveLlmProvider } from '../../src/lib/ai/llm.js';

const FIX_DIR = fileURLToPath(new URL('./fixtures/skills/', import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL('./results/', import.meta.url));

// --- Type Definitions ---
type OracleStep = {
  stepId: string;
  description: string;
  evidence: string[];
  critical?: boolean;
  precedes?: string[];
  temporalConstraints?: {
    validUntil?: string;
  };
};

interface SkillOracle {
  skillName: string;
  expectedProcedure: {
    steps: OracleStep[];
  };
  expectedRefusals: Array<{ sourceChunkId: string; reason: string }>;
}

interface SourceDoc {
  id: string;
  title?: string;
  last_edited?: string;
  blocks: Array<{ id: string; text: string }>;
}

interface SourceSlack {
  id: string;
  text: string;
  channel?: string;
  ts?: string;
}

type FixtureChunk = { id: string; text: string; source: 'document' | 'slack'; recordedAt?: string };

type DomainResult = {
  domain: string;
  metrics: ProcedureScore & { latencyMs: number };
};

// --- Main Logic ---

function loadFixture(domain: string): { oracle: SkillOracle; chunks: FixtureChunk[] } {
  const j = (f: string) => JSON.parse(readFileSync(FIX_DIR + domain + '/' + f, 'utf8'));
  const oracle = j('oracle_skill.json');
  // Handle the case where the file might not exist from the previous turn's refactor
  const sources = existsSync(FIX_DIR + domain + '/source_material.json') ? j('source_material.json') : { docs: j('source_docs.json').docs, messages: j('source_slack.json').messages };
  const docs: SourceDoc[] = sources.docs ?? [];
  const slack: SourceSlack[] = sources.messages ?? [];

  const chunks = [
    ...docs.flatMap((doc) => doc.blocks.map((block) => ({ id: block.id, text: block.text, source: 'document' as const, recordedAt: doc.last_edited }))),
    ...slack.map((msg) => ({ id: msg.id, text: msg.text, source: 'slack' as const, recordedAt: msg.ts })),
  ];
  const ids = new Set<string>();
  for (const chunk of chunks) {
    if (ids.has(chunk.id)) throw new Error(`Duplicate fixture chunk id ${chunk.id} in ${domain}`);
    ids.add(chunk.id);
  }
  for (const refusal of oracle.expectedRefusals) {
    if (!ids.has(refusal.sourceChunkId)) throw new Error(`Unknown refusal chunk ${refusal.sourceChunkId} in ${domain}`);
  }
  return { oracle, chunks };
}


function pct(n: number): number {
  return Math.round(n * 1000) / 10;
}

async function runDomain(domain: string): Promise<DomainResult> {
  const { oracle, chunks } = loadFixture(domain);
  
  // Identify chunks that are expected to be refused
  const refusalChunks = new Set(oracle.expectedRefusals.map(r => r.sourceChunkId));
  const mainChunks = chunks.filter(c => !refusalChunks.has(c.id));
  
  const t0 = performance.now();
  
  // Run on main procedural content
  const extractedProcedure = await extractProcedure({ domain, chunks: mainChunks.map(({ id, text }) => ({ id, text })) });
  const mainScore = scoreProcedure(extractedProcedure, oracle, false);

  // Run on refusal cases
  for (const refusalChunkId of refusalChunks) {
      const refusalChunk = chunks.find(c => c.id === refusalChunkId);
      if(refusalChunk) {
        const refusalExtraction = await extractProcedure({ domain, chunks: [{ id: refusalChunk.id, text: refusalChunk.text }] });
        const refusalScore = scoreProcedure(refusalExtraction, oracle, true);
        mainScore.details.correctRefusals += refusalScore.details.correctRefusals;
        mainScore.details.falseAcceptances += refusalScore.details.falseAcceptances;
        // A false acceptance means the model extracted steps from non-procedural
        // chatter. Those are genuine false positives and must count against precision,
        // otherwise precision can read 100% while the model hallucinated procedures.
        mainScore.details.falsePositives.push(...refusalScore.details.falsePositives);
      }
  }

  // Score the actual classification decisions: one valid procedure must be
  // accepted, and each known chatter chunk must be refused.
  const totalRefusalCases = oracle.expectedRefusals.length;
  const validProcedureAccepted = mainScore.details.falseRefusals === 0 ? 1 : 0;
  mainScore.refusalRecall = (validProcedureAccepted + mainScore.details.correctRefusals) / (1 + totalRefusalCases);

  // Recompute precision/F1 now that false-acceptance steps have been folded into the
  // false-positive set. The tp/fn tallies from the main extraction are unchanged.
  const tp = mainScore.truePositives;
  const fp = mainScore.details.falsePositives.length;
  const fn = mainScore.falseNegatives;
  mainScore.falsePositives = fp;
  mainScore.precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  mainScore.recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  mainScore.f1 =
    mainScore.precision + mainScore.recall > 0
      ? (2 * mainScore.precision * mainScore.recall) / (mainScore.precision + mainScore.recall)
      : 0;

  const latencyMs = Math.round(performance.now() - t0);

  return {
    domain,
    metrics: { ...mainScore, latencyMs },
  };
}

async function main() {
  const domains = readdirSync(FIX_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .sort();

  if (domains.length === 0) {
    throw new Error(`No skill fixture domains found under ${FIX_DIR}`);
  }

  const cfg = getDeploymentConfig();
  const provider = resolveLlmProvider(cfg);
  const modelName =
    provider === 'cerebras'
      ? process.env.CEREBRAS_SYNTHESIS_MODEL ?? 'gpt-oss-120b'
      : provider === 'github'
      ? process.env.GITHUB_MODELS_SYNTHESIS_MODEL ?? 'gpt-4o-mini'
      : process.env.OLLAMA_LLM_MODEL ?? 'llama3.1:8b';
  const model = { provider, name: modelName };

  console.log(`\nANANSI SKILL EXTRACTION EVALUATION (v2)`);
  console.log(`model: ${model.provider}/${model.name}   domains: ${domains.length}\n`);

  const perDomain: DomainResult[] = [];
  for (const domain of domains) {
    process.stdout.write(`  running ${domain} ... `);
    const result = await runDomain(domain);
    perDomain.push(result);
    console.log(
      `P ${pct(result.metrics.precision)}%  R ${pct(result.metrics.recall)}%  F1 ${pct(
        result.metrics.f1
      )}%  Crit_R ${pct(result.metrics.criticalStepRecall)}%  ${result.metrics.latencyMs}ms`
    );
  }

  // --- Aggregate results ---
  const totalDomains = perDomain.length;
  const aggregate = {
    precision: perDomain.reduce((sum, r) => sum + r.metrics.precision, 0) / totalDomains,
    recall: perDomain.reduce((sum, r) => sum + r.metrics.recall, 0) / totalDomains,
    f1: perDomain.reduce((sum, r) => sum + r.metrics.f1, 0) / totalDomains,
    criticalStepRecall: perDomain.reduce((sum, r) => sum + r.metrics.criticalStepRecall, 0) / totalDomains,
    evidenceGrounding: perDomain.reduce((sum, r) => sum + r.metrics.evidenceGrounding, 0) / totalDomains,
    orderingCorrectness: perDomain.reduce((sum, r) => sum + r.metrics.orderingCorrectness, 0) / totalDomains,
    refusalRecall: perDomain.reduce((sum, r) => sum + r.metrics.refusalRecall, 0) / totalDomains,
    totalFalseAcceptances: perDomain.reduce((sum, r) => sum + r.metrics.details.falseAcceptances, 0),
    totalMissedCritical: perDomain.reduce((sum, r) => sum + r.metrics.details.missedCriticalSteps.length, 0),
  };
  
  // --- Reporting ---
  const timestamp = new Date().toISOString();
  const git = {
    sha: (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'unknown'; } })(),
    branch: (() => { try { return execSync('git rev-parse --abbrev-ref HEAD').toString().trim(); } catch { return 'unknown'; }})(),
  };
  const report = {
    evaluator: 'anansi-skill-eval-v2',
    timestamp,
    git,
    model,
    config: { domains },
    aggregate,
    domains: perDomain,
  };

  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = timestamp.replace(/[:.]/g, '-');
  const jsonPath = `${RESULTS_DIR}/${stamp}-skill-eval.json`;
  const mdPath = `${RESULTS_DIR}/${stamp}-skill-eval.md`;

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${jsonPath.replace(process.cwd(), '.')}`);
  
  const md = renderMarkdown(report);
  writeFileSync(mdPath, md);
  console.log(`wrote ${mdPath.replace(process.cwd(), '.')}\n`);
}

function renderMarkdown(report: any): string {
    const a = report.aggregate;
    const L: string[] = [];
    L.push(`# Anansi Skill Extraction Evaluation (v2)`);
    L.push(``);
    L.push(`- **Run:** ${report.timestamp}`);
    L.push(`- **Model:** ${report.model.provider} / ${report.model.name}`);
    L.push(`- **Commit:** \`${report.git.sha.slice(0, 12)}\` (${report.git.branch})`);
    L.push(``);
    L.push(`## Aggregate Results`);
    L.push(``);
    L.push(`| Metric | Value | Notes |`);
    L.push(`|---|---|---|`);
    L.push(`| **Recall (Critical Steps)** | **${pct(a.criticalStepRecall)}%** | ${a.totalMissedCritical} missed critical steps across ${report.config.domains.length} domains. |`);
    L.push(`| Refusal Decision Accuracy | ${pct(a.refusalRecall)}% | Correctly accepts valid procedures and rejects non-procedural chatter. ${a.totalFalseAcceptances} false acceptances. |`);
    L.push(`| Precision | ${pct(a.precision)}% | |`);
    L.push(`| Recall (All Steps) | ${pct(a.recall)}% | |`);
    L.push(`| F1 Score | ${pct(a.f1)}% | |`);
    L.push(`| Ordering Correctness | ${pct(a.orderingCorrectness)}% | Correctness of the procedural graph links. |`);
    L.push(`| Evidence Grounding | ${pct(a.evidenceGrounding)}% | How well extracted steps are cited to correct source chunks. |`);
    L.push(``);
    L.push(`## Per-Domain Scorecards`);
    L.push(``);
    for (const d of report.domains) {
        L.push(`### ${d.domain}`);
        const m = d.metrics;
        L.push(`- **Recall (Critical):** ${pct(m.criticalStepRecall)}%, **Refusal Decision Accuracy:** ${pct(m.refusalRecall)}%`);
        L.push(`- **Precision:** ${pct(m.precision)}%, **Recall (All):** ${pct(m.recall)}%`);
        L.push(`- **Ordering:** ${pct(m.orderingCorrectness)}%, **Evidence:** ${pct(m.evidenceGrounding)}%`);
        L.push(`- **Counts:** ${m.truePositives} TP, ${m.falsePositives} FP, ${m.falseNegatives} FN`);
        if (m.details.missedCriticalSteps.length > 0) L.push(`  - **Missed Critical:** \`${m.details.missedCriticalSteps.join(', ')}\``);
        if (m.details.falsePositives.length > 0) L.push(`  - **False Positives:** \`${m.details.falsePositives.join(', ')}\``);
        if (m.details.linkageMismatches.length > 0) L.push(`  - **Linkage Mismatches:** ${m.details.linkageMismatches.map(e => `\`${e.step}\` (expected ${e.expected.join(',')})`).join('; ')}`);
        if (m.details.evidenceMismatches.length > 0) L.push(`  - **Evidence Mismatches:** ${m.details.evidenceMismatches.map(e => `\`${e.step}\` (missing: ${e.missing.join(',')})`).join('; ')}`);
        L.push(``);
    }
    return L.join('\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
