// Pure synthesis prompt + response handling — no DB/Redis imports, so the
// offline eval harness (scripts/eval/) can exercise the EXACT production
// prompt and parser without booting infrastructure. workers/synthesis.ts is
// the only other consumer; keep this module side-effect free.

import type { TemporalFact } from "../db/schema.js";
import type { ExtractedEntity, ExtractedRelationship } from "./entity-graph.js";

export const MAX_STATIC_FACTS = 30;
export const MAX_DYNAMIC_CONTEXT = 15;
export const MAX_TEMPORAL_FACTS = 30;
export const MAX_ENTITIES = 50;
export const MAX_RELATIONSHIPS_PER_ENTITY = 20;

export interface SynthesisResult {
  static_facts: string[];
  dynamic_context: string[];
  // Optional extended extraction (user synthesis only) — backwards compatible
  temporal_facts?: TemporalFact[];
  entities?: ExtractedEntity[];
}

function isValidSynthesisResult(parsed: unknown): parsed is SynthesisResult {
  if (typeof parsed !== "object" || parsed === null) return false;
  const p = parsed as Record<string, unknown>;
  return (
    Array.isArray(p.static_facts) &&
    Array.isArray(p.dynamic_context) &&
    (p.static_facts as unknown[]).every((f) => typeof f === "string") &&
    (p.dynamic_context as unknown[]).every((f) => typeof f === "string")
  );
}

// Lenient cleanup of the optional extended fields — a malformed entity or
// temporal fact is dropped rather than failing the whole synthesis pass.
function sanitizeExtendedFields(result: SynthesisResult): SynthesisResult {
  const temporal = Array.isArray(result.temporal_facts)
    ? result.temporal_facts
        .filter((t): t is TemporalFact => typeof t === "object" && t !== null && typeof (t as TemporalFact).fact === "string")
        .map((t) => ({
          fact: t.fact,
          validFrom: typeof t.validFrom === "string" ? t.validFrom : null,
          validUntil: typeof t.validUntil === "string" ? t.validUntil : null,
        }))
        .slice(0, MAX_TEMPORAL_FACTS)
    : undefined;

  const entities = Array.isArray(result.entities)
    ? result.entities
        .filter(
          (e): e is ExtractedEntity =>
            typeof e === "object" && e !== null &&
            typeof (e as ExtractedEntity).name === "string" && (e as ExtractedEntity).name.trim() !== "" &&
            typeof (e as ExtractedEntity).type === "string" && (e as ExtractedEntity).type.trim() !== ""
        )
        .map((e) => ({
          type: e.type.trim().toLowerCase(),
          name: e.name.trim(),
          relationships: Array.isArray(e.relationships)
            ? e.relationships
                .filter(
                  (r): r is ExtractedRelationship =>
                    typeof r === "object" && r !== null &&
                    typeof (r as ExtractedRelationship).type === "string" &&
                    typeof (r as ExtractedRelationship).target === "string" &&
                    (r as ExtractedRelationship).target.trim() !== ""
                )
                .slice(0, MAX_RELATIONSHIPS_PER_ENTITY)
            : [],
        }))
        .slice(0, MAX_ENTITIES)
    : undefined;

  return { ...result, temporal_facts: temporal, entities };
}

// Merge incoming temporal facts into the existing set instead of replacing it.
// History is the product's differentiating feature: a synthesis pass whose LLM
// output omits or empties temporal_facts must NOT wipe previously recorded facts.
// Contract: the model may APPEND new facts or CLOSE an existing one (by re-emitting
// it with a validUntil); it can never silently drop a fact. Keyed on the fact text
// so a re-emitted fact overrides the stored copy (e.g. to set validUntil).
export function mergeTemporalFacts(
  existing: TemporalFact[],
  incoming: TemporalFact[] | undefined
): TemporalFact[] {
  // `undefined` = the field was absent/malformed (older models); keep existing.
  // An empty array = "nothing new to add", which must also preserve existing.
  if (!incoming || incoming.length === 0) return existing.slice(0, MAX_TEMPORAL_FACTS);
  const byFact = new Map<string, TemporalFact>();
  for (const f of existing) byFact.set(f.fact.trim().toLowerCase(), f);
  for (const f of incoming) byFact.set(f.fact.trim().toLowerCase(), f); // incoming wins (can set validUntil)
  return [...byFact.values()].slice(0, MAX_TEMPORAL_FACTS);
}

export function parseSynthesisResponse(raw: string): SynthesisResult | null {
  // 1. Strip markdown code fences and try direct parse
  const stripped = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    if (isValidSynthesisResult(parsed)) return sanitizeExtendedFields(parsed);
  } catch {
    // Direct parse of the fence-stripped response failed — fall through to regex extraction below.
  }

  // 2. Extract the outermost {...} from anywhere in the response (handles preamble/postamble)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (isValidSynthesisResult(parsed)) return sanitizeExtendedFields(parsed);
    } catch {
      // Extracted {...} block still isn't valid JSON — give up and log the unparseable response below.
    }
  }

  console.error("[synthesis] Could not parse LLM response:", raw.slice(0, 300));
  return null;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
// These strings are the production prompts. The eval harness scores THESE —
// any wording change here is a model-behavior change and should re-run
// `pnpm --filter @anansi/api eval:synthesis` before shipping.

export const WORKSPACE_SYNTHESIS_SYSTEM_PROMPT =
  "You are a company knowledge manager. Your only job is to output a JSON object. No explanations. No preamble. Output only the JSON.";

export const USER_SYNTHESIS_SYSTEM_PROMPT =
  "You are a personal memory manager. Your only job is to output a JSON object. No explanations. No preamble. Output only the JSON.";

export function buildWorkspaceSynthesisPrompt(opts: {
  staticFacts: string[];
  dynamicContext: string[];
  chunksText: string;
  retry: boolean;
}): string {
  return `${opts.retry ? "OUTPUT ONLY JSON. NO TEXT BEFORE OR AFTER.\n\n" : ""}Existing facts:
${JSON.stringify(opts.staticFacts)}

Existing context:
${JSON.stringify(opts.dynamicContext)}

New workspace messages to integrate:
--- BEGIN MESSAGES ---
${opts.chunksText}
--- END MESSAGES ---

Output this JSON object updated with new information (rules: static_facts = stable decisions/roles/processes max 30; dynamic_context = current work/sprint/bugs max 15; merge duplicates):
{"static_facts":["..."],"dynamic_context":["..."]}`;
}

export function buildUserSynthesisPrompt(opts: {
  staticFacts: string[];
  dynamicContext: string[];
  temporalFacts: TemporalFact[];
  chunksText: string;
  retry: boolean;
}): string {
  return `${opts.retry ? "OUTPUT ONLY JSON. NO TEXT BEFORE OR AFTER.\n\n" : ""}Existing stable facts about this user:
${JSON.stringify(opts.staticFacts)}

Existing recent context about this user:
${JSON.stringify(opts.dynamicContext)}

Existing time-bounded facts about this user:
${JSON.stringify(opts.temporalFacts)}

New content to integrate:
--- BEGIN CONTENT ---
${opts.chunksText}
--- END CONTENT ---

Output this JSON with updated personal profile. Rules:
- static_facts: stable personal info/preferences/expertise, max 30, merge duplicates
- dynamic_context: recent activity/current goals/ongoing topics, max 15
- temporal_facts: time-bounded facts (jobs, roles, residences, projects). validFrom/validUntil are "YYYY-MM" or null. validUntil null = still true. When a new fact supersedes an old one (e.g. changed jobs), set the old fact's validUntil. Max ${MAX_TEMPORAL_FACTS}.
- entities: people/orgs/tech/projects/locations this user knows or uses, with relationships. relationship types: works_at, uses, knows, member_of, reports_to, building. current=false means the relationship ended. Max ${MAX_ENTITIES}.
{"static_facts":["..."],"dynamic_context":["..."],"temporal_facts":[{"fact":"...","validFrom":"YYYY-MM","validUntil":null}],"entities":[{"type":"person","name":"Alex","relationships":[{"type":"works_at","target":"Stripe","targetType":"org","current":true}]}]}`;
}
