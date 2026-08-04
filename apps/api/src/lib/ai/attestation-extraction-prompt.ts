// Attestation extraction contract (PR-2). The LLM is a REPORTER and CLASSIFIER:
// it proposes claims with verbatim evidence and classifications only. It must
// never emit a confidence score, a system timestamp, or an invented date — those
// are owned by the system (see attestation-ingest.ts). This module is
// side-effect free (types, parser, prompts) so the eval harness can score it.

export type ClaimType = "propositional" | "role" | "policy";
export type Polarity = "assertion" | "negation";
export type InferenceStatus = "stated" | "corroborated" | "inferred";
export type ValidFromBasis = "stated" | "knowledge_derived" | "unknown";
export type CorrectionReason = "change" | "correction";

const CLAIM_TYPES: ClaimType[] = ["propositional", "role", "policy"];
const POLARITIES: Polarity[] = ["assertion", "negation"];
const INFERENCE_STATUSES: InferenceStatus[] = ["stated", "corroborated", "inferred"];
const VALID_FROM_BASES: ValidFromBasis[] = ["stated", "knowledge_derived", "unknown"];

// A single piece of evidence the model cites: a verbatim quote located in a chunk.
export interface ExtractedEvidence {
  chunkId: string;
  quote: string;
}

export interface ExtractedValidTime {
  from: string | null; // "YYYY-MM" | "YYYY-MM-DD" | ISO | null — only when STATED
  fromBasis: ValidFromBasis;
  fromGranularity: string;
}

export interface ExtractedCorrection {
  claimKey: string;
  reason: CorrectionReason;
}

export interface ExtractedAttestation {
  claim: string;
  claimType: ClaimType;
  claimKey: string; // the question / state, e.g. "escalation_channel"
  claimFingerprint: string; // the specific answer, e.g. "escalation_channel:#incidents"
  polarity: Polarity;
  inferenceStatus: InferenceStatus;
  domain: string | null;
  evidence: ExtractedEvidence[];
  validTime: ExtractedValidTime;
  corrects: ExtractedCorrection | null;
}

export interface ExtractionRefusal {
  sourceId?: string;
  candidate?: string;
  reason: string;
}

export interface ExtractionOutput {
  attestations: ExtractedAttestation[];
  refusals: ExtractionRefusal[];
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function collapse(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

// A quote being verbatim proves provenance, not that it describes a durable way
// of working. Keep this deliberately narrow: these are unambiguous examples of
// content the extraction contract already requires the model to refuse. More
// nuanced operational judgment remains in the prompt rather than becoming a
// brittle heuristic that could suppress recall.
function weakAttestationReason(evidence: ExtractedEvidence[]): string | null {
  const quoted = evidence.map((e) => e.quote).join(" ").toLowerCase();
  if (/\?|\b(should we|could we|what if|we should|we could|floating the idea|just an idea|thinking out loud|throwing it out there)\b/.test(quoted)) {
    return "proposal_or_question";
  }
  if (/\b(lol|lmao|haha|tbh)\b/.test(quoted)) return "banter";
  // An effective date can introduce a real policy. Only treat a near-term date
  // as incidental when the quote does not also state a recurring requirement.
  const recurringRequirement = /\b(all|every|each)\b.*\b(require|requires|required|must)\b/.test(quoted);
  if (!recurringRequirement && /\b(next week|starting (monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.test(quoted)) {
    return "incidental_update";
  }
  return null;
}

function oneOf<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;
}

// Maps one raw model object (snake_case) to a typed ExtractedAttestation. This is
// the ENFORCEMENT BOUNDARY: any confidence / recorded_at / valid_until /
// valid_until_recorded_at / status the model tries to emit is simply not read.
// Enums fall back to the most conservative value. Returns null for unusable rows
// (no claim or no fingerprint) so they are dropped, not persisted uncited.
function mapAttestation(raw: unknown): ExtractedAttestation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const claim = asString(r.claim);
  const claimFingerprint = asString(r.claim_fingerprint);
  if (!claim || !claimFingerprint) return null;

  const claimKey = asString(r.claim_key) ?? claimFingerprint;

  const evidenceRaw = Array.isArray(r.evidence) ? r.evidence : [];
  const evidence: ExtractedEvidence[] = [];
  for (const e of evidenceRaw) {
    if (typeof e !== "object" || e === null) continue;
    const ev = e as Record<string, unknown>;
    const chunkId = asString(ev.chunk_id) ?? asString(ev.chunkId);
    const quote = typeof ev.quote === "string" && ev.quote.length > 0 ? ev.quote : null;
    if (chunkId && quote) evidence.push({ chunkId, quote });
  }

  const vtRaw = (typeof r.valid_time === "object" && r.valid_time !== null
    ? (r.valid_time as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const validTime: ExtractedValidTime = {
    from: asString(vtRaw.from),
    fromBasis: oneOf<ValidFromBasis>(vtRaw.from_basis, VALID_FROM_BASES, "unknown"),
    fromGranularity: asString(vtRaw.from_granularity) ?? "unknown",
  };

  let corrects: ExtractedCorrection | null = null;
  if (typeof r.corrects === "object" && r.corrects !== null) {
    const c = r.corrects as Record<string, unknown>;
    const ck = asString(c.claim_key);
    if (ck) corrects = { claimKey: ck, reason: oneOf<CorrectionReason>(c.reason, ["change", "correction"], "change") };
  }

  return {
    claim: collapse(claim),
    claimType: oneOf<ClaimType>(r.claim_type, CLAIM_TYPES, "propositional"),
    claimKey: collapse(claimKey),
    claimFingerprint: collapse(claimFingerprint),
    polarity: oneOf<Polarity>(r.polarity, POLARITIES, "assertion"),
    inferenceStatus: oneOf<InferenceStatus>(r.inference_status, INFERENCE_STATUSES, "inferred"),
    domain: asString(r.domain),
    evidence,
    validTime,
    corrects,
  };
}

// Parse a raw LLM response into the extraction contract. Same two-step recovery as
// parseSynthesisResponse (fence-strip then outermost {...}). Returns null only when
// no JSON object can be recovered at all.
export function parseExtractionResponse(raw: string): ExtractionOutput | null {
  const build = (parsed: unknown): ExtractionOutput | null => {
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    const attsRaw = Array.isArray(p.attestations) ? p.attestations : [];
    const mappedAttestations = attsRaw
      .map(mapAttestation)
      .filter((a): a is ExtractedAttestation => a !== null);
    const refusalsRaw = Array.isArray(p.refusals) ? p.refusals : [];
    const refusals: ExtractionRefusal[] = refusalsRaw
      .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
      .map((x) => ({
        sourceId: asString(x.source_id) ?? undefined,
        candidate: asString(x.candidate) ?? undefined,
        reason: asString(x.reason) ?? "unspecified",
      }));
    const attestations: ExtractedAttestation[] = [];
    for (const attestation of mappedAttestations) {
      const reason = weakAttestationReason(attestation.evidence);
      if (reason) {
        refusals.push({ candidate: attestation.claim, reason });
      } else {
        attestations.push(attestation);
      }
    }
    return { attestations, refusals };
  };

  const stripped = raw.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/m, "").trim();
  try {
    const out = build(JSON.parse(stripped));
    if (out) return out;
  } catch {
    // fall through to regex extraction
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const out = build(JSON.parse(match[0]));
      if (out) return out;
    } catch {
      // give up below
    }
  }
  console.error("[attestation-extraction] Could not parse LLM response:", raw.slice(0, 300));
  return null;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────
// Production prompt — eval-scored. Any wording change is a model-behavior change.

export const ATTESTATION_EXTRACTION_SYSTEM_PROMPT =
  "You are an operations analyst extracting how a company works from its exhaust. " +
  "You are a REPORTER and CLASSIFIER, not a judge. Your only job is to output a JSON object. " +
  "No explanations. No preamble. Output only the JSON.";

// Renders chunks with their ids so the model can cite chunk_id + a verbatim quote.
export function buildChunksBlock(chunks: Array<{ id: string; source: string; author?: string; text: string }>): string {
  return chunks
    .map((c) => `[chunk_id: ${c.id}] (${c.source}${c.author ? `, ${c.author}` : ""})\n${c.text}`)
    .join("\n\n");
}

export function buildAttestationExtractionPrompt(opts: {
  domain: string;
  chunksBlock: string;
  retry: boolean;
}): string {
  return `${opts.retry ? "OUTPUT ONLY JSON. NO TEXT BEFORE OR AFTER.\n\n" : ""}Domain: ${opts.domain}

From the source chunks below, extract ATTESTATIONS — durable claims about how the company operates (procedures, roles, policies, ownership). Each attestation must be grounded in a verbatim quote from a specific chunk.

--- BEGIN CHUNKS ---
${opts.chunksBlock}
--- END CHUNKS ---

Rules (follow exactly):
- Cite evidence: every attestation needs evidence[] with {chunk_id, quote} where quote is a VERBATIM substring of that chunk. Never paraphrase a quote. No evidence => do not emit the claim; add it to refusals instead.
- claim_key = a stable snake_case name for the QUESTION being answered (e.g. "escalation_channel", "oncall_ack_sla", "postmortem_policy"). Use the SAME claim_key for EVERY answer to the same question — including contradicting ones. claim_fingerprint = claim_key + ":" + the specific answer (e.g. "escalation_channel:#incidents" vs "escalation_channel:#engineering"). This is how contradictions are detected: two sources that answer the same question differently MUST share claim_key and differ only in fingerprint. Emit both; never pick a winner.
- valid_time.from: if a source states WHEN a practice began or changed (e.g. "since March", "as of Q1", "starting 2026-03"), you MUST set valid_time.from to that date ("YYYY-MM") with from_basis="stated". Do not drop a stated date. Otherwise from=null, from_basis="unknown" — NEVER guess a start date from when a message happened.
- inference_status: "stated" (said outright), "corroborated" (multiple independent chunks), "inferred" (a pattern, not stated).
- corrects: if a chunk states a practice CHANGED (e.g. "we no longer do X, now we do Y"), set corrects={claim_key, reason:"change"} on the new answer.
- Do NOT output confidence, recorded_at, valid_until, valid_until_recorded_at, or status — the system computes those.
- REFUSE (add to refusals with a reason, never emit as an attestation): jokes/banter (e.g. "no coffee until the incident is resolved lol"), opinions/sentiment (e.g. "our process is a mess"), questions, and proposals not yet adopted (e.g. "should we auto-page on P2?"). A statement is only an attestation if it describes how the company ACTUALLY operates.

Worked example — two sources disagree on the escalation channel, one gives a date:
  chunk A (notion): "incidents are escalated in #engineering"
  chunk B (slack):  "since March we run all incident comms out of #incidents"
  => two attestations sharing claim_key "escalation_channel": fingerprint "escalation_channel:#engineering" (from A) and "escalation_channel:#incidents" (from B, valid_time.from="2026-03", from_basis="stated", corrects={claim_key:"escalation_channel", reason:"change"}).

Output only this JSON:
{"attestations":[{"claim":"...","claim_type":"propositional","claim_key":"...","claim_fingerprint":"...","polarity":"assertion","inference_status":"stated","domain":"${opts.domain}","evidence":[{"chunk_id":"...","quote":"..."}],"valid_time":{"from":null,"from_basis":"unknown","from_granularity":"unknown"},"corrects":null}],"refusals":[{"source_id":"...","reason":"opinion"}]}`;
}
