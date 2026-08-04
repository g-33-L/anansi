import { describe, expect, it } from 'vitest';
import { scoreProcedure } from '../lib/ai/skill-eval.js';
import type { ExtractedProcedure } from '../lib/ai/skill-extraction.js';

const oracle = {
  skillName: 'incident_response',
  expectedProcedure: {
    steps: [
      { stepId: 'acknowledge', description: 'The on-call engineer acknowledges the incident in PagerDuty.', evidence: ['c1'], critical: true, precedes: ['assess'] },
      { stepId: 'assess', description: 'The incident commander assesses the incident severity.', evidence: ['c2'] },
    ],
  },
  expectedRefusals: [{ sourceChunkId: 'chat', reason: 'chatter' }],
};

function procedure(steps: ExtractedProcedure['steps']): ExtractedProcedure {
  return { skillName: 'incident_response', steps };
}

describe('scoreProcedure', () => {
  it('aligns semantically equivalent steps even with different generated IDs', () => {
    const score = scoreProcedure(procedure([
      { stepId: 'page_oncall', description: 'On-call acknowledges an incident in PagerDuty.', evidence: ['c1'], precedes: ['severity_review'] },
      { stepId: 'severity_review', description: 'The incident commander reviews the severity.', evidence: ['c2'] },
    ]), oracle, false);

    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
    expect(score.details.alignments).toEqual([
      { predictedStepId: 'page_oncall', oracleStepId: 'acknowledge' },
      { predictedStepId: 'severity_review', oracleStepId: 'assess' },
    ]);
    expect(score.orderingCorrectness).toBe(1);
  });

  it('assigns ambiguous overlapping steps by highest semantic overlap, not oracle order', () => {
    const escalationOracle = {
      skillName: 'customer_escalation',
      expectedProcedure: { steps: [
        { stepId: 'l1_to_l2', description: 'L1 escalates issue to L2 support.', evidence: ['c1'] },
        { stepId: 'l2_to_oncall', description: 'L2 escalates issue to on-call engineer.', evidence: ['c2'] },
      ] },
      expectedRefusals: [],
    };
    // Put the L2 result first so the previous oracle-order-first matcher would
    // consume it for the L1 oracle step on shared escalation vocabulary.
    const score = scoreProcedure(procedure([
      { stepId: 'notify_oncall', description: 'L2 escalates issue to on-call engineer.', evidence: ['c2'] },
      { stepId: 'handoff_to_l2', description: 'L1 escalates issue to L2 support.', evidence: ['c1'] },
    ]), escalationOracle, false);

    expect(score.details.alignments).toEqual(expect.arrayContaining([
      { predictedStepId: 'notify_oncall', oracleStepId: 'l2_to_oncall' },
      { predictedStepId: 'handoff_to_l2', oracleStepId: 'l1_to_l2' },
    ]));
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
  });

  it('penalizes hallucinated steps in precision', () => {
    const score = scoreProcedure(procedure([
      { stepId: 'ack', description: 'On-call acknowledges an incident in PagerDuty.', evidence: ['c1'] },
      { stepId: 'buy_pizza', description: 'The warehouse receives a stationery shipment.', evidence: ['c3'] },
    ]), oracle, false);

    expect(score.precision).toBe(0.5);
    expect(score.falsePositives).toBe(1);
  });

  it('penalizes missing steps in recall and evidence grounding', () => {
    const score = scoreProcedure(procedure([
      { stepId: 'ack', description: 'On-call acknowledges an incident in PagerDuty.', evidence: ['c1'] },
    ]), oracle, false);

    expect(score.recall).toBe(0.5);
    expect(score.evidenceGrounding).toBe(0.5);
    expect(score.orderingCorrectness).toBe(0);
  });

  it('counts a refusal of valid material as missed critical work and a failed decision', () => {
    const score = scoreProcedure({ refused: true, reason: 'no procedure' }, oracle, false);

    expect(score.recall).toBe(0);
    expect(score.criticalStepRecall).toBe(0);
    expect(score.refusalRecall).toBe(0);
    expect(score.details.falseRefusals).toBe(1);
  });

  it('counts chatter extraction as a false positive, including empty accepted output', () => {
    const withStep = scoreProcedure(procedure([
      { stepId: 'watch_game', description: 'Watch the game tonight.', evidence: ['chat'] },
    ]), oracle, true);
    const empty = scoreProcedure(procedure([]), oracle, true);

    expect(withStep.falsePositives).toBe(1);
    expect(withStep.precision).toBe(0);
    expect(empty.falsePositives).toBe(1);
    expect(empty.details.falsePositives).toEqual(['<accepted_non_procedure>']);
  });
});
