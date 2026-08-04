// Synthesis quality eval — launch blocker B3.
//
// Replays golden fixtures through the EXACT production user-synthesis pipeline:
// ingest-time secret redaction (sanitizeText) → chunk formatting → prompt-
// delimiter neutralization → the production prompt (lib/ai/synthesis-prompt.ts)
// → the production LLM chain (lib/ai/llm.ts, Cerebras → GitHub Models → Ollama)
// → the production parser + temporal merge. Scores the result against expected
// facts and exits non-zero below the pass floor.
//
//   pnpm --filter @anansi/api eval:synthesis            # full suite
//   … eval:synthesis -- --only=temporal                 # id substring filter
//   … eval:synthesis -- --floor=0.9                     # suite pass floor (default 0.85)
//
// No DB or Redis required — only an LLM provider env var. Run it against the
// PRODUCTION provider (CEREBRAS_API_KEY) before any prompt or model change ships.

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { chatSynthesis } from "../../src/lib/ai/llm.js";
import { sanitizeText, neutralizePromptDelimiters } from "../../src/lib/utils/sanitize.js";
import {
  USER_SYNTHESIS_SYSTEM_PROMPT,
  buildUserSynthesisPrompt,
  parseSynthesisResponse,
  mergeTemporalFacts,
  type SynthesisResult,
} from "../../src/lib/ai/synthesis-prompt.js";
import type { TemporalFact } from "../../src/lib/db/schema.js";

// ─── Fixture shapes ───────────────────────────────────────────────────────────

interface FixtureChunk {
  author: string;
  timestamp: string;
  content: string;
  entityContext?: string;
}

interface TemporalExpectation {
  keywords: string[];
  closed?: boolean;            // true → validUntil must be set; false → must be open
  noOpenMatch?: boolean;       // no OPEN fact may match the keywords (supersede check)
  validFromPrefix?: string;    // validFrom must start with this (e.g. "2025-01")
}

interface EvalCase {
  id: string;
  category: string;
  description: string;
  existing: { staticFacts: string[]; dynamicContext: string[]; temporalFacts: TemporalFact[] };
  chunks: FixtureChunk[];
  expect: {
    static?: string[][];       // keyword groups matched against static_facts
    dynamic?: string[][];      // … against dynamic_context
    profile?: string[][];      // … against static ∪ dynamic (bucket-agnostic)
    staticAbsent?: string[][]; // groups that must NOT match any static fact
    temporal?: TemporalExpectation[];
    entities?: { name: string; type?: string }[];
    relationships?: { type: string; target: string }[];
    forbidden?: string[];      // substrings that must not appear anywhere in the output
  };
}

// ─── Matching ─────────────────────────────────────────────────────────────────
// A keyword group ["a|b", "c"] matches a fact when the fact contains ("a" or
// "b") and "c", case-insensitively. A group matches a fact LIST when at least
// one single fact satisfies every keyword.

function factMatchesGroup(fact: string, group: string[]): boolean {
  const f = fact.toLowerCase();
  return group.every((kw) => kw.toLowerCase().split("|").some((alt) => f.includes(alt.trim())));
}

function listMatchesGroup(facts: string[], group: string[]): boolean {
  return facts.some((fact) => factMatchesGroup(fact, group));
}

interface Assertion {
  label: string;
  pass: boolean;
}

function scoreCase(c: EvalCase, result: SynthesisResult | null, mergedTemporal: TemporalFact[]): Assertion[] {
  const assertions: Assertion[] = [];
  const staticFacts = result?.static_facts ?? [];
  const dynamicContext = result?.dynamic_context ?? [];
  const entities = result?.entities ?? [];

  for (const group of c.expect.static ?? []) {
    assertions.push({ label: `static contains [${group.join(" + ")}]`, pass: listMatchesGroup(staticFacts, group) });
  }
  for (const group of c.expect.dynamic ?? []) {
    assertions.push({ label: `dynamic contains [${group.join(" + ")}]`, pass: listMatchesGroup(dynamicContext, group) });
  }
  for (const group of c.expect.profile ?? []) {
    assertions.push({
      label: `profile contains [${group.join(" + ")}]`,
      pass: listMatchesGroup([...staticFacts, ...dynamicContext], group),
    });
  }
  for (const group of c.expect.staticAbsent ?? []) {
    assertions.push({ label: `static ABSENT [${group.join(" + ")}]`, pass: !listMatchesGroup(staticFacts, group) });
  }

  for (const t of c.expect.temporal ?? []) {
    const matches = mergedTemporal.filter((f) => factMatchesGroup(f.fact, t.keywords));
    let pass = matches.length > 0;
    let label = `temporal contains [${t.keywords.join(" + ")}]`;
    if (pass && t.closed === true) {
      pass = matches.some((f) => f.validUntil != null);
      label += " (closed)";
    }
    if (pass && t.closed === false) {
      pass = matches.some((f) => f.validUntil == null);
      label += " (open)";
    }
    if (pass && t.validFromPrefix) {
      pass = matches.some((f) => typeof f.validFrom === "string" && f.validFrom.startsWith(t.validFromPrefix!));
      label += ` (validFrom≈${t.validFromPrefix})`;
    }
    assertions.push({ label, pass });
    if (t.noOpenMatch) {
      assertions.push({
        label: `temporal has NO open [${t.keywords.join(" + ")}]`,
        pass: !matches.some((f) => f.validUntil == null),
      });
    }
  }

  for (const e of c.expect.entities ?? []) {
    const found = entities.some(
      (ent) =>
        ent.name.toLowerCase().includes(e.name.toLowerCase()) &&
        (e.type === undefined || ent.type.toLowerCase() === e.type.toLowerCase())
    );
    assertions.push({ label: `entity ${e.name}${e.type ? ` (${e.type})` : ""}`, pass: found });
  }

  for (const r of c.expect.relationships ?? []) {
    const found = entities.some((ent) =>
      (ent.relationships ?? []).some(
        (rel) =>
          rel.type.toLowerCase() === r.type.toLowerCase() &&
          (rel.target.toLowerCase().includes(r.target.toLowerCase()) ||
            // The model may pivot direction (entity=target org with reverse rel);
            // accept the entity itself carrying the target name.
            ent.name.toLowerCase().includes(r.target.toLowerCase()))
      )
    );
    assertions.push({ label: `relationship ${r.type}→${r.target}`, pass: found });
  }

  const serialized = JSON.stringify({ staticFacts, dynamicContext, temporal: mergedTemporal, entities }).toLowerCase();
  for (const bad of c.expect.forbidden ?? []) {
    assertions.push({ label: `forbidden "${bad}" absent`, pass: !serialized.includes(bad.toLowerCase()) });
  }

  return assertions;
}

// ─── Production-pipeline replay ───────────────────────────────────────────────

function formatChunksText(chunks: FixtureChunk[]): string {
  // Mirrors workers/synthesis.ts synthesizeUser: ingest-time redaction happens
  // in routes/v1.ts (sanitizeText), formatting + fence neutralization happen in
  // the worker. Any drift between this and the worker is an eval bug.
  return neutralizePromptDelimiters(
    chunks
      .map((c) => {
        const ecTag = typeof c.entityContext === "string" ? `[entityContext: ${JSON.stringify(c.entityContext)}]` : "";
        return `[${c.author}][${c.timestamp}]${ecTag}\n${sanitizeText(c.content).text}`;
      })
      .join("\n---\n")
  );
}

async function runCase(c: EvalCase): Promise<{ result: SynthesisResult | null; merged: TemporalFact[]; ms: number }> {
  const chunksText = formatChunksText(c.chunks);
  const t0 = Date.now();

  let result: SynthesisResult | null = null;
  for (let attempt = 0; attempt < 2 && !result; attempt++) {
    const prompt = buildUserSynthesisPrompt({
      staticFacts: c.existing.staticFacts,
      dynamicContext: c.existing.dynamicContext,
      temporalFacts: c.existing.temporalFacts,
      chunksText,
      retry: attempt > 0,
    });
    try {
      const raw = await chatSynthesis([
        { role: "system", content: USER_SYNTHESIS_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ]);
      result = parseSynthesisResponse(raw);
    } catch (err) {
      console.error(`  [${c.id}] LLM call failed (attempt ${attempt + 1}): ${(err as Error).message}`);
    }
  }

  const merged = mergeTemporalFacts(c.existing.temporalFacts, result?.temporal_facts);
  return { result, merged, ms: Date.now() - t0 };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const argValue = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const only = argValue("only");
const floor = Number(argValue("floor") ?? "0.85");
const CASE_FLOOR = 0.8; // a case passes when ≥80% of its assertions hold and no forbidden content appears

const provider = process.env.CEREBRAS_API_KEY
  ? `Cerebras (${process.env.CEREBRAS_SYNTHESIS_MODEL ?? "gpt-oss-120b"})`
  : process.env.GITHUB_TOKEN
    ? `GitHub Models (${process.env.GITHUB_MODELS_SYNTHESIS_MODEL ?? "gpt-4o-mini"})`
    : process.env.OLLAMA_BASE_URL || process.env.OLLAMA_LLM_MODEL
      ? `Ollama (${process.env.OLLAMA_LLM_MODEL ?? "llama3.1:8b"}) — NOT the production provider`
      : null;

if (!provider) {
  console.error("No LLM provider configured. Set CEREBRAS_API_KEY, GITHUB_TOKEN, or OLLAMA_BASE_URL.");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures", "golden.json"), "utf8")) as { cases: EvalCase[] };
let cases = fixtures.cases;
if (only) cases = cases.filter((c) => c.id.includes(only) || c.category.includes(only));
if (cases.length === 0) {
  console.error(`No cases match --only=${only}`);
  process.exit(2);
}

console.log(`\nSynthesis eval — ${cases.length} case(s) against ${provider}\n`);

interface CaseReport {
  id: string;
  category: string;
  pass: boolean;
  matched: number;
  total: number;
  ms: number;
  parseFailed: boolean;
  failures: string[];
}

const reports: CaseReport[] = [];

for (const c of cases) {
  const { result, merged, ms } = await runCase(c);
  const assertions = scoreCase(c, result, merged);
  const matched = assertions.filter((a) => a.pass).length;
  const forbiddenFailed = assertions.some((a) => !a.pass && a.label.startsWith("forbidden"));
  const pass = result !== null && !forbiddenFailed && matched / assertions.length >= CASE_FLOOR;
  const failures = assertions.filter((a) => !a.pass).map((a) => a.label);

  reports.push({ id: c.id, category: c.category, pass, matched, total: assertions.length, ms, parseFailed: result === null, failures });

  const icon = pass ? "✓" : "✗";
  console.log(`  ${icon} ${c.id.padEnd(32)} ${String(matched).padStart(2)}/${assertions.length}  ${String(ms).padStart(6)}ms${result === null ? "  [LLM output unparseable]" : ""}`);
  for (const f of failures) console.log(`      ↳ MISS: ${f}`);
}

const passed = reports.filter((r) => r.pass).length;
const totalAssertions = reports.reduce((s, r) => s + r.total, 0);
const matchedAssertions = reports.reduce((s, r) => s + r.matched, 0);
const passRate = passed / reports.length;

console.log(`\nCases: ${passed}/${reports.length} passed (${(passRate * 100).toFixed(0)}%, floor ${(floor * 100).toFixed(0)}%)`);
console.log(`Assertions: ${matchedAssertions}/${totalAssertions} (${((matchedAssertions / totalAssertions) * 100).toFixed(0)}% recall)`);

const byCategory = new Map<string, { pass: number; total: number }>();
for (const r of reports) {
  const agg = byCategory.get(r.category) ?? { pass: 0, total: 0 };
  agg.total++;
  if (r.pass) agg.pass++;
  byCategory.set(r.category, agg);
}
for (const [cat, { pass, total }] of [...byCategory.entries()].sort()) {
  console.log(`  ${cat.padEnd(12)} ${pass}/${total}`);
}

writeFileSync(
  join(here, "last-run.json"),
  JSON.stringify({ ranAt: new Date().toISOString(), provider, floor, passRate, reports }, null, 2)
);
console.log(`\nReport written to scripts/eval/last-run.json`);

if (passRate < floor) {
  console.error(`\nFAIL — pass rate ${(passRate * 100).toFixed(0)}% is below the ${(floor * 100).toFixed(0)}% floor. Do not ship this prompt/model combination.\n`);
  process.exit(1);
}
console.log(`\nPASS — synthesis quality clears the floor on ${provider}.\n`);
