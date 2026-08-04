import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SKILL_EXTRACTION_SYSTEM_PROMPT, parseSkillExtractionResponse } from '../lib/ai/skill-extraction-prompt.js';

const chunkIds = new Set(['policy-1', 'policy-2']);
const normalizationFixtures = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/procedure-graph-normalization.json', import.meta.url)), 'utf8')) as {
  chunkIds: string[];
  approvalGatePropagation: unknown;
  symmetricParallel: unknown;
  oneSidedParallel: unknown;
  refusal: unknown;
};

describe('parseSkillExtractionResponse', () => {
  it('instructs the model to emit atomic, typed graph fields', () => {
    // Refusal is the first thing the model reads, and its exact JSON is preserved.
    expect(SKILL_EXTRACTION_SYSTEM_PROMPT.indexOf('STEP ZERO — REFUSAL CHECK')).toBeLessThan(SKILL_EXTRACTION_SYSTEM_PROMPT.indexOf('Strict Schema'));
    expect(SKILL_EXTRACTION_SYSTEM_PROMPT).toContain('"refused": true');
    expect(SKILL_EXTRACTION_SYSTEM_PROMPT).toContain('one actor, one action');
    expect(SKILL_EXTRACTION_SYSTEM_PROMPT).toContain('FINAL CHECKLIST');
    expect(SKILL_EXTRACTION_SYSTEM_PROMPT).toContain('never one step with a list of roles');
    expect(SKILL_EXTRACTION_SYSTEM_PROMPT).toContain('dependsOn');
    // The worked example must never demonstrate a one-sided parallel label — the
    // normalizer strips those, so the prompt would be teaching a rejected pattern.
    const exampleGroups = SKILL_EXTRACTION_SYSTEM_PROMPT.match(/"group": "campaign_reviews"/g) ?? [];
    expect(exampleGroups.length).toBeGreaterThanOrEqual(2);
  });

  // Found via real-document dogfooding (an ops runbook written in imperative,
  // tool-centric prose — a style no benchmark fixture uses): the model named
  // "Railway dashboard" and an invented "Operations" team as ownerRole. Every
  // fixture domain always names an actor, so this class of grounding failure
  // was structurally invisible to the benchmark until tested on real text.
  it('instructs the model not to ground ownerRole in tool names or invented teams', () => {
    expect(SKILL_EXTRACTION_SYSTEM_PROMPT).toContain('UI screen, dashboard, or menu path is NOT an actor');
    expect(SKILL_EXTRACTION_SYSTEM_PROMPT).toContain('Never invent a generic team name');
    expect(SKILL_EXTRACTION_SYSTEM_PROMPT).toContain('never a UI surface, menu path, or invented team name');
  });

  it('folds dependsOn into the named predecessor precedes edge', () => {
    const parsed = parseSkillExtractionResponse(JSON.stringify({
      skillName: 'ordering',
      steps: [
        { stepId: 'approve', description: 'Counsel approves the termination.', evidence: ['policy-1'], precedes: ['meeting'] },
        { stepId: 'meeting', description: 'HR conducts the meeting after approval.', evidence: ['policy-1'], dependsOn: ['approve'] },
        { stepId: 'disable', description: 'IT disables access after approval.', evidence: ['policy-1', 'policy-2'], dependsOn: ['approve', 'disable', 'unknown_step'] },
      ],
    }), chunkIds);

    expect(parsed).toEqual({
      skillName: 'ordering',
      steps: [
        // 'meeting' was already in precedes (dedupe) and 'disable' folds in as a new
        // forward edge; self and unknown references are dropped, never guessed.
        { stepId: 'approve', description: 'Counsel approves the termination.', evidence: ['policy-1'], precedes: ['meeting', 'disable'] },
        { stepId: 'meeting', description: 'HR conducts the meeting after approval.', evidence: ['policy-1'] },
        { stepId: 'disable', description: 'IT disables access after approval.', evidence: ['policy-1', 'policy-2'] },
      ],
    });
  });

  it('keeps a dependsOn edge across steps cited to different sources', () => {
    // A cross-document ordering ("doc-2 says disable happens after the approval
    // defined in doc-1") legitimately has no shared citation. Requiring one made
    // perfect extractions unable to reach full dependency recall, while the
    // equivalent `precedes` edge passed without the check.
    const parsed = parseSkillExtractionResponse(JSON.stringify({
      skillName: 'ordering',
      steps: [
        { stepId: 'approve', description: 'Counsel approves the termination.', evidence: ['policy-1'] },
        { stepId: 'disable', description: 'IT disables access.', evidence: ['policy-2'], dependsOn: ['approve'] },
      ],
    }), chunkIds);

    expect(parsed).toEqual({
      skillName: 'ordering',
      steps: [
        { stepId: 'approve', description: 'Counsel approves the termination.', evidence: ['policy-1'], precedes: ['disable'] },
        { stepId: 'disable', description: 'IT disables access.', evidence: ['policy-2'] },
      ],
    });
  });

  it('normalizes a weeks deadline to days and still rejects other unknown units', () => {
    const parsed = parseSkillExtractionResponse(JSON.stringify({
      skillName: 'audits',
      steps: [
        { stepId: 'notify', description: 'Notify heads 6 weeks before the audit.', evidence: ['policy-1'], deadline: { value: 6, unit: 'weeks', relativeTo: 'scheduled audit date' } },
        { stepId: 'file', description: 'File within 2 fortnights.', evidence: ['policy-1'], deadline: { value: 2, unit: 'fortnights', relativeTo: 'audit close' } },
      ],
    }), chunkIds);
    expect(parsed).toEqual({
      skillName: 'audits',
      steps: [
        { stepId: 'notify', description: 'Notify heads 6 weeks before the audit.', evidence: ['policy-1'], deadline: { value: 42, unit: 'days', relativeTo: 'scheduled audit date' } },
        { stepId: 'file', description: 'File within 2 fortnights.', evidence: ['policy-1'] },
      ],
    });
  });

  it('expands a multi-target gate per compatible target instead of vetoing the whole gate', () => {
    const parsed = parseSkillExtractionResponse(JSON.stringify({
      skillName: 'gates',
      steps: [
        { stepId: 'clean', description: 'Step with no competing precondition.', evidence: ['policy-1'] },
        { stepId: 'conflicted', description: 'Step already claiming a different predicate on the same subject.', evidence: ['policy-1'], preconditions: [{ subject: 'Board approval', operator: 'equals', value: 'granted' }] },
      ],
      graph: { gates: [{ predicate: { subject: 'Board approval', operator: 'after' }, appliesTo: ['clean', 'conflicted'], evidence: ['policy-1'] }] },
    }), chunkIds);
    expect(parsed).toEqual({
      skillName: 'gates',
      steps: [
        { stepId: 'clean', description: 'Step with no competing precondition.', evidence: ['policy-1'], preconditions: [{ subject: 'Board approval', operator: 'after' }] },
        { stepId: 'conflicted', description: 'Step already claiming a different predicate on the same subject.', evidence: ['policy-1'], preconditions: [{ subject: 'Board approval', operator: 'equals', value: 'granted' }] },
      ],
      graph: { gates: [{ predicate: { subject: 'Board approval', operator: 'after' }, appliesTo: ['clean'], evidence: ['policy-1'] }] },
    });
  });

  it('drops a dependsOn reference to a step that was rejected for missing evidence', () => {
    const parsed = parseSkillExtractionResponse(JSON.stringify({
      skillName: 'ordering',
      steps: [
        { stepId: 'ungrounded', description: 'No evidence step.', evidence: [] },
        { stepId: 'grounded', description: 'Grounded step.', evidence: ['policy-1'], dependsOn: ['ungrounded'] },
      ],
    }), chunkIds);

    expect(parsed).toEqual({
      skillName: 'ordering',
      steps: [{ stepId: 'grounded', description: 'Grounded step.', evidence: ['policy-1'] }],
    });
  });

  it('retains a grounded, typed procedure graph', () => {
    const parsed = parseSkillExtractionResponse(JSON.stringify({
      skillName: 'vendor_onboarding',
      steps: [
        {
          stepId: 'approve_vendor',
          description: 'Finance approves the vendor after due diligence.',
          evidence: ['policy-1'],
          ownerRole: 'Finance',
          preconditions: [{ subject: 'due diligence', operator: 'after' }],
          deadline: { value: 5, unit: 'business_days', relativeTo: 'submission' },
          precedes: ['activate_vendor', 'unknown_step'],
        },
        {
          stepId: 'activate_vendor',
          description: 'Procurement activates the vendor.',
          evidence: ['policy-2'],
          conditions: [{ when: { subject: 'privacy review', operator: 'equals', value: 'approved' }, thenSteps: ['activate_vendor', 'unknown_step'] }],
        },
        {
          stepId: 'duplicate',
          description: 'First duplicate is kept.',
          evidence: ['policy-1'],
        },
        {
          stepId: 'duplicate',
          description: 'Second duplicate is rejected.',
          evidence: ['policy-2'],
        },
      ],
    }), chunkIds);

    expect(parsed).toEqual({
      skillName: 'vendor_onboarding',
      steps: [
        {
          stepId: 'approve_vendor',
          description: 'Finance approves the vendor after due diligence.',
          evidence: ['policy-1'],
          ownerRole: 'Finance',
          preconditions: [{ subject: 'due diligence', operator: 'after' }],
          deadline: { value: 5, unit: 'business_days', relativeTo: 'submission' },
          precedes: ['activate_vendor'],
        },
        {
          stepId: 'activate_vendor',
          description: 'Procurement activates the vendor.',
          evidence: ['policy-2'],
          conditions: [{ when: { subject: 'privacy review', operator: 'equals', value: 'approved' }, thenSteps: ['activate_vendor'] }],
        },
        {
          stepId: 'duplicate',
          description: 'First duplicate is kept.',
          evidence: ['policy-1'],
        },
      ],
    });
  });

  it('drops malformed graph fields without dropping a grounded step', () => {
    const parsed = parseSkillExtractionResponse(JSON.stringify({
      skillName: 'safe_parse',
      steps: [{
        stepId: 'x', description: 'Perform the supported step.', evidence: ['policy-1'],
        preconditions: [{ subject: 'approval', operator: 'invented_operator' }],
        conditions: [{ when: { subject: 'hold', operator: 'equals', value: 'active' }, thenSteps: [] }],
        deadline: { value: -1, unit: 'weeks', relativeTo: '' },
        parallel: { group: '', semantics: 'unordered' },
      }],
    }), chunkIds);

    expect(parsed).toEqual({
      skillName: 'safe_parse',
      steps: [{ stepId: 'x', description: 'Perform the supported step.', evidence: ['policy-1'] }],
    });
  });

  it('propagates an evidence-cited graph gate to every explicit affected step', () => {
    const parsed = parseSkillExtractionResponse(JSON.stringify(normalizationFixtures.approvalGatePropagation), new Set(normalizationFixtures.chunkIds));
    expect(parsed).toMatchObject({
      steps: [
        { stepId: 'hr_meeting', preconditions: [{ subject: 'approval', operator: 'after' }] },
        { stepId: 'it_disable', preconditions: [{ subject: 'approval', operator: 'after' }] },
      ],
      graph: { gates: [{ appliesTo: ['hr_meeting', 'it_disable'], evidence: ['policy-1'] }] },
    });
  });

  it('assigns an evidence-cited parallel group symmetrically to all members', () => {
    const parsed = parseSkillExtractionResponse(JSON.stringify(normalizationFixtures.symmetricParallel), new Set(normalizationFixtures.chunkIds));
    expect(parsed).toMatchObject({
      steps: [
        { stepId: 'finance_review', parallel: { group: 'package_review', semantics: 'unordered' } },
        { stepId: 'security_review', parallel: { group: 'package_review', semantics: 'unordered' } },
      ],
      graph: { parallelGroups: [{ id: 'package_review', members: ['finance_review', 'security_review'], evidence: ['policy-1'] }] },
    });
  });

  it('rejects a one-sided parallel label instead of inventing a member', () => {
    const parsed = parseSkillExtractionResponse(JSON.stringify(normalizationFixtures.oneSidedParallel), new Set(normalizationFixtures.chunkIds));
    expect(parsed).toMatchObject({
      steps: [{ stepId: 'finance_review' }, { stepId: 'security_review' }],
    });
    expect('refused' in parsed! ? undefined : parsed!.steps.some(step => step.parallel !== undefined)).toBe(false);
  });

  it('preserves refusal output without running graph normalization', () => {
    expect(parseSkillExtractionResponse(JSON.stringify(normalizationFixtures.refusal), new Set(normalizationFixtures.chunkIds))).toEqual(normalizationFixtures.refusal);
  });
});
