// skill-extraction.ts
import { chatSynthesis } from './llm.js';
import {
  SKILL_EXTRACTION_SYSTEM_PROMPT,
  buildSkillExtractionUserPrompt,
  parseSkillExtractionResponse,
} from './skill-extraction-prompt.js';

// --- Public Interfaces (Preserved) ---

export interface ExtractedStep {
  stepId: string;
  description: string;
  evidence: string[];
  precedes?: string[];
  /** Explicit graph fields are optional for backward compatibility with existing consumers. */
  ownerRole?: string;
  preconditions?: ExtractedPredicate[];
  conditions?: ExtractedCondition[];
  deadline?: ExtractedDeadline;
  parallel?: { group: string; semantics: 'unordered' | 'required_concurrent' };
  temporalConstraints?: {
    validUntil?: string;
  };
}

export interface ExtractedPredicate {
  subject: string;
  operator: 'equals' | 'greater_than' | 'missing' | 'after';
  value?: string;
  unit?: string;
}

export interface ExtractedCondition {
  when: ExtractedPredicate;
  thenSteps: string[];
  elseSteps?: string[];
}

export interface ExtractedDeadline {
  value: number;
  unit: 'minutes' | 'hours' | 'days' | 'business_days';
  relativeTo: string;
}

export interface ExtractedGraphGate {
  predicate: ExtractedPredicate;
  appliesTo: string[];
  evidence: string[];
}

export interface ExtractedParallelGroup {
  id: string;
  members: string[];
  semantics: 'unordered' | 'required_concurrent';
  evidence: string[];
}

export interface ExtractedProcedureGraph {
  gates?: ExtractedGraphGate[];
  parallelGroups?: ExtractedParallelGroup[];
}

export interface ExtractedProcedure {
  skillName: string;
  steps: ExtractedStep[];
  /** Multi-step relations, normalized onto member steps by the parser. */
  graph?: ExtractedProcedureGraph;
}

export interface SkillExtractionInput {
  domain: string;
  chunks: Array<{ id: string; text: string }>;
}

// --- Implementation ---

/**
 * Extracts a structured procedure from a collection of text chunks using an LLM.
 * This function enforces strict schema and evidence validation on the LLM's output.
 */
export async function extractProcedure(
  opts: SkillExtractionInput
): Promise<ExtractedProcedure | { refused: true; reason: string }> {
  const allChunkIds = new Set(opts.chunks.map((c) => c.id));
  const userPrompt = buildSkillExtractionUserPrompt(opts.chunks);

  for (const _retry of [false, true]) {
    // The prompt is the same on retry, but a real implementation could add a "fix your JSON" message.
    const raw = await chatSynthesis([
      { role: 'system', content: SKILL_EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ]);

    const parsed = parseSkillExtractionResponse(raw, allChunkIds);

    if (parsed) {
      return parsed;
    }
    // If parsing failed, the loop will continue to the retry attempt.
  }

  // If both attempts fail to produce a parseable output, return an empty procedure.
  // This ensures the eval harness can score it as a complete failure without crashing.
  console.error(`[skill-extraction] Could not parse LLM response for domain ${opts.domain} after 2 attempts.`);
  return { skillName: opts.domain, steps: [] };
}
