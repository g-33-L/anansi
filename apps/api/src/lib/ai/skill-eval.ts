import { claimOverlap } from './extraction-eval.js';
import type { ExtractedProcedure } from './skill-extraction.js';

type OracleStep = {
  stepId: string;
  description: string;
  evidence: string[];
  critical?: boolean;
  precedes?: string[];
  temporalConstraints?: { validUntil?: string };
};

export interface SkillOracle {
  skillName: string;
  expectedProcedure: { steps: OracleStep[] };
  expectedRefusals: Array<{ sourceChunkId: string; reason: string }>;
}

export interface ProcedureScore {
  precision: number;
  recall: number;
  f1: number;
  evidenceGrounding: number;
  orderingCorrectness: number;
  temporalCorrectness: number;
  criticalStepRecall: number;
  // Per-call classifier correctness. The harness aggregates valid-procedure
  // acceptance with refusal-case rejection into one decision score.
  refusalRecall: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  details: {
    truePositives: string[];
    falsePositives: string[];
    falseNegatives: string[];
    missedCriticalSteps: string[];
    evidenceMismatches: Array<{ step: string; missing: string[] }>;
    linkageMismatches: Array<{ step: string; expected: string[]; actual: string[] }>;
    temporalMismatches: string[];
    alignments: Array<{ predictedStepId: string; oracleStepId: string }>;
    falseAcceptances: number;
    correctRefusals: number;
    falseRefusals: number;
  };
}

type PredictedStep = ExtractedProcedure['steps'][number];

function alignSteps(predicted: PredictedStep[], oracle: OracleStep[]): Array<{ predicted: PredictedStep; oracle: OracleStep }> {
  const candidates = oracle.flatMap((oracleStep, oracleIndex) => predicted.flatMap((step, predictedIndex) => {
    const overlap = claimOverlap(step.description, oracleStep.description);
    return overlap >= 0.5 ? [{ step, oracleStep, predictedIndex, oracleIndex, overlap }] : [];
  }));
  const matchedPredictions = new Set<number>();
  const matchedOracle = new Set<number>();
  const alignments: Array<{ predicted: PredictedStep; oracle: OracleStep }> = [];

  // Make the highest semantic-overlap assignments first. IDs resolve exact
  // semantic ties only; their generated values never decide eligibility.
  candidates.sort((a, b) =>
    b.overlap - a.overlap ||
    Number(b.step.stepId === b.oracleStep.stepId) - Number(a.step.stepId === a.oracleStep.stepId) ||
    a.oracleIndex - b.oracleIndex ||
    a.predictedIndex - b.predictedIndex
  );
  for (const candidate of candidates) {
    if (matchedPredictions.has(candidate.predictedIndex) || matchedOracle.has(candidate.oracleIndex)) continue;
    matchedPredictions.add(candidate.predictedIndex);
    matchedOracle.add(candidate.oracleIndex);
    alignments.push({ predicted: candidate.step, oracle: candidate.oracleStep });
  }
  return alignments;
}

/** Scores one extraction decision against a procedure or a refusal fixture. */
export function scoreProcedure(
  extracted: ExtractedProcedure | { refused: true; reason: string },
  oracle: SkillOracle,
  refusalCase: boolean
): ProcedureScore {
  const details: ProcedureScore['details'] = {
    truePositives: [], falsePositives: [], falseNegatives: [], missedCriticalSteps: [],
    evidenceMismatches: [], linkageMismatches: [], temporalMismatches: [], alignments: [],
    falseAcceptances: 0, correctRefusals: 0, falseRefusals: 0,
  };
  const oracleSteps = oracle.expectedProcedure.steps;
  const predicted = 'refused' in extracted ? [] : extracted.steps;
  const alignments = !refusalCase && !('refused' in extracted) ? alignSteps(predicted, oracleSteps) : [];
  const predictedToOracle = new Map(alignments.map(({ predicted: step, oracle: gold }) => [step.stepId, gold.stepId]));
  const oracleToPredicted = new Map(alignments.map(({ predicted: step, oracle: gold }) => [gold.stepId, step]));
  const matchedPredictedSteps = new Set(alignments.map(({ predicted: step }) => step));

  for (const { predicted: step, oracle: gold } of alignments) {
    details.truePositives.push(gold.stepId);
    details.alignments.push({ predictedStepId: step.stepId, oracleStepId: gold.stepId });
  }

  if ('refused' in extracted) {
    if (refusalCase) details.correctRefusals = 1;
    else {
      details.falseRefusals = 1;
      details.falseNegatives = oracleSteps.map((step) => step.stepId);
    }
  } else if (refusalCase) {
    details.falseAcceptances = 1;
    // A non-refusal with no steps is still a failed refusal decision.
    details.falsePositives = predicted.length > 0 ? predicted.map((step) => step.stepId) : ['<accepted_non_procedure>'];
  } else {
    details.falsePositives = predicted
      .filter((step) => !matchedPredictedSteps.has(step))
      .map((step) => step.stepId);
    details.falseNegatives = oracleSteps
      .filter((step) => !oracleToPredicted.has(step.stepId))
      .map((step) => step.stepId);
  }

  const totalEvidence = oracleSteps.reduce((sum, step) => sum + step.evidence.length, 0);
  let correctEvidence = 0;
  let correctOrdering = 0;
  let correctTemporal = 0;

  for (const gold of oracleSteps) {
    const step = oracleToPredicted.get(gold.stepId);
    if (!step) {
      if (gold.evidence.length) details.evidenceMismatches.push({ step: gold.stepId, missing: gold.evidence });
      if ((gold.precedes ?? []).length) details.linkageMismatches.push({ step: gold.stepId, expected: gold.precedes ?? [], actual: [] });
      if (gold.temporalConstraints) details.temporalMismatches.push(gold.stepId);
      continue;
    }

    const cited = new Set(step.evidence);
    const missingEvidence = gold.evidence.filter((id) => !cited.has(id));
    correctEvidence += gold.evidence.length - missingEvidence.length;
    if (missingEvidence.length) details.evidenceMismatches.push({ step: gold.stepId, missing: missingEvidence });

    const expectedLinks = gold.precedes ?? [];
    const actualLinks = (step.precedes ?? []).map((id) => predictedToOracle.get(id) ?? id);
    if (new Set(expectedLinks).size === new Set(actualLinks).size && expectedLinks.every((id) => actualLinks.includes(id))) {
      correctOrdering++;
    } else {
      details.linkageMismatches.push({ step: gold.stepId, expected: expectedLinks, actual: actualLinks });
    }

    if (gold.temporalConstraints) {
      if (gold.temporalConstraints.validUntil === step.temporalConstraints?.validUntil) correctTemporal++;
      else details.temporalMismatches.push(gold.stepId);
    }
  }

  details.missedCriticalSteps = oracleSteps
    .filter((step) => step.critical && !oracleToPredicted.has(step.stepId))
    .map((step) => step.stepId);

  const tp = details.truePositives.length;
  const fp = details.falsePositives.length;
  const fn = details.falseNegatives.length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const criticalTotal = oracleSteps.filter((step) => step.critical).length;
  const temporalTotal = oracleSteps.filter((step) => step.temporalConstraints).length;

  return {
    precision, recall, f1,
    evidenceGrounding: totalEvidence > 0 ? correctEvidence / totalEvidence : 1,
    orderingCorrectness: oracleSteps.length > 0 ? correctOrdering / oracleSteps.length : 1,
    temporalCorrectness: temporalTotal > 0 ? correctTemporal / temporalTotal : 1,
    criticalStepRecall: criticalTotal > 0 ? (criticalTotal - details.missedCriticalSteps.length) / criticalTotal : 1,
    refusalRecall: refusalCase ? details.correctRefusals : details.falseRefusals === 0 ? 1 : 0,
    truePositives: tp, falsePositives: fp, falseNegatives: fn, details,
  };
}
