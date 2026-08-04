import type { ExtractionOutput } from "./attestation-extraction-prompt.js";

// Score a model's extraction against the golden oracle. Matching is SEMANTIC on
// claim TEXT, not exact claim_fingerprint equality — a real model invents its own
// fingerprints, so exact matching reports a false 0% on correct extraction (the
// Step-0 finding). This deterministic token-overlap matcher needs no model; an
// LLM-judge would be more accurate but non-deterministic and costly.

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "to", "of", "in", "on", "for", "and", "or",
  "must", "should", "when", "that", "this", "it", "its", "by", "with", "as", "at", "from", "into",
  "if", "not", "no", "all", "any", "via", "will", "can", "we", "our", "up", "out", "per",
]);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9# ]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
  );
}

// Overlap coefficient: |A∩B| / min(|A|,|B|). Robust to one claim being more verbose
// than the other (e.g. the model adding a channel name the oracle omitted).
function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

const MATCH_THRESHOLD = 0.5;

// Two claims "match" if their content tokens overlap enough. Exported so the
// evaluation harness scores attestations and divergences with the same matcher.
export function claimsMatch(a: string, b: string): boolean {
  return claimOverlap(a, b) >= MATCH_THRESHOLD;
}

// Numeric form of the same deterministic semantic matcher. Consumers that need
// one-to-one assignment can rank eligible matches without changing the shared
// tokenization or threshold contract.
export function claimOverlap(a: string, b: string): number {
  return overlap(tokens(a), tokens(b));
}

// Directional containment: |tokens(a) ∩ tokens(b)| / |tokens(a)| — how much of a's
// content is accounted for by b. Unlike claimOverlap (min-normalized, symmetric-ish),
// this stays LOW when `a` is a bloated "say everything" blob that merely happens to
// contain b. The procedure aligner uses it to reject whole-document dump steps whose
// overlap coefficient is inflated by sheer verbosity. Additive; does not change
// claimOverlap/claimsMatch behavior.
export function claimContainment(a: string, b: string): number {
  const ta = tokens(a);
  if (ta.size === 0) return 0;
  const tb = tokens(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / ta.size;
}

export interface OracleShape {
  attestations: Array<{ claim: string }>;
  refusals?: Array<{ source_id: string }>;
}

export interface ExtractionScore {
  expected: number; // oracle attestations
  actual: number; // model attestations
  recallMatches: number; // oracle claims with a semantic match in the model output
  precisionMatches: number; // model claims with a semantic match in the oracle
  precision: number; // precisionMatches / actual  (1 if actual = 0)
  recall: number; // recallMatches / expected      (1 if expected = 0)
  f1: number;
  citationRate: number; // fraction of model attestations carrying >=1 evidence
  chatterLeaks: number; // model attestations matching a known chatter item (should have been refused)
  refusalRate: number; // fraction of chatter correctly NOT extracted (1 if no chatter provided)
}

function ratio(n: number, d: number): number {
  return d === 0 ? 1 : n / d;
}

// A claim in `candidates` matches `target` if their content tokens overlap enough.
function hasMatch(target: Set<string>, candidates: Set<string>[]): boolean {
  return candidates.some((c) => overlap(target, c) >= MATCH_THRESHOLD);
}

export function scoreExtraction(
  actual: ExtractionOutput,
  oracle: OracleShape,
  opts: { chatterTexts?: string[] } = {}
): ExtractionScore {
  const actualTok = actual.attestations.map((a) => tokens(a.claim));
  const oracleTok = oracle.attestations.map((a) => tokens(a.claim));

  const recallMatches = oracleTok.filter((o) => hasMatch(o, actualTok)).length;
  const precisionMatches = actualTok.filter((a) => hasMatch(a, oracleTok)).length;

  const precision = ratio(precisionMatches, actualTok.length);
  const recall = ratio(recallMatches, oracleTok.length);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const cited = actual.attestations.filter((a) => a.evidence.length > 0).length;
  const citationRate = ratio(cited, actual.attestations.length);

  const chatterTok = (opts.chatterTexts ?? []).map((t) => tokens(t));
  const chatterLeaks = chatterTok.filter((c) => hasMatch(c, actualTok)).length;
  const refusalRate = chatterTok.length === 0 ? 1 : (chatterTok.length - chatterLeaks) / chatterTok.length;

  return {
    expected: oracleTok.length,
    actual: actualTok.length,
    recallMatches,
    precisionMatches,
    precision,
    recall,
    f1,
    citationRate,
    chatterLeaks,
    refusalRate,
  };
}

// ─── Documentation / RAG-over-docs baseline ──────────────────────────────────
// The status-quo alternative to Anansi is "trust your documentation" (which is
// what doc-search / RAG-over-docs effectively returns). This scores that baseline
// deterministically from the labeled dataset — no model, no embeddings. It is a
// FAIR baseline: it can only surface what is written down, and it has no temporal
// model, so it cannot tell that a doc has gone stale.

export interface DocsBaselineScore {
  goldTotal: number;
  documentedGold: number; // gold operational facts that appear in the docs at all
  coverage: number; // documentedGold / goldTotal
  divergences: number; // planted doc-vs-reality drifts
  staleUnderDrift: number; // drifts where the documented answer is now stale (all of them)
  driftDetected: number; // docs/RAG have no temporal model, so always 0
}

export function scoreDocsBaseline(
  oracle: { attestations: Array<{ evidence: Array<{ source_id: string }> }>; divergences: unknown[] },
  isDocSource: (sourceId: string) => boolean
): DocsBaselineScore {
  const goldTotal = oracle.attestations.length;
  const documentedGold = oracle.attestations.filter((a) => a.evidence.some((e) => isDocSource(e.source_id))).length;
  const divergences = oracle.divergences.length;
  return {
    goldTotal,
    documentedGold,
    coverage: goldTotal > 0 ? documentedGold / goldTotal : 0,
    divergences,
    staleUnderDrift: divergences, // by construction the doc answer is stale wherever reality drifted
    driftDetected: 0,
  };
}

// ─── Divergence scoring ───────────────────────────────────────────────────────

export interface FiredDivergence {
  documented: { claim: string };
  observed: { claim: string };
  changedAt: string | null;
}

export interface ExpectedDivergence {
  documentedClaim: string;
  observedClaim: string;
  changedAt: string; // "YYYY-MM"
}

export interface DivergenceScore {
  expectedDetected: boolean; // the planted divergence was correctly identified
  firedCount: number;
  falseAlerts: number; // fired divergences that don't correspond to the planted one
  changedDateCorrect: boolean; // the detected divergence's change month matches the oracle
}

// A fired divergence matches the planted one when both sides match semantically.
export function scoreDivergence(
  fired: FiredDivergence[],
  expected: ExpectedDivergence | null
): DivergenceScore {
  if (!expected) {
    return { expectedDetected: false, firedCount: fired.length, falseAlerts: fired.length, changedDateCorrect: false };
  }
  const match = fired.find(
    (f) => claimsMatch(f.documented.claim, expected.documentedClaim) && claimsMatch(f.observed.claim, expected.observedClaim)
  );
  const expectedDetected = match !== undefined;
  return {
    expectedDetected,
    firedCount: fired.length,
    falseAlerts: fired.length - (expectedDetected ? 1 : 0),
    changedDateCorrect: expectedDetected && match!.changedAt != null && match!.changedAt.startsWith(expected.changedAt),
  };
}
