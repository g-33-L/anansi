/**
 * Evaluation-only procedure graph scorer.
 *
 * This consumes the ExtractedProcedure contract. Structured graph fields are
 * scored directly when emitted; legacy prose-only output is scored as a clearly
 * labelled projection fallback so historical scorecards remain comparable.
 *
 * Honesty rules enforced here:
 *  - A metric is `null` ("not measured") when the ORACLE has no targets for it.
 *    Zero-denominator NEVER yields a perfect 1.0 (that was the vacuous-metric bug).
 *  - Every metric ships with a coverage count so reports show what was measured.
 *  - Projection fallbacks are UPPER BOUNDS on what is recoverable from description
 *    text; direct structured matches are evidence of actual extraction.
 */
import { tokens } from './extraction-eval.js';
import type { ExtractedProcedure } from './skill-extraction.js';

export type Predicate = { subject: string; operator: 'equals' | 'greater_than' | 'missing' | 'after'; value?: string; unit?: string };
export type Deadline = { value: number; unit: 'minutes' | 'hours' | 'days' | 'business_days'; relativeTo: string };
export type EvidenceCitation = { sourceChunkId: string; quote: string };

export interface ProcedureOracleStep {
  id: string;
  description: string;
  ownerRole?: string;
  dependsOn?: string[]; // data/order dependencies: each dependency must precede this step
  preconditions?: Predicate[]; // gates, not graph edges
  conditions?: Array<{ when: Predicate; thenSteps: string[]; elseSteps?: string[] }>;
  deadline?: Deadline;
  parallel?: { group: string; semantics: 'unordered' | 'required_concurrent' };
  evidence: EvidenceCitation[];
  critical?: boolean;
}

export interface ProcedureOracle {
  schemaVersion: 1;
  domain: string;
  canonicalRoles: Array<{ id: string; aliases: string[] }>;
  procedure: { steps: ProcedureOracleStep[] };
  refusalTraps: Array<{ sourceChunkId: string; reason: string }>;
  divergences: Array<{ id: string; documentedStepId: string; observedStepId: string; observedAfter: string }>;
  knownFailureModes: string[];
}

export type ProcedureSource = { id: string; text: string; source: 'document' | 'slack'; recordedAt?: string };
type PredictedStep = ExtractedProcedure['steps'][number];
type RefusalTrapResult = ExtractedProcedure | { refused: true; reason: string };
type Alignment = { predicted: PredictedStep; oracle: ProcedureOracleStep };

/** `null` means "not measured" — the oracle provided no targets for this metric. */
export type MetricValue = number | null;

export interface ProcedureCoverage {
  oracleSteps: number;
  predictedSteps: number;
  alignedSteps: number;
  expectedEdges: number;
  predictedEdges: number;
  gateTargets: number;
  conditionalTargets: number;
  deadlineTargets: number;
  roleTargets: number;
  parallelPairs: number;
  structuredConditionalTargets: number;
  structuredGateTargets: number;
  structuredDeadlineTargets: number;
  structuredRoleTargets: number;
  structuredParallelPairs: number;
  divergences: number;
  citations: number;
  refusalTraps: number;
}

export interface ProcedureGraphScore {
  stepPrecision: MetricValue;
  stepRecall: MetricValue;
  stepF1: MetricValue;
  dependencyPrecision: MetricValue;
  dependencyRecall: MetricValue;
  dependencyF1: MetricValue;
  // DIAGNOSTIC: precision when transitively-true edges (A->C where the oracle
  // path is A->B->C) count as correct. The headline dependencyPrecision stays
  // strict — closure credit alone would let a hub-skipping "star" output
  // inflate precision — but the gap between the two separates granularity
  // coarseness from genuinely wrong or reversed edges (never in the closure).
  dependencyPrecisionClosure: MetricValue;
  conditionalLogicAccuracy: MetricValue;
  gateAccuracy: MetricValue;
  deadlineAccuracy: MetricValue;
  roleAttributionAccuracy: MetricValue;
  // Citation-set F1 per aligned step, averaged over evidence-bearing oracle steps
  // (A3). Precision penalizes over-citation, so this is not gamed by "cite everything";
  // the name reflects that it scores citation IDs, not faithfulness of the quote.
  evidenceCitationF1: MetricValue;
  parallelismPreservation: MetricValue;
  // PROXY ONLY: this does not measure skill-extraction divergence reasoning (the
  // extractor emits no divergence output). It reports whether the matched observed
  // step happens to cite a slack source dated at/after the divergence — i.e. a
  // citation-recency proxy. Kept for signal, explicitly not a divergence metric.
  divergenceCitationRecencyProxy: MetricValue;
  falseAcceptanceRate: MetricValue; // fraction of refusal traps wrongly extracted (lower is better)
  coverage: ProcedureCoverage;
  details: { alignments: Array<{ predictedStepId: string; oracleStepId: string }>; missingSteps: string[]; hallucinatedSteps: string[]; invalidOracleEvidence: string[] };
}

const threshold = 0.5;
// A1 guard: minimum share of a PREDICTED step's own tokens that must belong to the
// oracle step it aligns to. A "say everything" dump (a step whose description is a
// near-verbatim copy of the whole source) scores overlap≈1.0 against every oracle
// step via min-normalization, then trivially "contains" every role/gate/condition
// token. Its predicted-side containment, though, is ~1/(content blocks) ≈ 0.05-0.10,
// while a legitimately richer-than-oracle real step stays ≳ 0.3. 0.15 separates them.
const predCoverageFloor = 0.15;
/** Ratio with an oracle-target denominator: null (not measured) when there are no targets. */
const measured = (correct: number, targets: number): MetricValue => targets === 0 ? null : correct / targets;
const f1 = (p: MetricValue, r: MetricValue): MetricValue => (p === null || r === null) ? null : (p + r === 0 ? 0 : 2 * p * r / (p + r));
// Digit-grouping commas are collapsed before tokenization ("2,000,000" must
// tokenize as one number, not three "000" fragments that can never match).
const words = (text: string) => new Set(text.toLowerCase().replace(/(\d),(?=\d)/g, '$1').replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((word) => word.length > 1));

// Number words we accept as equivalent to a deadline's numeric value (docs say
// "four hours", oracles store 4). Extended as fixtures require.
const NUMBER_WORDS: Record<number, string[]> = {
  1: ['one'], 2: ['two'], 3: ['three'], 4: ['four'], 5: ['five'], 6: ['six'], 7: ['seven'],
  8: ['eight'], 9: ['nine'], 10: ['ten'], 15: ['fifteen'], 24: ['twenty', 'four'], 30: ['thirty'], 60: ['sixty'], 90: ['ninety'],
};
const UNIT_TOKENS: Record<Deadline['unit'], string[]> = {
  minutes: ['minute', 'minutes', 'min', 'mins'], hours: ['hour', 'hours', 'hr', 'hrs'], days: ['day', 'days'], business_days: ['business'],
};

// Alignment-scoped token folding: the same conservative inflection roots the
// predicate matchers use (approve/approval, issue/issued), applied to the
// overlap tokenization. Scoped here — attestation/skill scoring keeps the
// shared exact-token contract in extraction-eval. Folding is meaning-
// preserving; the 0.5 threshold and the A1 dump floor are unchanged.
const foldToken = (word: string): string => {
  if (word.length < 5) return word;
  const root = inflectionRoot(word);
  return root.length >= 5 ? root : word;
};
const foldedTokens = (text: string) => new Set([...tokens(text)].map(foldToken));
const setIntersection = (a: Set<string>, b: Set<string>): number => {
  let inter = 0;
  for (const item of a) if (b.has(item)) inter++;
  return inter;
};
const alignOverlap = (a: string, b: string): number => {
  const left = foldedTokens(a);
  const right = foldedTokens(b);
  return left.size === 0 || right.size === 0 ? 0 : setIntersection(left, right) / Math.min(left.size, right.size);
};
const alignContainment = (a: string, b: string): number => {
  const left = foldedTokens(a);
  return left.size === 0 ? 0 : setIntersection(left, foldedTokens(b)) / left.size;
};

// When two candidates' lexical overlaps are within this margin, the model's own
// typed ownerRole claim breaks the tie. A wrong-role step cannot steal an
// alignment it does not lexically earn: the bonus never lifts a candidate over
// the 0.5 threshold and never outranks a >5-point overlap lead.
const roleTieBreak = 0.05;

/** Best-overlap-first, one-to-one assignment; near-ties prefer a matching ownerRole, then step IDs. */
export function alignProcedureSteps(predicted: PredictedStep[], oracle: ProcedureOracleStep[], roles: ProcedureOracle['canonicalRoles'] = []): Alignment[] {
  const candidates = oracle.flatMap((gold, oracleIndex) => predicted.flatMap((step, predictedIndex) => {
    const overlap = alignOverlap(step.description, gold.description);
    // A1: reject whole-document dumps whose min-normalized overlap is inflated by
    // verbosity — require the oracle step to also account for a real share of the
    // predicted step's own content, so a step cannot align to (and claim projection
    // credit for) every oracle step just by "saying everything".
    const predCoverage = alignContainment(step.description, gold.description);
    if (overlap < threshold || predCoverage < predCoverageFloor) return [];
    const roleMatch = step.ownerRole !== undefined && gold.ownerRole !== undefined && roleMentioned(gold.ownerRole, step.ownerRole, roles);
    return [{ step, gold, overlap, rank: overlap + (roleMatch ? roleTieBreak : 0), oracleIndex, predictedIndex }];
  }));
  candidates.sort((a, b) => b.rank - a.rank || Number(b.step.stepId === b.gold.id) - Number(a.step.stepId === a.gold.id) || a.oracleIndex - b.oracleIndex || a.predictedIndex - b.predictedIndex);
  const usedPredicted = new Set<number>();
  const usedOracle = new Set<number>();
  const result: Alignment[] = [];
  for (const candidate of candidates) {
    if (usedPredicted.has(candidate.predictedIndex) || usedOracle.has(candidate.oracleIndex)) continue;
    usedPredicted.add(candidate.predictedIndex); usedOracle.add(candidate.oracleIndex);
    result.push({ predicted: candidate.step, oracle: candidate.gold });
  }
  return result;
}

// Operator trigger words, plus OPPOSITE words that must be ABSENT so an inverted
// meaning cannot score (before != after, missing != received, less != greater).
const OPERATOR_WORDS: Record<Predicate['operator'], string[]> = {
  equals: ['if', 'when', 'equals', 'is'],
  greater_than: ['over', 'above', 'exceeds', 'exceed', 'greater', 'more'],
  missing: ['missing', 'absent', 'without', 'no', 'not', 'lack', 'unavailable', 'fails'],
  after: ['after', 'once', 'following', 'subsequent'],
};
const OPPOSITE_WORDS: Record<Predicate['operator'], string[]> = {
  // A4: negation tokens must be ABSENT for an `equals` state to score. Without this,
  // "distribution has NOT begun" / "hold is NOT active" matched the positive predicate
  // ("begun" / "active"), inverting meaning for the most common operator. Kept tight
  // (strong, low-collision negators) so a non-negating "no sole-source exception may…"
  // ("no", high-collision) or a bare "cannot" (single token != "not") is not vetoed.
  equals: ['not', 'never', 'without'],
  greater_than: ['less', 'under', 'below', 'fewer', 'within'],
  missing: ['received', 'present', 'complete', 'completed', 'confirmed', 'available', 'provided', 'obtained'],
  after: ['before', 'prior', 'preceding'],
};

function predicateMentioned(predicate: Predicate, text: string): boolean {
  const actual = words(text);
  const required = [...words(predicate.subject), ...(predicate.value ? words(predicate.value) : [])];
  // H5: the extractor commonly changes a gate subject's grammatical form while
  // preserving its meaning ("acknowledgement" -> "acknowledges", "approval" ->
  // "approves"). Exact token equality made these faithful before/after gates
  // false negatives. Apply a deliberately small lexical normalization only to
  // predicate subject/value tokens; operator and polarity checks remain exact.
  // Short words must still match exactly so this cannot turn a broad token match
  // into a gate credit.
  const hasSubject = required.length > 0 && required.every(word =>
    [...actual].some(candidate => candidate === word || sameInflection(candidate, word)),
  );
  const hasOperator = OPERATOR_WORDS[predicate.operator].some(word => actual.has(word));
  const hasOpposite = OPPOSITE_WORDS[predicate.operator].some(word => actual.has(word));
  return hasSubject && hasOperator && !hasOpposite;
}

function normalizedPhrase(value: string | undefined): string {
  return value === undefined ? '' : [...words(value)].sort().join(' ');
}

// Function words that carry no meaning for a deadline anchor phrase ("receipt of
// the disclosure" vs "disclosure receipt").
const ANCHOR_STOPWORDS = new Set(['of', 'the', 'to', 'for', 'from', 'by', 'on', 'in', 'at', 'is', 'an', 'its']);

/** Deadline anchors match when one phrase's content tokens are a subset of the
 * other's ("disclosure receipt" vs "receipt of the disclosure"). Exact sorted-
 * phrase equality failed honest lexical variation while the prose fallback path
 * accepted any single-word overlap — structured emission was scored more harshly
 * than no structure at all. Subset (either direction) still rejects genuinely
 * different anchors ("receipt of notice" vs "exam preparation initiation"). */
function sameAnchor(left: string, right: string): boolean {
  const contentWords = (value: string) => new Set([...words(value)].filter(word => !ANCHOR_STOPWORDS.has(word)));
  const leftTokens = contentWords(left);
  const rightTokens = contentWords(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  const [small, large] = leftTokens.size <= rightTokens.size ? [leftTokens, rightTokens] : [rightTokens, leftTokens];
  return [...small].every(token => large.has(token));
}

// Auxiliary verbs and copular hedges carry no predicate meaning ("has begun" vs
// "begun", "deemed patentable" vs "patentable"). Negators (not, never, without)
// are deliberately NOT stripped so an inverted state ("not met" vs "met") can
// never match.
const VALUE_AUXILIARIES = new Set(['has', 'have', 'had', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'deemed', 'considered']);
function normalizedValue(value: string | undefined): string {
  return value === undefined ? '' : [...words(value)].filter(word => !VALUE_AUXILIARIES.has(word)).sort().join(' ');
}

/** Structured predicates must retain the source-supported field semantics.
 * Subject: oracle tokens must be a subset of predicted tokens (model may add
 * qualifying words; oracle never adds words the model omits), with the same
 * conservative inflection folding the prose path already gets (H5) — an exact
 * restatement like "department heads" vs "department head" is not an error.
 * Operator and unit remain exact, and value is exact after auxiliary-verb
 * removal, so inverted or wrong-magnitude predicates never score. */
function subjectContains(left: Predicate, right: Predicate): boolean {
  const leftSubject = [...words(left.subject)];
  return [...words(right.subject)].every(token => leftSubject.some(candidate => candidate === token || sameInflection(candidate, token)));
}

function samePredicate(left: Predicate, right: Predicate): boolean {
  return left.operator === right.operator &&
    subjectContains(left, right) &&
    normalizedValue(left.value) === normalizedValue(right.value) &&
    normalizedPhrase(left.unit) === normalizedPhrase(right.unit);
}

function sameReferences(expected: string[], actual: string[], predictedToOracle: Map<string, string>): boolean {
  const mapped = actual.map(id => predictedToOracle.get(id));
  return mapped.every((id): id is string => id !== undefined) &&
    new Set(expected).size === new Set(mapped).size &&
    expected.every(id => mapped.includes(id));
}

/** Conservative shared root for common procedure-noun/verb inflections. */
function inflectionRoot(word: string): string {
  if (word.endsWith('ements')) return word.slice(0, -6);
  if (word.endsWith('ement')) return word.slice(0, -5);
  if (word.endsWith('ments')) return word.slice(0, -5);
  if (word.endsWith('ment')) return word.slice(0, -4);
  if (word.endsWith('ations')) return word.slice(0, -6);
  if (word.endsWith('ation')) return word.slice(0, -5);
  if (word.endsWith('ions')) return word.slice(0, -4);
  if (word.endsWith('ion')) return word.slice(0, -3);
  if (word.endsWith('als')) return word.slice(0, -3);
  if (word.endsWith('al')) return word.slice(0, -2);
  if (word.endsWith('ing')) return word.slice(0, -3);
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('ied')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('es')) return word.slice(0, -2);
  if (word.endsWith('ed')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function sameInflection(left: string, right: string): boolean {
  // Bare plural: identical up to a trailing "s", singular at least 4 chars
  // ("head"/"heads", "document"/"documents"; "new"/"news" stays distinct).
  if (left === `${right}s`) return right.length >= 4;
  if (right === `${left}s`) return left.length >= 4;
  if (left.length < 5 || right.length < 5) return false;
  const leftRoot = inflectionRoot(left);
  const rightRoot = inflectionRoot(right);
  return leftRoot.length >= 5 && leftRoot === rightRoot;
}

function roleMentioned(role: string, text: string, roles: ProcedureOracle['canonicalRoles']): boolean {
  const aliases = roles.find(candidate => candidate.id === role)?.aliases ?? [role];
  const actual = words(text);
  // Token-subset match (not raw substring) so an alias like "IT" cannot match
  // inside "submit"/"audit".
  return aliases.some(alias => { const tokens = [...words(alias)]; return tokens.length > 0 && tokens.every(token => actual.has(token)); });
}

function deadlineMentioned(deadline: Deadline, text: string): boolean {
  const actual = words(text);
  const valueOk = actual.has(String(deadline.value)) || (NUMBER_WORDS[deadline.value]?.some(word => actual.has(word)) ?? false);
  const unitOk = UNIT_TOKENS[deadline.unit].some(token => actual.has(token));
  const relativeOk = [...words(deadline.relativeTo)].some(word => actual.has(word));
  return valueOk && unitOk && relativeOk;
}

function edgeSet(steps: ProcedureOracleStep[]): Set<string> {
  return new Set(steps.flatMap(step => (step.dependsOn ?? []).map(dependency => `${dependency}->${step.id}`)));
}

export function validateProcedureOracle(oracle: ProcedureOracle, sources: ProcedureSource[]): string[] {
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const ids = new Set(oracle.procedure.steps.map(step => step.id));
  const errors: string[] = [];
  for (const step of oracle.procedure.steps) {
    for (const dependency of step.dependsOn ?? []) if (!ids.has(dependency)) errors.push(`${step.id}: unknown dependency ${dependency}`);
    for (const citation of step.evidence) {
      const source = sourceById.get(citation.sourceChunkId);
      if (!source) errors.push(`${step.id}: unknown evidence source ${citation.sourceChunkId}`);
      else if (!source.text.includes(citation.quote)) errors.push(`${step.id}: evidence quote is not verbatim in ${citation.sourceChunkId}`);
    }
  }
  for (const trap of oracle.refusalTraps) if (!sourceById.has(trap.sourceChunkId)) errors.push(`unknown refusal trap ${trap.sourceChunkId}`);
  for (const divergence of oracle.divergences) {
    if (!ids.has(divergence.observedStepId)) errors.push(`divergence ${divergence.id}: unknown observed step ${divergence.observedStepId}`);
    if (!ids.has(divergence.documentedStepId)) errors.push(`divergence ${divergence.id}: unknown documented step ${divergence.documentedStepId}`);
  }
  return errors;
}

export function scoreProcedureGraph(
  extracted: ExtractedProcedure | { refused: true; reason: string },
  oracle: ProcedureOracle,
  sources: ProcedureSource[],
  refusalTrapResults: RefusalTrapResult[] = [],
): ProcedureGraphScore {
  const invalidOracleEvidence = validateProcedureOracle(oracle, sources);
  const oracleSteps = oracle.procedure.steps;
  const predicted = 'refused' in extracted ? [] : extracted.steps;
  const alignments = 'refused' in extracted ? [] : alignProcedureSteps(predicted, oracleSteps, oracle.canonicalRoles);
  const matchedPredicted = new Set(alignments.map(item => item.predicted));
  const matchedOracle = new Set(alignments.map(item => item.oracle.id));
  const predictedToOracle = new Map(alignments.map(item => [item.predicted.stepId, item.oracle.id]));
  const oracleToPredicted = new Map(alignments.map(item => [item.oracle.id, item.predicted]));

  const stepPrecision = predicted.length === 0 ? null : alignments.length / predicted.length;
  const stepRecall = measured(alignments.length, oracleSteps.length);

  const expectedEdges = edgeSet(oracleSteps);
  const actualEdges = new Set(predicted.flatMap(step => (step.precedes ?? []).map(target => `${predictedToOracle.get(step.stepId) ?? `?${step.stepId}`}->${predictedToOracle.get(target) ?? `?${target}`}`)));
  const dependencyMatches = [...actualEdges].filter(edge => expectedEdges.has(edge)).length;
  const dependencyPrecision = actualEdges.size === 0 ? null : dependencyMatches / actualEdges.size;
  const dependencyRecall = measured(dependencyMatches, expectedEdges.size);

  // Closure-credited precision diagnostic (see the interface comment). Oracle
  // graphs are DAGs; memoization keyed before recursion keeps this safe even if
  // a fixture ever ships a cycle.
  const successorsByStep = new Map<string, string[]>();
  for (const step of oracleSteps) for (const dependency of step.dependsOn ?? []) {
    const list = successorsByStep.get(dependency) ?? [];
    list.push(step.id);
    successorsByStep.set(dependency, list);
  }
  const reachableFrom = new Map<string, Set<string>>();
  const reach = (id: string): Set<string> => {
    const cached = reachableFrom.get(id);
    if (cached) return cached;
    const out = new Set<string>();
    reachableFrom.set(id, out);
    for (const next of successorsByStep.get(id) ?? []) {
      out.add(next);
      for (const transitive of reach(next)) out.add(transitive);
    }
    return out;
  };
  const closureMatches = [...actualEdges].filter(edge => {
    const [from, to] = edge.split('->');
    return !from.startsWith('?') && !to.startsWith('?') && reach(from).has(to);
  }).length;
  const dependencyPrecisionClosure = actualEdges.size === 0 ? null : closureMatches / actualEdges.size;

  const conditionalTargets = oracleSteps.flatMap(step => (step.conditions ?? []).map(condition => ({ step, condition })));
  const conditionalCorrect = conditionalTargets.filter(({ step, condition }) => {
    const predictedStep = oracleToPredicted.get(step.id);
    if (predictedStep === undefined) return false;
    if (predictedStep.conditions !== undefined) {
      return predictedStep.conditions.some(candidate =>
        samePredicate(candidate.when, condition.when) &&
        sameReferences(condition.thenSteps, candidate.thenSteps, predictedToOracle) &&
        sameReferences(condition.elseSteps ?? [], candidate.elseSteps ?? [], predictedToOracle),
      );
    }
    return predicateMentioned(condition.when, predictedStep.description);
  }).length;

  const roleTargets = oracleSteps.filter(step => step.ownerRole);
  const correctRoles = roleTargets.filter(step => {
    const predictedStep = oracleToPredicted.get(step.id);
    if (predictedStep === undefined) return false;
    return predictedStep.ownerRole !== undefined
      ? roleMentioned(step.ownerRole!, predictedStep.ownerRole, oracle.canonicalRoles)
      : roleMentioned(step.ownerRole!, predictedStep.description, oracle.canonicalRoles);
  }).length;

  const gateTargets = oracleSteps.flatMap(step => (step.preconditions ?? []).map(precondition => ({ step, precondition })));
  // Per-target best-of(structured, prose): each oracle target is counted once
  // (max, never sum). The old any-structured-disables-prose rule made a partial
  // structured emission score worse than none, inverting the incentive. Prose
  // rescue stays off for a target the model made an explicit structured claim
  // about with the wrong operator/value — that is a contradiction, not an
  // omission, and a correctly-worded description must not launder it.
  const correctGates = gateTargets.filter(({ step, precondition }) => {
    const predictedStep = oracleToPredicted.get(step.id);
    if (predictedStep === undefined) return false;
    const candidates = predictedStep.preconditions ?? [];
    if (candidates.some(candidate => samePredicate(candidate, precondition))) return true;
    const contradicts = candidates.some(candidate => subjectContains(candidate, precondition));
    return !contradicts && predicateMentioned(precondition, predictedStep.description);
  }).length;

  const deadlineTargets = oracleSteps.filter(step => step.deadline);
  const correctDeadlines = deadlineTargets.filter(step => {
    const predictedStep = oracleToPredicted.get(step.id);
    if (predictedStep === undefined) return false;
    return predictedStep.deadline !== undefined
      ? predictedStep.deadline.value === step.deadline!.value &&
        predictedStep.deadline.unit === step.deadline!.unit &&
        sameAnchor(predictedStep.deadline.relativeTo, step.deadline!.relativeTo)
      : deadlineMentioned(step.deadline!, predictedStep.description);
  }).length;

  // A3: citation-set F1 per aligned step, averaged over oracle steps that carry
  // evidence. Recall-only rewarded a "cite every chunk" step with a perfect 1.0; the
  // precision term punishes over-citation, so the name (evidenceCitationF1) matches what
  // it measures. A missing (unaligned) oracle step scores 0 — you can't faithfully cite
  // a step you never extracted. The extractor emits source IDs, not quotes; oracle
  // citations are already verified verbatim by validateProcedureOracle.
  const citationCount = oracleSteps.reduce((total, step) => total + step.evidence.length, 0);
  const evidenceSteps = oracleSteps.filter(step => step.evidence.length > 0);
  const evidenceF1s = evidenceSteps.map(step => {
    const predictedStep = oracleToPredicted.get(step.id);
    if (predictedStep === undefined) return 0;
    const oracleIds = new Set(step.evidence.map(citation => citation.sourceChunkId));
    const predIds = new Set(predictedStep.evidence);
    let inter = 0;
    for (const id of oracleIds) if (predIds.has(id)) inter++;
    if (inter === 0) return 0;
    const precision = inter / predIds.size;
    const recall = inter / oracleIds.size;
    return 2 * precision * recall / (precision + recall);
  });
  const evidenceCitationF1: MetricValue = evidenceSteps.length === 0 ? null : evidenceF1s.reduce((sum, value) => sum + value, 0) / evidenceSteps.length;

  const unorderedGroups = new Map<string, string[]>();
  for (const step of oracleSteps) if (step.parallel?.semantics === 'unordered') {
    const values = unorderedGroups.get(step.parallel.group) ?? []; values.push(step.id); unorderedGroups.set(step.parallel.group, values);
  }
  const parallelPairs = [...unorderedGroups.values()].flatMap(group => group.flatMap((left, index) => group.slice(index + 1).map(right => [left, right] as const)));
  const oracleDependsOn = new Map(oracleSteps.map(step => [step.id, new Set(step.dependsOn ?? [])]));
  const edgeIncidentTo = (id: string) => [...actualEdges].some(edge => edge.startsWith(`${id}->`) || edge.endsWith(`->${id}`));
  // A2: credit parallelism only when the model actually EXPRESSED the group as graph
  // structure and did not serialize the pair. The old check credited any pair with no
  // edge between its members, so an edge-less output (the emptiest possible) scored
  // 1.0 for free and the metric was anti-correlated with dependency recall. Now a pair
  // must (1) have both members extracted, (2) carry no ordering edge between them, and
  // (3) show the model placed them in the graph — via a shared-predecessor edge when
  // the oracle defines one, else any edge incident to the pair.
  const parallelCorrect = parallelPairs.filter(([left, right]) => {
    const leftPredicted = oracleToPredicted.get(left);
    const rightPredicted = oracleToPredicted.get(right);
    if (leftPredicted === undefined || rightPredicted === undefined) return false;
    if (actualEdges.has(`${left}->${right}`) || actualEdges.has(`${right}->${left}`)) return false;
    // Direct graph extraction: both members name the same unordered/concurrent
    // group. The explicit path is taken only when BOTH members made a group
    // claim — then it must be the same group (a shared wrong group earns no
    // structural fallback). When exactly one member carries a group label, the
    // model made no claim about THIS pair; a wrong claim about some other pair
    // must not zero a fork the edges prove, so fall through to structural
    // inference (which still requires real mapped edges — an edge-less output
    // continues to score nothing).
    if (leftPredicted.parallel !== undefined && rightPredicted.parallel !== undefined) {
      return leftPredicted.parallel.group === rightPredicted.parallel.group &&
        (leftPredicted.parallel.semantics === 'unordered' || leftPredicted.parallel.semantics === 'required_concurrent') &&
        (rightPredicted.parallel.semantics === 'unordered' || rightPredicted.parallel.semantics === 'required_concurrent');
    }
    const shared = [...(oracleDependsOn.get(left) ?? [])].filter(predecessor => (oracleDependsOn.get(right) ?? new Set()).has(predecessor));
    if (shared.length > 0) return shared.some(predecessor => actualEdges.has(`${predecessor}->${left}`) || actualEdges.has(`${predecessor}->${right}`));
    return edgeIncidentTo(left) || edgeIncidentTo(right);
  }).length;

  // Report how much of each projection metric used an explicitly emitted graph
  // field. This makes a rising score attributable to real structured extraction
  // rather than a more permissive description-based fallback.
  const structuredConditionalTargets = conditionalTargets.filter(({ step }) => oracleToPredicted.get(step.id)?.conditions !== undefined).length;
  const structuredGateTargets = gateTargets.filter(({ step }) => oracleToPredicted.get(step.id)?.preconditions !== undefined).length;
  const structuredDeadlineTargets = deadlineTargets.filter(step => oracleToPredicted.get(step.id)?.deadline !== undefined).length;
  const structuredRoleTargets = roleTargets.filter(step => oracleToPredicted.get(step.id)?.ownerRole !== undefined).length;
  const structuredParallelPairs = parallelPairs.filter(([left, right]) => oracleToPredicted.get(left)?.parallel !== undefined && oracleToPredicted.get(right)?.parallel !== undefined).length;

  const divergencesDetected = oracle.divergences.filter(divergence => {
    const observed = oracleToPredicted.get(divergence.observedStepId);
    return observed?.evidence.some(id => sources.find(source => source.id === id && source.recordedAt && source.recordedAt >= divergence.observedAfter)?.source === 'slack') ?? false;
  }).length;

  const falseAcceptances = refusalTrapResults.filter(result => !('refused' in result)).length;

  return {
    stepPrecision, stepRecall, stepF1: f1(stepPrecision, stepRecall),
    dependencyPrecision, dependencyRecall, dependencyF1: f1(dependencyPrecision, dependencyRecall),
    dependencyPrecisionClosure,
    conditionalLogicAccuracy: measured(conditionalCorrect, conditionalTargets.length),
    gateAccuracy: measured(correctGates, gateTargets.length),
    deadlineAccuracy: measured(correctDeadlines, deadlineTargets.length),
    roleAttributionAccuracy: measured(correctRoles, roleTargets.length),
    evidenceCitationF1: invalidOracleEvidence.length === 0 ? evidenceCitationF1 : 0,
    parallelismPreservation: measured(parallelCorrect, parallelPairs.length),
    divergenceCitationRecencyProxy: measured(divergencesDetected, oracle.divergences.length),
    falseAcceptanceRate: measured(falseAcceptances, refusalTrapResults.length),
    coverage: {
      oracleSteps: oracleSteps.length, predictedSteps: predicted.length, alignedSteps: alignments.length,
      expectedEdges: expectedEdges.size, predictedEdges: actualEdges.size,
      gateTargets: gateTargets.length, conditionalTargets: conditionalTargets.length, deadlineTargets: deadlineTargets.length,
      roleTargets: roleTargets.length, parallelPairs: parallelPairs.length,
      structuredConditionalTargets, structuredGateTargets, structuredDeadlineTargets, structuredRoleTargets, structuredParallelPairs,
      divergences: oracle.divergences.length,
      citations: citationCount, refusalTraps: refusalTrapResults.length,
    },
    details: {
      alignments: alignments.map(item => ({ predictedStepId: item.predicted.stepId, oracleStepId: item.oracle.id })),
      missingSteps: oracleSteps.filter(step => !matchedOracle.has(step.id)).map(step => step.id),
      hallucinatedSteps: predicted.filter(step => !matchedPredicted.has(step)).map(step => step.stepId),
      invalidOracleEvidence,
    },
  };
}
