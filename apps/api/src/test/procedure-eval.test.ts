import { describe, expect, it } from 'vitest';
import { scoreProcedureGraph, type ProcedureOracle, type ProcedureSource } from '../lib/ai/procedure-eval.js';
import type { ExtractedProcedure } from '../lib/ai/skill-extraction.js';

const sources: ProcedureSource[] = [
  { id: 'doc-1', source: 'document', text: 'Employment counsel approves termination before account disablement.' },
  { id: 'chat-1', source: 'slack', recordedAt: '2026-07-02T10:00:00Z', text: 'Current practice: IT disables the account after counsel approval.' },
];
const oracle: ProcedureOracle = {
  schemaVersion: 1, domain: 'test', canonicalRoles: [{ id: 'counsel', aliases: ['employment counsel', 'counsel'] }, { id: 'it', aliases: ['IT'] }],
  procedure: { steps: [
    { id: 'approve', description: 'Employment counsel approves termination.', ownerRole: 'counsel', evidence: [{ sourceChunkId: 'doc-1', quote: 'Employment counsel approves termination' }], critical: true },
    { id: 'disable', description: 'IT disables the account after counsel approval.', ownerRole: 'it', dependsOn: ['approve'], conditions: [{ when: { subject: 'legal hold', operator: 'equals', value: 'active' }, thenSteps: ['approve'], elseSteps: ['disable'] }], evidence: [{ sourceChunkId: 'chat-1', quote: 'IT disables the account after counsel approval' }] },
  ] },
  refusalTraps: [], divergences: [{ id: 'current-practice', documentedStepId: 'approve', observedStepId: 'disable', observedAfter: '2026-07-01' }], knownFailureModes: [],
};
const procedure = (steps: ExtractedProcedure['steps']): ExtractedProcedure => ({ skillName: 'test', steps });

// Minimal oracle/source builder for focused projection-metric tests.
const one = (step: Partial<ProcedureOracle['procedure']['steps'][number]> & { id: string; description: string }, text: string): { oracle: ProcedureOracle; sources: ProcedureSource[] } => ({
  oracle: { schemaVersion: 1, domain: 't', canonicalRoles: [], procedure: { steps: [{ evidence: [{ sourceChunkId: 's1', quote: step.description.replace(/\.$/, '') }], ...step }] }, refusalTraps: [], divergences: [], knownFailureModes: [] },
  sources: [{ id: 's1', source: 'document', text }],
});

describe('scoreProcedureGraph', () => {
  it('uses semantic alignment rather than generated step IDs and scores dependencies', () => {
    const score = scoreProcedureGraph(procedure([
      { stepId: 'legal_ok', description: 'Employment counsel approves termination.', evidence: ['doc-1'], precedes: ['offboard'] },
      { stepId: 'offboard', description: 'IT disables the account after counsel approval.', evidence: ['chat-1'] },
    ]), oracle, sources);
    expect(score.stepF1).toBe(1); expect(score.dependencyF1).toBe(1); expect(score.roleAttributionAccuracy).toBe(1); expect(score.evidenceCitationF1).toBe(1); expect(score.divergenceCitationRecencyProxy).toBe(1);
  });

  it('penalizes missing dependencies and hallucinated steps', () => {
    const score = scoreProcedureGraph(procedure([
      { stepId: 'legal_ok', description: 'Employment counsel approves termination.', evidence: ['doc-1'] },
      { stepId: 'invented', description: 'Send a celebratory company email.', evidence: ['doc-1'] },
    ]), oracle, sources);
    expect(score.stepPrecision).toBe(0.5); expect(score.stepRecall).toBe(0.5); expect(score.dependencyRecall).toBe(0); expect(score.details.missingSteps).toEqual(['disable']);
  });

  it('keeps typed conditional targets in the denominator when current output omits them', () => {
    const score = scoreProcedureGraph(procedure([
      { stepId: 'legal_ok', description: 'Employment counsel approves termination.', evidence: ['doc-1'] },
      { stepId: 'offboard', description: 'IT disables the account after counsel approval.', evidence: ['chat-1'] },
    ]), oracle, sources);
    expect(score.conditionalLogicAccuracy).toBe(0);
  });

  it('returns N/A (null), never 1.0, when the oracle has no targets for a metric', () => {
    const bare: ProcedureOracle = {
      schemaVersion: 1, domain: 'bare', canonicalRoles: [],
      procedure: { steps: [
        { id: 'a', description: 'Do the first thing.', evidence: [{ sourceChunkId: 'd1', quote: 'Do the first thing' }] },
        { id: 'b', description: 'Do the second thing.', evidence: [{ sourceChunkId: 'd1', quote: 'Do the second thing' }] },
      ] },
      refusalTraps: [], divergences: [], knownFailureModes: [],
    };
    const bareSources: ProcedureSource[] = [{ id: 'd1', source: 'document', text: 'Do the first thing. Do the second thing.' }];
    const score = scoreProcedureGraph(procedure([
      { stepId: 'x', description: 'Do the first thing.', evidence: ['d1'] },
      { stepId: 'y', description: 'Do the second thing.', evidence: ['d1'] },
    ]), bare, bareSources);
    // No targets exist -> these must be N/A, and crucially NOT the vacuous 1.0.
    for (const metric of [score.gateAccuracy, score.deadlineAccuracy, score.conditionalLogicAccuracy, score.parallelismPreservation, score.roleAttributionAccuracy, score.divergenceCitationRecencyProxy, score.dependencyRecall, score.dependencyPrecision]) {
      expect(metric).toBeNull();
    }
    expect(score.coverage.gateTargets).toBe(0);
    expect(score.coverage.parallelPairs).toBe(0);
  });

  it('a model that emits no dependency edges is N/A on precision, not perfect', () => {
    const score = scoreProcedureGraph(procedure([
      { stepId: 'a', description: 'Employment counsel approves termination.', evidence: ['doc-1'] },
      { stepId: 'b', description: 'IT disables the account after counsel approval.', evidence: ['chat-1'] },
    ]), oracle, sources);
    expect(score.dependencyPrecision).toBeNull(); // no edges emitted -> undefined, never 1.0
    expect(score.dependencyRecall).toBe(0); // an edge existed and was missed
  });

  it('does not credit an inverted gate predicate (after != before)', () => {
    const { oracle: o, sources: s } = one({ id: 'po', description: 'Procurement issues the purchase order after Board approval.', preconditions: [{ subject: 'Board approval', operator: 'after' }] }, 'Procurement issues the purchase order after Board approval or before Board approval.');
    const yes = scoreProcedureGraph(procedure([{ stepId: 'po', description: 'Procurement issues the purchase order after Board approval.', evidence: ['s1'] }]), o, s);
    const no = scoreProcedureGraph(procedure([{ stepId: 'po', description: 'Procurement issues the purchase order before Board approval.', evidence: ['s1'] }]), o, s);
    expect(yes.gateAccuracy).toBe(1);
    expect(no.gateAccuracy).toBe(0);
  });

  it('scores explicit grounded graph fields directly', () => {
    const { oracle: o, sources: s } = one({
      id: 'issue_po',
      description: 'Procurement issues the purchase order.',
      ownerRole: 'procurement',
      preconditions: [{ subject: 'Board approval', operator: 'after' }],
      conditions: [{ when: { subject: 'emergency', operator: 'equals', value: 'declared' }, thenSteps: ['issue_po'] }],
      deadline: { value: 2, unit: 'days', relativeTo: 'approval' },
    }, 'Procurement issues the purchase order.');
    const score = scoreProcedureGraph(procedure([{
      stepId: 'issue_po', description: 'Procurement issues the purchase order.', evidence: ['s1'],
      ownerRole: 'Procurement',
      preconditions: [{ subject: 'Board approval', operator: 'after' }],
      conditions: [{ when: { subject: 'emergency', operator: 'equals', value: 'declared' }, thenSteps: ['issue_po'] }],
      deadline: { value: 2, unit: 'days', relativeTo: 'approval' },
    }]), o, s);
    expect(score.roleAttributionAccuracy).toBe(1);
    expect(score.gateAccuracy).toBe(1);
    expect(score.conditionalLogicAccuracy).toBe(1);
    expect(score.deadlineAccuracy).toBe(1);
    expect(score.coverage.structuredRoleTargets).toBe(1);
    expect(score.coverage.structuredGateTargets).toBe(1);
    expect(score.coverage.structuredConditionalTargets).toBe(1);
    expect(score.coverage.structuredDeadlineTargets).toBe(1);
  });

  // H5 — current output often preserves an order gate while changing its subject
  // from a procedure noun to a verb. This is faithful, but exact token matching
  // previously reported it as a miss. Polarity must still reject "before".
  it('credits inflected gate subjects without crediting an inverted order', () => {
    const { oracle: o, sources: s } = one({ id: 'preserve', description: 'IT preserves data after custodian acknowledgement.', preconditions: [{ subject: 'custodian acknowledgement', operator: 'after' }] }, 'IT preserves data after custodian acknowledgement.');
    const yes = scoreProcedureGraph(procedure([{ stepId: 'preserve', description: 'IT preserves data after the custodian acknowledges.', evidence: ['s1'] }]), o, s);
    const no = scoreProcedureGraph(procedure([{ stepId: 'preserve', description: 'IT preserves data before the custodian acknowledges.', evidence: ['s1'] }]), o, s);
    expect(yes.gateAccuracy).toBe(1);
    expect(no.gateAccuracy).toBe(0);
  });

  it('credits approval/approves as the same gate subject', () => {
    const { oracle: o, sources: s } = one({ id: 'po', description: 'Procurement issues the purchase order after Board approval.', preconditions: [{ subject: 'Board approval', operator: 'after' }] }, 'Procurement issues the purchase order after Board approval.');
    const score = scoreProcedureGraph(procedure([{ stepId: 'po', description: 'Procurement issues the purchase order once the Board approves.', evidence: ['s1'] }]), o, s);
    expect(score.gateAccuracy).toBe(1);
  });

  it('credits a predicted subject that adds qualifying words to the oracle subject', () => {
    // oracle "approval" → tokens {approval}; predicted "Employment Counsel approval" → {employment, counsel, approval}
    // {approval} ⊆ {employment, counsel, approval} → match under new containment semantics.
    const { oracle: o, sources: s } = one({ id: 'meeting', description: 'HR conducts the termination meeting after approval.', preconditions: [{ subject: 'approval', operator: 'after' }] }, 'After approval, HR conducts the termination meeting.');
    const specific = scoreProcedureGraph(procedure([{
      stepId: 'meeting', description: 'HR conducts the termination meeting.', evidence: ['s1'],
      preconditions: [{ subject: 'Employment Counsel approval', operator: 'after' }],
    }]), o, s);
    expect(specific.gateAccuracy).toBe(1);
    expect(specific.coverage.structuredGateTargets).toBe(1);
  });

  it('does not credit a structured gate that is LESS specific than the oracle', () => {
    const { oracle: o, sources: s } = one({ id: 'po', description: 'Procurement issues the purchase order after Board approval.', preconditions: [{ subject: 'Board approval', operator: 'after' }] }, 'Procurement issues the purchase order after Board approval.');
    const generic = scoreProcedureGraph(procedure([{
      stepId: 'po', description: 'Procurement issues the purchase order.', evidence: ['s1'],
      preconditions: [{ subject: 'approval', operator: 'after' }],
    }]), o, s);
    expect(generic.gateAccuracy).toBe(0);
  });

  it('does not credit a structured gate with a matching subject but wrong operator', () => {
    const { oracle: o, sources: s } = one({ id: 'po', description: 'Procurement issues the purchase order after Board approval.', preconditions: [{ subject: 'Board approval', operator: 'after' }] }, 'Procurement issues the purchase order after Board approval.');
    const wrongOperator = scoreProcedureGraph(procedure([{
      stepId: 'po', description: 'Procurement issues the purchase order after Board approval.', evidence: ['s1'],
      preconditions: [{ subject: 'Board approval', operator: 'equals', value: 'granted' }],
    }]), o, s);
    expect(wrongOperator.gateAccuracy).toBe(0);
  });

  it('credits a predicted subject that adds a qualifier word to the oracle subject', () => {
    // oracle "Board approval" → tokens {board, approval}; predicted "prior Board approval" → {prior, board, approval}
    // {board, approval} ⊆ {prior, board, approval} → match; the operator field (after) guards polarity, not the subject.
    const { oracle: o, sources: s } = one({ id: 'po', description: 'Procurement issues the purchase order after Board approval.', preconditions: [{ subject: 'Board approval', operator: 'after' }] }, 'Procurement issues the purchase order after Board approval.');
    const withQualifier = scoreProcedureGraph(procedure([{
      stepId: 'po', description: 'Procurement issues the purchase order.', evidence: ['s1'],
      preconditions: [{ subject: 'prior Board approval', operator: 'after' }],
    }]), o, s);
    expect(withQualifier.gateAccuracy).toBe(1);
  });

  it('does not credit a structured conditional that changes the source-supported value', () => {
    const { oracle: o, sources: s } = one({ id: 'esc', description: 'If a custodian is on leave, escalate to Employment Counsel.', conditions: [{ when: { subject: 'custodian', operator: 'equals', value: 'leave' }, thenSteps: ['esc'] }] }, 'If a custodian is on leave, escalate to Employment Counsel.');
    const stateInSubject = scoreProcedureGraph(procedure([{
      stepId: 'esc', description: 'If a custodian is on leave, escalate to Employment Counsel.', evidence: ['s1'],
      conditions: [{ when: { subject: 'custodian leave', operator: 'equals', value: 'true' }, thenSteps: ['esc'] }],
    }]), o, s);
    expect(stateInSubject.conditionalLogicAccuracy).toBe(0);
    const stateMissing = scoreProcedureGraph(procedure([{
      stepId: 'esc', description: 'If a custodian is on leave, escalate to Employment Counsel.', evidence: ['s1'],
      conditions: [{ when: { subject: 'custodian', operator: 'equals', value: 'true' }, thenSteps: ['esc'] }],
    }]), o, s);
    expect(stateMissing.conditionalLogicAccuracy).toBe(0);
  });

  it('does not credit an inverted conditional predicate (missing != received)', () => {
    const { oracle: o, sources: s } = one({ id: 'esc', description: 'Escalate when wipe confirmation is absent.', conditions: [{ when: { subject: 'wipe confirmation', operator: 'missing' }, thenSteps: ['esc'] }] }, 'Escalate when wipe confirmation is absent or received.');
    const yes = scoreProcedureGraph(procedure([{ stepId: 'esc', description: 'Escalate when wipe confirmation is absent.', evidence: ['s1'] }]), o, s);
    const no = scoreProcedureGraph(procedure([{ stepId: 'esc', description: 'Escalate when wipe confirmation is received.', evidence: ['s1'] }]), o, s);
    expect(yes.conditionalLogicAccuracy).toBe(1);
    expect(no.conditionalLogicAccuracy).toBe(0);
  });

  it('deadline matching does not collide on numeric substrings (15 != 150)', () => {
    const { oracle: o, sources: s } = one({ id: 'revoke', description: 'Revoke access within 15 minutes of termination.', deadline: { value: 15, unit: 'minutes', relativeTo: 'termination' } }, 'Revoke access within 15 minutes of termination, never 150 minutes.');
    const yes = scoreProcedureGraph(procedure([{ stepId: 'revoke', description: 'Revoke access within 15 minutes of termination.', evidence: ['s1'] }]), o, s);
    const no = scoreProcedureGraph(procedure([{ stepId: 'revoke', description: 'Revoke access within 150 minutes of termination.', evidence: ['s1'] }]), o, s);
    expect(yes.deadlineAccuracy).toBe(1);
    expect(no.deadlineAccuracy).toBe(0);
  });

  // Per-target gate scoring: a structured entry about a DIFFERENT subject no
  // longer disables prose credit for this target (partial structuring must not
  // score worse than none), but a structured claim about the SAME subject with
  // the wrong operator is a contradiction and still vetoes prose rescue.
  it('prose-rescues a gate the structured list omitted, but not one it contradicted', () => {
    const { oracle: o, sources: s } = one({ id: 'po', description: 'Procurement issues the purchase order after Board approval.', preconditions: [{ subject: 'Board approval', operator: 'after' }] }, 'Procurement issues the purchase order after Board approval and once budget is confirmed.');
    const step = { stepId: 'po', description: 'Procurement issues the purchase order after Board approval.', evidence: ['s1'] };
    const otherSubject = scoreProcedureGraph(procedure([{ ...step, preconditions: [{ subject: 'budget confirmation', operator: 'after' as const }] }]), o, s);
    const contradicted = scoreProcedureGraph(procedure([{ ...step, preconditions: [{ subject: 'Board approval', operator: 'equals' as const, value: 'granted' }] }]), o, s);
    expect(otherSubject.gateAccuracy).toBe(1);
    expect(contradicted.gateAccuracy).toBe(0);
  });

  // Structured gate subjects get the same conservative inflection folding the
  // prose fallback has (H5): an exact restatement ("collection of relevant
  // documents" vs "document collection") is not an error, but a genuinely
  // different subject is. Short tokens (< 5 chars, e.g. head/heads) still
  // require exact equality — the folding never widens beyond long-word roots.
  it('credits an inflected structured gate subject without crediting a different subject', () => {
    const { oracle: o, sources: s } = one({ id: 'review', description: 'Compliance reviews materials after document collection.', preconditions: [{ subject: 'document collection', operator: 'after' }] }, 'Compliance reviews materials after document collection.');
    const step = { stepId: 'review', description: 'Compliance reviews materials.', evidence: ['s1'] };
    const inflected = scoreProcedureGraph(procedure([{ ...step, preconditions: [{ subject: 'collection of relevant documents', operator: 'after' as const }] }]), o, s);
    const different = scoreProcedureGraph(procedure([{ ...step, preconditions: [{ subject: 'evidence package intake', operator: 'after' as const }] }]), o, s);
    expect(inflected.gateAccuracy).toBe(1);
    expect(different.gateAccuracy).toBe(0);
  });

  // Pair-scoped parallel veto: a group label on ONE member about some other
  // pairing no longer zeroes a fork the mapped edges prove; a shared wrong
  // group (both members, different groups) still earns nothing.
  it('falls back to structural inference when only one pair member carries a group label', () => {
    const oracleSteps = [
      { id: 'notify', description: 'Coordinator notifies the response teams.', evidence: [{ sourceChunkId: 's1', quote: 'Coordinator notifies the response teams.' }] },
      { id: 'isolate', description: 'IT isolates the affected systems.', dependsOn: ['notify'], parallel: { group: 'response', semantics: 'unordered' as const }, evidence: [{ sourceChunkId: 's1', quote: 'IT isolates the affected systems' }] },
      { id: 'assess', description: 'Legal assesses regulatory reporting duties.', dependsOn: ['notify'], parallel: { group: 'response', semantics: 'unordered' as const }, evidence: [{ sourceChunkId: 's1', quote: 'Legal assesses regulatory reporting duties' }] },
    ];
    const oracle2 = { ...oracle, procedure: { steps: oracleSteps }, refusalTraps: [], divergences: [] };
    const sources2 = [{ id: 's1', text: 'Coordinator notifies the response teams. In parallel, IT isolates the affected systems and Legal assesses regulatory reporting duties.', source: 'document' as const }];
    const forked = [
      { stepId: 'notify', description: 'Coordinator notifies the response teams.', evidence: ['s1'], precedes: ['isolate', 'assess'] },
      { stepId: 'isolate', description: 'IT isolates the affected systems.', evidence: ['s1'], parallel: { group: 'containment', semantics: 'unordered' as const } },
      { stepId: 'assess', description: 'Legal assesses regulatory reporting duties.', evidence: ['s1'] },
    ];
    const oneLabelled = scoreProcedureGraph(procedure(forked), oracle2, sources2);
    const bothWrongGroups = scoreProcedureGraph(procedure(forked.map(step => step.stepId === 'assess' ? { ...step, parallel: { group: 'other', semantics: 'unordered' as const } } : step)), oracle2, sources2);
    expect(oneLabelled.parallelismPreservation).toBe(1);
    expect(bothWrongGroups.parallelismPreservation).toBe(0);
  });

  // Auxiliary verbs in a predicate value are meaningless variation ("has begun"
  // vs "begun") but negators must still block a polarity flip ("not met" vs "met").
  it('credits an auxiliary-verb value variant without crediting a negated value', () => {
    const { oracle: o, sources: s } = one({ id: 'notice', description: 'Send customer notice if distribution has begun.', conditions: [{ when: { subject: 'distribution', operator: 'equals', value: 'begun' }, thenSteps: ['notice'] }] }, 'Send customer notice if distribution has begun.');
    const step = { stepId: 'notice', description: 'Send customer notice.', evidence: ['s1'] };
    const aux = scoreProcedureGraph(procedure([{ ...step, conditions: [{ when: { subject: 'distribution', operator: 'equals' as const, value: 'has begun' }, thenSteps: ['notice'] }] }]), o, s);
    const negated = scoreProcedureGraph(procedure([{ ...step, conditions: [{ when: { subject: 'distribution', operator: 'equals' as const, value: 'not begun' }, thenSteps: ['notice'] }] }]), o, s);
    expect(aux.conditionalLogicAccuracy).toBe(1);
    expect(negated.conditionalLogicAccuracy).toBe(0);
  });

  // Structured relativeTo must tolerate honest lexical variation of the same
  // anchor (word order, function words) without accepting a different anchor.
  // Exact sorted-phrase equality scored structured emission more harshly than
  // the prose fallback, which needs only a single-word overlap.
  it('credits a structured deadline anchor stated with different word order or function words', () => {
    const { oracle: o, sources: s } = one({ id: 'assess', description: 'Legal assesses patentability within 30 days of disclosure receipt.', deadline: { value: 30, unit: 'days', relativeTo: 'disclosure receipt' } }, 'Legal assesses patentability within 30 days of receipt of the disclosure.');
    const step = { stepId: 'assess', description: 'Legal assesses patentability.', evidence: ['s1'] };
    const reordered = scoreProcedureGraph(procedure([{ ...step, deadline: { value: 30, unit: 'days', relativeTo: 'receipt of the disclosure' } }]), o, s);
    const differentAnchor = scoreProcedureGraph(procedure([{ ...step, deadline: { value: 30, unit: 'days', relativeTo: 'exam preparation initiation' } }]), o, s);
    const wrongValue = scoreProcedureGraph(procedure([{ ...step, deadline: { value: 60, unit: 'days', relativeTo: 'receipt of the disclosure' } }]), o, s);
    expect(reordered.deadlineAccuracy).toBe(1);
    expect(differentAnchor.deadlineAccuracy).toBe(0);
    expect(wrongValue.deadlineAccuracy).toBe(0);
  });

  it('computes falseAcceptanceRate from trap results, consistently, never hardcoded', () => {
    const withTraps = scoreProcedureGraph(procedure([]), oracle, sources, [{ refused: true, reason: 'x' }, { skillName: 'z', steps: [{ stepId: 'q', description: 'invented', evidence: [] }] }]);
    expect(withTraps.falseAcceptanceRate).toBe(0.5); // one of two traps wrongly extracted
    expect(withTraps.coverage.refusalTraps).toBe(2);
    const noTraps = scoreProcedureGraph(procedure([]), oracle, sources);
    expect(noTraps.falseAcceptanceRate).toBeNull(); // not measured -> N/A, not 0
  });

  // A4 — an inverted `equals` state must not score. Previously OPPOSITE_WORDS.equals
  // was empty, so "not active" matched the positive predicate ("active").
  it('does not credit an inverted equals predicate (active != not active)', () => {
    const { oracle: o, sources: s } = one({ id: 'proceed', description: 'Proceed when the litigation hold is active.', conditions: [{ when: { subject: 'litigation hold', operator: 'equals', value: 'active' }, thenSteps: ['proceed'] }] }, 'Proceed when the litigation hold is active or not active.');
    const yes = scoreProcedureGraph(procedure([{ stepId: 'proceed', description: 'Proceed when the litigation hold is active.', evidence: ['s1'] }]), o, s);
    const no = scoreProcedureGraph(procedure([{ stepId: 'proceed', description: 'Proceed when the litigation hold is not active.', evidence: ['s1'] }]), o, s);
    expect(yes.conditionalLogicAccuracy).toBe(1);
    expect(no.conditionalLogicAccuracy).toBe(0);
  });

  // A3 — evidenceCitationF1 must penalize over-citation. A recall-only metric let a
  // "cite every chunk" step score 1.0; the precision term now drags it down.
  it('evidenceCitationF1 penalizes citing everything (precision, not recall-only)', () => {
    const { oracle: o, sources: s } = one({ id: 'x', description: 'Do the thing.', evidence: [{ sourceChunkId: 's1', quote: 'Do the thing' }] }, 'Do the thing.');
    const exact = scoreProcedureGraph(procedure([{ stepId: 'x', description: 'Do the thing.', evidence: ['s1'] }]), o, s);
    const citeAll = scoreProcedureGraph(procedure([{ stepId: 'x', description: 'Do the thing.', evidence: ['s1', 'junk1', 'junk2', 'junk3'] }]), o, s);
    expect(exact.evidenceCitationF1).toBe(1);
    expect(citeAll.evidenceCitationF1).toBeCloseTo(0.4, 5); // recall 1, precision 1/4 -> F1 0.4
  });

  // A2 — the emptiest possible output (no edges) must not score parallelism 1.0.
  // Credit requires the model to have expressed the group as graph structure.
  it('does not credit parallelism for an edge-less output; credits real structure', () => {
    const base = { id: 'a', description: 'Finance reviews the package.', parallel: { group: 'g', semantics: 'unordered' as const }, dependsOn: ['prep'] };
    const o: ProcedureOracle = {
      schemaVersion: 1, domain: 'p', canonicalRoles: [],
      procedure: { steps: [
        { id: 'prep', description: 'Sponsor prepares the package.', evidence: [{ sourceChunkId: 's1', quote: 'Sponsor prepares the package' }] },
        { ...base, evidence: [{ sourceChunkId: 's1', quote: 'Finance reviews the package' }] },
        { id: 'b', description: 'Security reviews the package.', parallel: { group: 'g', semantics: 'unordered' }, dependsOn: ['prep'], evidence: [{ sourceChunkId: 's1', quote: 'Security reviews the package' }] },
      ] },
      refusalTraps: [], divergences: [], knownFailureModes: [],
    };
    const s: ProcedureSource[] = [{ id: 's1', source: 'document', text: 'Sponsor prepares the package. Finance reviews the package. Security reviews the package.' }];
    const steps = [
      { stepId: 'prep', description: 'Sponsor prepares the package.', evidence: ['s1'] },
      { stepId: 'a', description: 'Finance reviews the package.', evidence: ['s1'] },
      { stepId: 'b', description: 'Security reviews the package.', evidence: ['s1'] },
    ];
    const noEdges = scoreProcedureGraph(procedure(steps), o, s);
    expect(noEdges.parallelismPreservation).toBe(0); // no structure emitted -> no free credit
    const withStructure = scoreProcedureGraph(procedure(steps.map(step => step.stepId === 'prep' ? { ...step, precedes: ['a', 'b'] } : step)), o, s);
    expect(withStructure.parallelismPreservation).toBe(1); // shared-predecessor edges, no order between a,b
    const withDirectGroup = scoreProcedureGraph(procedure(steps.map(step => step.stepId === 'a' || step.stepId === 'b' ? { ...step, parallel: { group: 'review', semantics: 'unordered' as const } } : step)), o, s);
    expect(withDirectGroup.parallelismPreservation).toBe(1); // explicit group, no dependency-edge projection required
    expect(withDirectGroup.coverage.structuredParallelPairs).toBe(1);
    const serialized = scoreProcedureGraph(procedure(steps.map(step => step.stepId === 'a' ? { ...step, precedes: ['b'] } : (step.stepId === 'prep' ? { ...step, precedes: ['a'] } : step))), o, s);
    expect(serialized.parallelismPreservation).toBe(0); // a->b imposes an order -> not parallel
  });

  // samePredicate containment regression tests — every oracle subject token must
  // appear in the predicted subject; the predicted may add qualifying words but may
  // never drop oracle tokens. Operator, value, and unit remain exact-match.
  describe('samePredicate containment: oracle subject tokens ⊆ predicted subject tokens', () => {
    // Shared description used for all tests so alignment is always guaranteed.
    const DESC = 'Complete the prescribed check.';
    // Build a one-step oracle with a single structured precondition.
    const og = (subj: string, op: 'equals' | 'greater_than' | 'missing' | 'after' = 'after', val?: string) =>
      one({ id: 'x', description: DESC, preconditions: [{ subject: subj, operator: op, ...(val !== undefined && { value: val }) }] }, DESC);
    // Predicted procedure with a single structured precondition on the matching step.
    const pg = (subj: string, op: 'equals' | 'greater_than' | 'missing' | 'after' = 'after', val?: string) =>
      procedure([{ stepId: 'x', description: DESC, evidence: ['s1'], preconditions: [{ subject: subj, operator: op, ...(val !== undefined && { value: val }) }] }]);

    // --- Positive cases (should match) ---

    it('exact subject match still works', () => {
      const { oracle: o, sources: s } = og('approval');
      expect(scoreProcedureGraph(pg('approval'), o, s).gateAccuracy).toBe(1);
    });

    it('predicted adds qualifying words — oracle tokens are a subset of predicted', () => {
      // oracle "individuals affected" → {individuals, affected}
      // predicted "number of affected individuals" → {number, of, affected, individuals}
      const { oracle: o, sources: s } = og('individuals affected', 'equals', 'true');
      expect(scoreProcedureGraph(pg('number of affected individuals', 'equals', 'true'), o, s).gateAccuracy).toBe(1);
    });

    it('predicted adds article — single oracle token still matches', () => {
      // oracle "custodian" → {custodian}; predicted "the custodian" → {the, custodian}
      const { oracle: o, sources: s } = og('custodian');
      expect(scoreProcedureGraph(pg('the custodian'), o, s).gateAccuracy).toBe(1);
    });

    it('oracle phrase tokens appear in predicted natural language with an extra word', () => {
      // oracle "critical finding" → {critical, finding}; predicted adds "security"
      const { oracle: o, sources: s } = og('critical finding');
      expect(scoreProcedureGraph(pg('critical security finding'), o, s).gateAccuracy).toBe(1);
    });

    // --- Negative cases (must NOT match) ---

    it('predicted drops an oracle token — fails (subset check fails)', () => {
      // oracle "employment counsel approval" → {employment, counsel, approval}
      // predicted "counsel approval" → {counsel, approval} — "employment" missing
      const { oracle: o, sources: s } = og('employment counsel approval');
      expect(scoreProcedureGraph(pg('counsel approval'), o, s).gateAccuracy).toBe(0);
    });

    it('wrong operator — fails even if subject matches exactly', () => {
      // operator is exact-match; "equals" != "after"
      const { oracle: o, sources: s } = og('approval', 'equals');
      expect(scoreProcedureGraph(pg('approval', 'after'), o, s).gateAccuracy).toBe(0);
    });

    it('wrong value — fails even if subject and operator match', () => {
      const { oracle: o, sources: s } = og('headcount', 'greater_than', '500');
      expect(scoreProcedureGraph(pg('headcount', 'greater_than', '100'), o, s).gateAccuracy).toBe(0);
    });

    it('inverted polarity via wrong operator — missing != equals', () => {
      const { oracle: o, sources: s } = og('wipe confirmation', 'missing');
      expect(scoreProcedureGraph(pg('wipe confirmation', 'equals', 'received'), o, s).gateAccuracy).toBe(0);
    });

    it('completely different subject — fails', () => {
      // no token overlap between oracle "litigation hold" and predicted "performance review"
      const { oracle: o, sources: s } = og('litigation hold');
      expect(scoreProcedureGraph(pg('performance review'), o, s).gateAccuracy).toBe(0);
    });

    // --- Boundary cases ---

    it('single-token oracle subject matches any predicted containing that token', () => {
      // oracle "approval" → {approval}; predicted "manager approval" → {manager, approval}
      const { oracle: o, sources: s } = og('approval');
      expect(scoreProcedureGraph(pg('manager approval'), o, s).gateAccuracy).toBe(1);
    });

    it('both sides empty subject — empty oracle token set vacuously matches', () => {
      // words("") → {} (empty set); [].every(...) is vacuously true
      const { oracle: o, sources: s } = og('', 'after');
      expect(scoreProcedureGraph(pg('', 'after'), o, s).gateAccuracy).toBe(1);
    });
  });

  // A1 — a "say everything" dump whose description is the whole source must not align
  // to (and harvest projection credit for) every oracle step via min-normalized overlap.
  it('rejects whole-document dump steps in alignment (A1)', () => {
    // A realistic "dump": both oracle sentences buried in a large blob of unrelated
    // procedure text, so each oracle step is only a small share of the predicted tokens.
    const whole = 'Employment counsel approves termination. IT disables the account after counsel approval. Finance reviews the quarterly budget, procurement negotiates vendor contracts, security audits access logs, legal drafts settlement agreements, marketing prepares press releases, engineering deploys production services, and operations reconciles monthly invoices across regional offices worldwide.';
    const dump = scoreProcedureGraph(procedure([
      { stepId: 'd1', description: whole, evidence: ['doc-1'] },
      { stepId: 'd2', description: whole, evidence: ['chat-1'] },
    ]), oracle, sources);
    expect(dump.coverage.alignedSteps).toBe(0); // dumps do not align
    expect(dump.roleAttributionAccuracy).toBe(0); // so projection metrics are not inflated
  });
});
