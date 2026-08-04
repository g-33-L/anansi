// skill-extraction-prompt.ts
import type { ExtractedCondition, ExtractedDeadline, ExtractedGraphGate, ExtractedParallelGroup, ExtractedPredicate, ExtractedProcedure, ExtractedProcedureGraph, ExtractedStep } from './skill-extraction.js';

// 1. --- Prompts ---

export const SKILL_EXTRACTION_SYSTEM_PROMPT = `You are an expert system for extracting structured operational knowledge from unstructured text. Your task is to identify a single, coherent procedure from the provided text chunks and represent it as a JSON object.

**STEP ZERO — REFUSAL CHECK (do this before anything else):** A procedure is a durable, repeatable business process — multiple ordered actions with accountable roles that the organization follows every time the situation recurs. If the text does not contain one, you MUST respond with only this exact JSON object:
\`{ "refused": true, "reason": "The provided text does not contain a clear, actionable procedure." }\`
Refuse questions, bug reports, casual conversation, hypothetical proposals ("could we just..."), one-off logistics or social announcements (an event RSVP, a broken appliance notice, travel arrangements for a specific offsite), and any lone instruction that is not part of a recurring business process. An imperative sentence is NOT a procedure just because it tells someone to do something once.

If a genuine procedure IS present, you MUST adhere to the following rules:

1.  **JSON ONLY:** Your entire response must be a single JSON object, with no other text or explanation.
2.  **Strict Schema:** The JSON object must conform to this exact TypeScript interface:
    \`\`\`typescript
    interface ExtractedProcedure {
      skillName: string; // A concise, snake_case name for the procedure.
      steps: Array<{
        stepId: string; // A unique, snake_case identifier for this step.
        description: string; // A one-sentence description of the step.
        evidence: string[]; // An array of \`chunk_id\`s that directly state or prove this step exists. YOU MUST CITE YOUR WORK.
        precedes?: string[]; // An array of \`stepId\`s that this step must come before. Defines the process flow.
        dependsOn?: string[]; // An array of \`stepId\`s that must complete before this step. The inverse view of \`precedes\` — use whichever reads naturally.
        ownerRole?: string; // The responsible role, exactly as stated in the evidence.
        preconditions?: Array<{ subject: string; operator: "equals" | "greater_than" | "missing" | "after"; value?: string; unit?: string }>; // Gate CONDITIONS that must hold before this step may start — distinct from dependsOn, which is only ordering. Use operator "after" with a short noun-phrase subject naming the required prior outcome (e.g. { subject: "CTO approval", operator: "after" }); use equals/greater_than/missing for a required state, threshold, or absence.
        conditions?: Array<{ when: { subject: string; operator: "equals" | "greater_than" | "missing" | "after"; value?: string; unit?: string }; thenSteps: string[]; elseSteps?: string[] }>;
        deadline?: { value: number; unit: "minutes" | "hours" | "days" | "business_days"; relativeTo: string };
        parallel?: { group: string; semantics: "unordered" | "required_concurrent" };
      }>;
      graph?: {
        gates?: Array<{ predicate: { subject: string; operator: "equals" | "greater_than" | "missing" | "after"; value?: string; unit?: string }; appliesTo: string[]; evidence: string[] }>;
        parallelGroups?: Array<{ id: string; members: string[]; semantics: "unordered" | "required_concurrent"; evidence: string[] }>;
      };
    }
    \`\`\`
3.  **Grounding & Citations:** Every step MUST be directly supported by the provided chunks. Do not infer or invent steps. \`evidence\` lists EVERY \`chunk_id\` that states or constrains the step — a step defined in one chunk whose deadline, approver, or trigger is stated in another cites both. Policy documents are canonical: when a chat message announces a change or a different value for something a policy document states (a threshold, a time window, a date), extract the DOCUMENTED value and cite the document — do not adopt the chat value and do not cite that chat message. Cite a chat message only when it states procedure content that no document states. Never create a new step from a chat message that merely clarifies or restates an action you already emitted.
4.  **Step Granularity — one actor, one action:**
    - A sentence in which several named actors each perform the same activity ("Legal, Finance, and Operations each collect their documents") yields ONE STEP PER ACTOR, each with its own \`ownerRole\` — never one step with a list of roles.
    - Every stated decision is a step: when the source chooses a path by amount, score, type, or severity ("expenses over $5,000 route to the CFO"), emit the routing/decision step itself AND one step per branch action.
    - Every action a branch triggers (a rejection, an exception review, an escalation, a return-for-correction) is its own step, even if it only runs in that case.
    - A stated standing requirement ("Receipts are required for all expenses over $25") is a step owned by whoever satisfies it.
    - Do NOT emit umbrella or summary steps that merely restate other steps ("obtain all approvals", "run the parallel workstreams", "compile the review results") — the real next action that waits for them is the join. Do not split one stated action into two steps.
5.  **Ordering:** EVERY step except the true starting point(s) MUST carry \`dependsOn\` listing its immediate predecessor stepId(s). A narrative sequence ("X, then Y", "after X, do Y", numbered steps) chains each step on the one before it. THREE exceptions — never chain these:
    - Parallel-group members (rule 10) NEVER appear in each other's \`dependsOn\`, even when described in the same or consecutive sentences: each member dependsOn the shared predecessor, and the step that waits for the branches lists ALL members in its \`dependsOn\`.
    - Alternative branches of one decision (approval tiers, if/else paths) never chain to each other: each branch dependsOn the routing/decision step.
    - "X is required before Z" orders X before Z only — do not also place X before unrelated earlier steps.
    A procedure with N steps normally has at least N-1 ordering edges; a steps array with no \`dependsOn\` fields is almost always wrong.
6.  **Preconditions Are Gates, Not Ordering:** \`dependsOn\` records only ORDER; \`preconditions\` records the CONDITION that must hold before the step may start. They are complementary, never substitutes: whenever a step has \`dependsOn\`, ALSO emit \`preconditions\` with operator \`"after"\`:
    - The \`subject\` is the SOURCE'S OWN short noun phrase for the required prior outcome, in compact noun form ("manager approval", "document collection", "CTO approval" — not "documents were collected"). Keep the qualifying words the source uses ("incident commander notification", never just "notification").
    - If the source states the gate as ONE collective phrase ("until all three written reports are complete", "requires dual approval"), emit ONE entry with that collective phrase as subject ("all three written reports", "dual approval").
    - Otherwise emit one entry PER predecessor, each naming that predecessor's outcome and keeping its actor when several actors do the same activity ("IT evidence collection", "Engineering evidence collection") — no invented summaries.
    - "after X", "once X is complete", "until X is done", "upon X", and "X must happen before Y" (seen from Y's side) are ALL operator \`"after"\` gates. Use \`equals\`/\`greater_than\`/\`missing\` only for a required state, threshold, or absence.
7.  **Conditions:** EVERY if/when/unless/only-if/in-case sentence in the source MUST produce a \`conditions\` entry — no conditional sentence may remain prose-only.
    - Attach the entry to the step where the outcome becomes known (the test, review, or decision step), with \`thenSteps\`/\`elseSteps\` pointing at the branch steps. When no separate deciding step is stated ("If distribution has begun, Customer Operations sends the notice"), attach it to the conditional step itself with its own stepId in \`thenSteps\`.
    - \`when.subject\` names the tested ATTRIBUTE as a short noun phrase ("expense total", "questionnaire score", "contract status", "destination country", "work location") — never a whole clause.
    - \`when.value\` is the bare stated state or number ("active", "foreign", "confirmed", "5000") — strip verbs, auxiliaries, currency symbols, and commas ("deemed patentable" becomes "patentable"; "$5,000" becomes "5000"). A whole clause as subject with a boolean placeholder value ("true") is ALWAYS wrong.
    - Thresholds: "over N" / "exceeding N" is \`greater_than\` N; "N or above" / "at least N" is \`greater_than\` N-1 (a score of 80 or above: \`{ "subject": "questionnaire score", "operator": "greater_than", "value": "79" }\`). There is no less-than operator: express "below N" as the \`elseSteps\` branch of \`greater_than\` N-1.
    - A sentence with several outcomes ("if met, close; if partially met, extend; if not met, terminate") yields one \`conditions\` entry per outcome, and each outcome's action is its own step.
    Point \`thenSteps\`/\`elseSteps\` only at emitted stepIds. Subjects and values are natural-language phrases, never snake_case identifiers.
8.  **Deadlines:** Whenever a duration and its reference event are stated in ANY chunk supporting the step, populate the structured \`deadline\` — never leave it prose-only. Convert to the allowed units: "6 weeks" is 42 days; "1 year" is 365 days; "by day 60" of a plan is 60 days from the plan start; "on or before the first day" is 1 day. \`relativeTo\` names the anchoring EVENT as a short natural-language phrase from the source ("receipt of the disclosure", "final approval", "scheduled audit date") — never a stepId and never snake_case.
9.  **Roles:** \`ownerRole\` is the actor who PERFORMS the step — the subject of the action verb — never the approver, recipient, or audience ("Security submits the package to the Audit Committee": ownerRole "Security"; the committee's approval is a separate step owned by the committee). For a passive sentence ("the package is submitted"), use the performer the chunks name for that action. A UI screen, dashboard, or menu path is NOT an actor even when the step is phrased as using it ("Enable daily backups in the Railway dashboard" names no actor — omit \`ownerRole\`; never emit a product surface or navigation path as the owner). A named automated system IS a valid owner when the source states it performs the action itself ("a nightly cron runs pg_dump": ownerRole the cron/system as named). Never invent a generic team name ("Operations", "the team") that is not itself stated in the source. Omit \`ownerRole\` whenever no chunk names a real actor. One role per step (rule 4).
10. **Parallelism:** Parallel groups come ONLY from stated concurrency wording ("while", "in parallel", "at the same time", "simultaneously", "concurrently", "each ... in parallel"). Give EVERY step that wording names — and ONLY those steps — the same \`parallel.group\` with the same semantics; a group with one labelled member is invalid, and inventing a group the source does not state is wrong. Group members NEVER appear in each other's \`dependsOn\` (rule 5). If concurrency is not stated, emit no \`parallel\` field at all.
11. **Graph Mirror:** For every relation that applies to multiple steps, also emit it once in \`graph\`: a gate lists every affected step in \`appliesTo\`, a parallel group lists every member in \`members\`, and both cite the chunk IDs that state the relation. A parallel group must have at least two members.

**WORKED EXAMPLE** (illustrative only — NEVER copy its steps, names, or values unless the provided evidence states the same facts):
Input chunks:
- camp-doc-1: "Marketing submits a campaign brief for every new paid campaign. Marketing Operations checks each brief for completeness; briefs missing a signed budget form are returned to Marketing for correction."
- camp-doc-2: "After the completeness check, Legal reviews the claims and Brand reviews the creative in parallel. Approval routing may begin only once both reviews are complete."
- camp-doc-3: "Marketing Operations routes the brief for approval: campaigns budgeted at $50,000 or above require CMO approval; smaller campaigns are approved by the Marketing Director."
- camp-doc-4: "Marketing launches the campaign within two business days of CMO approval. If a defect is found after launch, Marketing Operations pauses the campaign immediately."
- camp-chat-1: "Heads up — the CMO approval threshold is moving to $75,000 next quarter."
- camp-chat-2: "Anyone know where the new banner templates live?"

Correct output:
\`\`\`json
{
  "skillName": "paid_campaign_approval",
  "steps": [
    { "stepId": "submit_campaign_brief", "description": "Marketing submits a campaign brief for the new paid campaign.", "ownerRole": "Marketing", "evidence": ["camp-doc-1"] },
    { "stepId": "completeness_check", "description": "Marketing Operations checks the brief for completeness.", "ownerRole": "Marketing Operations", "dependsOn": ["submit_campaign_brief"], "preconditions": [{ "subject": "campaign brief submission", "operator": "after" }], "conditions": [{ "when": { "subject": "signed budget form", "operator": "missing" }, "thenSteps": ["return_brief"] }], "evidence": ["camp-doc-1"] },
    { "stepId": "return_brief", "description": "Marketing Operations returns an incomplete brief to Marketing for correction.", "ownerRole": "Marketing Operations", "dependsOn": ["completeness_check"], "preconditions": [{ "subject": "completeness check", "operator": "after" }], "evidence": ["camp-doc-1"] },
    { "stepId": "legal_claims_review", "description": "Legal reviews the campaign claims.", "ownerRole": "Legal", "dependsOn": ["completeness_check"], "preconditions": [{ "subject": "completeness check", "operator": "after" }], "parallel": { "group": "campaign_reviews", "semantics": "unordered" }, "evidence": ["camp-doc-2"] },
    { "stepId": "brand_creative_review", "description": "Brand reviews the campaign creative.", "ownerRole": "Brand", "dependsOn": ["completeness_check"], "preconditions": [{ "subject": "completeness check", "operator": "after" }], "parallel": { "group": "campaign_reviews", "semantics": "unordered" }, "evidence": ["camp-doc-2"] },
    { "stepId": "route_for_approval", "description": "Marketing Operations routes the brief to the appropriate approver based on budget.", "ownerRole": "Marketing Operations", "dependsOn": ["legal_claims_review", "brand_creative_review"], "preconditions": [{ "subject": "both reviews", "operator": "after" }], "conditions": [{ "when": { "subject": "campaign budget", "operator": "greater_than", "value": "49999" }, "thenSteps": ["cmo_approval"], "elseSteps": ["director_approval"] }], "evidence": ["camp-doc-2", "camp-doc-3"] },
    { "stepId": "cmo_approval", "description": "The CMO approves a campaign budgeted at $50,000 or above.", "ownerRole": "CMO", "dependsOn": ["route_for_approval"], "preconditions": [{ "subject": "approval routing", "operator": "after" }], "evidence": ["camp-doc-3"] },
    { "stepId": "director_approval", "description": "The Marketing Director approves a smaller campaign.", "ownerRole": "Marketing Director", "dependsOn": ["route_for_approval"], "preconditions": [{ "subject": "approval routing", "operator": "after" }], "evidence": ["camp-doc-3"] },
    { "stepId": "launch_campaign", "description": "Marketing launches the campaign within two business days of CMO approval.", "ownerRole": "Marketing", "dependsOn": ["cmo_approval"], "preconditions": [{ "subject": "CMO approval", "operator": "after" }], "deadline": { "value": 2, "unit": "business_days", "relativeTo": "CMO approval" }, "conditions": [{ "when": { "subject": "defect", "operator": "equals", "value": "found" }, "thenSteps": ["pause_campaign"] }], "evidence": ["camp-doc-3", "camp-doc-4"] },
    { "stepId": "pause_campaign", "description": "Marketing Operations pauses the campaign when a defect is found after launch.", "ownerRole": "Marketing Operations", "dependsOn": ["launch_campaign"], "preconditions": [{ "subject": "campaign launch", "operator": "after" }], "evidence": ["camp-doc-4"] }
  ],
  "graph": {
    "gates": [{ "predicate": { "subject": "completeness check", "operator": "after" }, "appliesTo": ["legal_claims_review", "brand_creative_review"], "evidence": ["camp-doc-2"] }],
    "parallelGroups": [{ "id": "campaign_reviews", "members": ["legal_claims_review", "brand_creative_review"], "semantics": "unordered", "evidence": ["camp-doc-2"] }]
  }
}
\`\`\`
Note how the example applies the rules: "Legal reviews ... and Brand reviews ... in parallel" produced TWO steps sharing one group and NO edge between them; the budget routing is its own step whose two branches each depend on it and never on each other; every non-initial step pairs \`dependsOn\` with an \`"after"\` precondition; "$50,000 or above" became \`greater_than "49999"\`; "two business days" became a structured deadline anchored to the stated event; camp-chat-1 announces a future change to a documented value, so the documented $50,000 threshold is extracted and camp-chat-1 is not cited; camp-chat-2 is unrelated noise and is ignored.

**FINAL CHECKLIST before responding:**
- Every source sentence containing an actor, an order word, a gate, an if/unless branch, a deadline, a threshold, or parallel wording is reflected in a typed field on the supported step.
- Every named actor performing an activity has their own step; no umbrella steps; every stated decision and branch action is a step.
- Every non-initial step has \`dependsOn\` PLUS matching \`preconditions\`; no \`dependsOn\` between parallel-group members; no chains across alternative branches.
- Every stated duration is a structured \`deadline\`; every conditional sentence has a \`conditions\` entry whose value is a stated state or number, never a boolean.
- Every \`ownerRole\` is an actor named in the chunks, never a UI surface, menu path, or invented team name.
- Extracted values are the documented policy values, not chat announcements.
- If the text failed STEP ZERO, your entire response is the refusal object and nothing else.`;

export function buildSkillExtractionUserPrompt(chunks: Array<{ id: string; text: string }>): string {
  const chunksBlock = chunks.map((c) => `chunk_id: ${c.id}\ntext: ${c.text}`).join('\n---\n');

  return `Here are the text chunks.
---
${chunksBlock}
---
Now, extract the procedure as a JSON object according to the rules.`;
}

// 2. --- Parser & Validation (The Enforcement Boundary) ---

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

const PREDICATE_OPERATORS = new Set<ExtractedPredicate['operator']>(['equals', 'greater_than', 'missing', 'after']);
const DEADLINE_UNITS = new Set<ExtractedDeadline['unit']>(['minutes', 'hours', 'days', 'business_days']);

function mapPredicate(raw: unknown): ExtractedPredicate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const subject = asString(value.subject);
  const operator = asString(value.operator);
  if (!subject || !operator || !PREDICATE_OPERATORS.has(operator as ExtractedPredicate['operator'])) return null;
  const predicate: ExtractedPredicate = { subject, operator: operator as ExtractedPredicate['operator'] };
  const predicateValue = asString(value.value);
  const unit = asString(value.unit);
  if (predicateValue) predicate.value = predicateValue;
  if (unit) predicate.unit = unit;
  return predicate;
}

function mapDeadline(raw: unknown): ExtractedDeadline | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  let amount = value.value;
  let unit = asString(value.unit);
  // Deterministic unit normalization only — "N weeks" is exactly "7N days".
  // Anything else outside the enum is still rejected, never guessed.
  if (unit === 'weeks' && typeof amount === 'number' && Number.isFinite(amount)) {
    unit = 'days';
    amount = amount * 7;
  }
  const relativeTo = asString(value.relativeTo);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || !unit || !relativeTo || !DEADLINE_UNITS.has(unit as ExtractedDeadline['unit'])) return undefined;
  return { value: amount, unit: unit as ExtractedDeadline['unit'], relativeTo };
}

function mapParallel(raw: unknown): ExtractedStep['parallel'] | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const group = asString(value.group);
  const semantics = asString(value.semantics);
  if (!group || (semantics !== 'unordered' && semantics !== 'required_concurrent')) return undefined;
  return { group, semantics };
}

function mapCondition(raw: unknown): ExtractedCondition | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const when = mapPredicate(value.when);
  const thenSteps = Array.isArray(value.thenSteps) ? value.thenSteps.map(asString).filter((id): id is string => id !== null) : [];
  const elseSteps = Array.isArray(value.elseSteps) ? value.elseSteps.map(asString).filter((id): id is string => id !== null) : undefined;
  if (!when || thenSteps.length === 0) return null;
  return { when, thenSteps, ...(elseSteps?.length ? { elseSteps } : {}) };
}

function uniqueKnownIds(raw: unknown, knownIds: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(asString).filter((id): id is string => id !== null && knownIds.has(id)))];
}

function mapGraphGate(raw: unknown, stepIds: Set<string>, chunkIds: Set<string>): ExtractedGraphGate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const predicate = mapPredicate(value.predicate);
  const appliesTo = uniqueKnownIds(value.appliesTo, stepIds);
  const evidence = uniqueKnownIds(value.evidence, chunkIds);
  return predicate && appliesTo.length > 0 && evidence.length > 0 ? { predicate, appliesTo, evidence } : null;
}

function mapParallelGroup(raw: unknown, stepIds: Set<string>, chunkIds: Set<string>): ExtractedParallelGroup | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const id = asString(value.id);
  const semantics = asString(value.semantics);
  const members = uniqueKnownIds(value.members, stepIds);
  const evidence = uniqueKnownIds(value.evidence, chunkIds);
  if (!id || (semantics !== 'unordered' && semantics !== 'required_concurrent') || members.length < 2 || evidence.length === 0) return null;
  return { id, members, semantics, evidence };
}

function mapProcedureGraph(raw: unknown, stepIds: Set<string>, chunkIds: Set<string>): ExtractedProcedureGraph | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const gates = Array.isArray(value.gates)
    ? value.gates.map(gate => mapGraphGate(gate, stepIds, chunkIds)).filter((gate): gate is ExtractedGraphGate => gate !== null)
    : [];
  const parallelGroups = Array.isArray(value.parallelGroups)
    ? value.parallelGroups.map(group => mapParallelGroup(group, stepIds, chunkIds)).filter((group): group is ExtractedParallelGroup => group !== null)
    : [];
  return gates.length || parallelGroups.length ? {
    ...(gates.length ? { gates } : {}),
    ...(parallelGroups.length ? { parallelGroups } : {}),
  } : undefined;
}

function predicateKey(predicate: ExtractedPredicate): string {
  return [predicate.subject, predicate.operator, predicate.value ?? '', predicate.unit ?? ''].map(value => value.toLowerCase().trim()).join('\u0000');
}

function sameSubject(left: ExtractedPredicate, right: ExtractedPredicate): boolean {
  return left.subject.toLowerCase().trim() === right.subject.toLowerCase().trim();
}

/**
 * `dependsOn` is an input-side alias only: models state order far more reliably as
 * "this step comes after X" than as a forward `precedes` list. It is folded into
 * the named predecessor's `precedes` before output, so the public contract keeps a
 * single canonical edge direction.
 */
type StepWithOrderingAlias = ExtractedStep & { dependsOn?: string[] };

function mapExtractedStep(rawStep: unknown, allChunkIds: Set<string>): StepWithOrderingAlias | null {
  if (typeof rawStep !== 'object' || rawStep === null) return null;
  const r = rawStep as Record<string, unknown>;

  const stepId = asString(r.stepId);
  const description = asString(r.description);
  if (!stepId || !description) return null; // Required fields

  // Validate evidence: must be an array of strings, and each ID must have been in the input.
  const evidenceRaw = Array.isArray(r.evidence) ? r.evidence : [];
  const validEvidence = evidenceRaw.map(asString).filter((id): id is string => id !== null && allChunkIds.has(id));

  // **CONSTRAINT:** If a step ends up with no valid evidence after validation, reject the step.
  if (validEvidence.length === 0) {
    return null;
  }

  // Validate precedes/dependsOn: must be arrays of strings.
  const precedes = Array.isArray(r.precedes)
    ? r.precedes.map(asString).filter((id): id is string => id !== null)
    : undefined;
  const dependsOn = Array.isArray(r.dependsOn)
    ? r.dependsOn.map(asString).filter((id): id is string => id !== null)
    : undefined;

  const ownerRole = asString(r.ownerRole) ?? undefined;
  const preconditions = Array.isArray(r.preconditions)
    ? r.preconditions.map(mapPredicate).filter((predicate): predicate is ExtractedPredicate => predicate !== null)
    : undefined;
  const conditions = Array.isArray(r.conditions)
    ? r.conditions.map(mapCondition).filter((condition): condition is ExtractedCondition => condition !== null)
    : undefined;
  const deadline = mapDeadline(r.deadline);
  const parallel = mapParallel(r.parallel);

  return {
    stepId,
    description,
    evidence: validEvidence,
    ...(precedes?.length ? { precedes } : {}),
    ...(dependsOn?.length ? { dependsOn } : {}),
    ...(ownerRole ? { ownerRole } : {}),
    ...(preconditions?.length ? { preconditions } : {}),
    ...(conditions?.length ? { conditions } : {}),
    ...(deadline ? { deadline } : {}),
    ...(parallel ? { parallel } : {}),
  };
}

function keepKnownStepReferences(step: StepWithOrderingAlias, stepIds: Set<string>): StepWithOrderingAlias {
  const { precedes: _precedes, dependsOn: _dependsOn, conditions: _conditions, ...rest } = step;
  const precedes = step.precedes?.filter(id => stepIds.has(id) && id !== step.stepId);
  const dependsOn = step.dependsOn?.filter(id => stepIds.has(id) && id !== step.stepId);
  const conditions = step.conditions?.flatMap(condition => {
    const thenSteps = condition.thenSteps.filter(id => stepIds.has(id));
    const elseSteps = condition.elseSteps?.filter(id => stepIds.has(id));
    return thenSteps.length ? [{ ...condition, thenSteps, ...(elseSteps?.length ? { elseSteps } : {}) }] : [];
  });
  return {
    ...rest,
    ...(precedes?.length ? { precedes: [...new Set(precedes)] } : {}),
    ...(dependsOn?.length ? { dependsOn: [...new Set(dependsOn)] } : {}),
    ...(conditions?.length ? { conditions } : {}),
  };
}

/**
 * Folds each `dependsOn` entry into the named predecessor's `precedes`.
 * Both aliases are treated identically: an ordering the model states through
 * either field is kept as long as both endpoints are grounded steps. (An earlier
 * version additionally required the two steps to share a cited chunk, but a
 * cross-document ordering — "the Board ratifies before SEC filing" in doc-4
 * gating a step whose definition lives in doc-3 — legitimately has no shared
 * citation; the requirement dropped true edges while `precedes` passed freely.)
 * Unknown/self references are still dropped rather than inferred.
 */
function foldDependsOnIntoPrecedes(steps: StepWithOrderingAlias[]): ExtractedStep[] {
  const stepById = new Map(steps.map(step => [step.stepId, step]));
  for (const step of steps) {
    for (const id of step.dependsOn ?? []) {
      const predecessor = stepById.get(id);
      if (!predecessor) continue; // parse() filters unknown ids first; keep the fold safe standalone
      if (!(predecessor.precedes ?? []).includes(step.stepId)) {
        predecessor.precedes = [...(predecessor.precedes ?? []), step.stepId];
      }
    }
    delete step.dependsOn;
  }
  return steps;
}

/**
 * Enforces graph invariants without inferring any new operational facts. A graph
 * relation may expand only across the explicit, evidence-cited member IDs emitted
 * by the model. Singleton/conflicting parallel labels are removed rather than
 * guessed, which keeps false-positive graph structure out of production output.
 */
export function normalizeProcedureGraph(procedure: ExtractedProcedure): ExtractedProcedure {
  const steps = procedure.steps.map(step => ({ ...step, ...(step.preconditions ? { preconditions: [...step.preconditions] } : {}) }));
  const stepById = new Map(steps.map(step => [step.stepId, step]));
  const acceptedGates: ExtractedGraphGate[] = [];
  const acceptedGroups: ExtractedParallelGroup[] = [];

  for (const gate of procedure.graph?.gates ?? []) {
    const targets = gate.appliesTo.map(id => stepById.get(id)!);
    // A same-subject/different-predicate conflict on ONE target means the model
    // contradicted itself about that step only. The gate remains an explicit,
    // evidence-cited fact for the other steps it lists, so skip the conflicting
    // targets rather than vetoing the whole gate, and narrow the published
    // appliesTo to the steps that actually carry the predicate.
    const compatible = targets.filter(step => !(step.preconditions ?? []).some(existing => sameSubject(existing, gate.predicate) && predicateKey(existing) !== predicateKey(gate.predicate)));
    if (compatible.length === 0) continue;
    for (const step of compatible) {
      if (!(step.preconditions ?? []).some(existing => predicateKey(existing) === predicateKey(gate.predicate))) {
        step.preconditions = [...(step.preconditions ?? []), gate.predicate];
      }
    }
    acceptedGates.push(compatible.length === targets.length ? gate : { ...gate, appliesTo: compatible.map(step => step.stepId) });
  }

  for (const group of procedure.graph?.parallelGroups ?? []) {
    const members = group.members.map(id => stepById.get(id)!);
    const conflicts = members.some(step => step.parallel !== undefined &&
      (step.parallel.group !== group.id || step.parallel.semantics !== group.semantics));
    if (conflicts) continue;
    for (const step of members) step.parallel = { group: group.id, semantics: group.semantics };
    acceptedGroups.push(group);
  }

  const membersByGroup = new Map<string, ExtractedStep[]>();
  for (const step of steps) if (step.parallel) {
    const members = membersByGroup.get(step.parallel.group) ?? [];
    members.push(step); membersByGroup.set(step.parallel.group, members);
  }
  for (const members of membersByGroup.values()) {
    const semantics = new Set(members.map(member => member.parallel!.semantics));
    if (members.length < 2 || semantics.size !== 1) for (const member of members) delete member.parallel;
  }

  // A group whose step-level labels were just stripped (singleton or mixed
  // semantics) must not survive as a published graph relation either — the
  // output would claim structure its own steps no longer carry.
  const liveGroups = new Set(steps.filter(step => step.parallel).map(step => step.parallel!.group));
  const publishedGroups = acceptedGroups.filter(group => liveGroups.has(group.id));

  return {
    skillName: procedure.skillName,
    steps,
    ...(acceptedGates.length || publishedGroups.length ? {
      graph: {
        ...(acceptedGates.length ? { gates: acceptedGates } : {}),
        ...(publishedGroups.length ? { parallelGroups: publishedGroups } : {}),
      },
    } : {}),
  };
}

type ParsedOutput = ExtractedProcedure | { refused: true; reason: string };

export function parseSkillExtractionResponse(raw: string, allChunkIds: Set<string>): ParsedOutput | null {
  const build = (parsed: unknown): ParsedOutput | null => {
    if (typeof parsed !== 'object' || parsed === null) return null;
    const p = parsed as Record<string, unknown>;

    // Handle refusal case
    if (p.refused === true) {
      return { refused: true, reason: asString(p.reason) ?? 'unspecified' };
    }

    const skillName = asString(p.skillName);
    if (!skillName) return null;

    const stepsRaw = Array.isArray(p.steps) ? p.steps : [];
    const seenStepIds = new Set<string>();
    const validatedSteps = stepsRaw
      .map((step) => mapExtractedStep(step, allChunkIds))
      .filter((step): step is ExtractedStep => step !== null)
      .filter(step => !seenStepIds.has(step.stepId) && (seenStepIds.add(step.stepId), true));

    const stepIds = new Set(validatedSteps.map(step => step.stepId));
    const procedure: ExtractedProcedure = {
      skillName,
      steps: foldDependsOnIntoPrecedes(validatedSteps.map(step => keepKnownStepReferences(step, stepIds))),
    };
    const graph = mapProcedureGraph(p.graph, stepIds, allChunkIds);
    if (graph) procedure.graph = graph;
    return normalizeProcedureGraph(procedure);
  };

  // Resilient parsing, mirroring attestation-extraction
  const stripped = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
  try {
    const out = build(JSON.parse(stripped));
    if (out) return out;
  } catch {
    // fall through to regex
  }

  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const out = build(JSON.parse(match[0]));
      if (out) return out;
    } catch {
      // give up
    }
  }

  return null;
}
