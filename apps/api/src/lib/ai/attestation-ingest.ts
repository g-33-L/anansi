import { inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { memoryChunks, type AttestationEvidence } from "../db/schema.js";
import {
  closeAttestation,
  getActiveByClaimKey,
  getActiveByFingerprint,
  insertAttestation,
} from "../db/attestations-repo.js";
import type {
  ExtractedEvidence,
  ExtractedValidTime,
  ExtractionOutput,
  InferenceStatus,
  ValidFromBasis,
} from "./attestation-extraction-prompt.js";

// The deterministic half of extraction: the system is VERIFIER, SCORER, and
// TIMEKEEPER. It verifies evidence against stored chunks, computes confidence
// (the model never supplies it), enforces conservative time semantics, and
// persists append-only. Nothing here calls an LLM, so all of it is deterministic
// and unit-tested.

// ─── Evidence verification (hard gate) ────────────────────────────────────────

export type EvidenceVerification =
  | { ok: true; verified: AttestationEvidence[]; independentSourceCount: number; newestEventTime: Date | null; statedStart: { date: Date; granularity: string } | null }
  | { ok: false; reason: "no_evidence" | "chunk_not_found" | "cross_workspace_evidence" | "quote_not_verbatim" };

// Deterministic stated-start-date extraction from source text. The model
// inconsistently lifts "since March" into valid_time.from even when the date is
// right there in the evidence, so the system (the timekeeper) recovers it from the
// verified source. Conservative: only explicit start markers, and a bare month name
// is resolved against the message's own timestamp year (never guessed otherwise).
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const START_MARKER = "(?:since|as of|effective|starting|beginning)";

export function parseStatedStart(text: string, reference: Date | null): { date: Date; granularity: string } | null {
  const t = text.toLowerCase();
  const ymd = t.match(new RegExp(`${START_MARKER}\\s+(\\d{4})-(\\d{2})(?:-(\\d{2}))?`));
  if (ymd) {
    const date = new Date(Date.UTC(+ymd[1], +ymd[2] - 1, ymd[3] ? +ymd[3] : 1));
    return Number.isNaN(date.getTime()) ? null : { date, granularity: ymd[3] ? "day" : "month" };
  }
  const named = t.match(new RegExp(`${START_MARKER}\\s+([a-z]+)`));
  if (named && MONTHS[named[1]] && reference) {
    const mo = MONTHS[named[1]];
    const refY = reference.getUTCFullYear();
    const refM = reference.getUTCMonth() + 1;
    const year = mo > refM ? refY - 1 : refY; // "since December" in a January message → prior year
    return { date: new Date(Date.UTC(year, mo - 1, 1)), granularity: "month" };
  }
  return null;
}

// Verify every cited quote is a verbatim substring of an existing chunk in THIS
// workspace. Any failure rejects the whole attestation — no partial trust. On
// success, evidence is deduped by chunk (a re-quote of the same chunk is not a
// second independent source) and enriched with author/source/event_time pulled
// from the chunk itself (never from the model).
export async function verifyEvidence(
  workspaceId: string,
  evidence: ExtractedEvidence[]
): Promise<EvidenceVerification> {
  if (evidence.length === 0) return { ok: false, reason: "no_evidence" };

  const ids = [...new Set(evidence.map((e) => e.chunkId))];
  const rows = await db
    .select({
      id: memoryChunks.id,
      workspaceId: memoryChunks.workspaceId,
      content: memoryChunks.content,
      metadata: memoryChunks.metadata,
      sourceType: memoryChunks.sourceType,
    })
    .from(memoryChunks)
    .where(inArray(memoryChunks.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const seenChunks = new Set<string>();
  const authors = new Set<string>();
  const verified: AttestationEvidence[] = [];
  let newestEventTime: Date | null = null;
  let statedStart: { date: Date; granularity: string } | null = null;

  for (const e of evidence) {
    const chunk = byId.get(e.chunkId);
    if (!chunk) return { ok: false, reason: "chunk_not_found" };
    if (chunk.workspaceId !== workspaceId) return { ok: false, reason: "cross_workspace_evidence" };
    if (!chunk.content.includes(e.quote)) return { ok: false, reason: "quote_not_verbatim" };

    if (seenChunks.has(e.chunkId)) continue; // dedup: same chunk cited twice
    seenChunks.add(e.chunkId);

    const meta = (chunk.metadata ?? {}) as { author?: string; timestamp?: string; channelName?: string };
    const author = meta.author?.trim();
    if (author) authors.add(author);
    const eventTime = parseEventTime(meta.timestamp);
    if (eventTime && (!newestEventTime || eventTime > newestEventTime)) newestEventTime = eventTime;
    // Recover a stated start date from the verified source when the model omitted it.
    if (!statedStart) statedStart = parseStatedStart(chunk.content, eventTime);

    verified.push({
      chunkId: e.chunkId,
      quote: e.quote,
      source: meta.channelName,
      sourceType: chunk.sourceType,
      author: meta.author,
      eventTime: meta.timestamp,
    });
  }

  // Independent sources: distinct authors, falling back to distinct chunks when
  // authorship is unknown (so we never overstate corroboration).
  const independentSourceCount = authors.size > 0 ? authors.size : verified.length;
  return { ok: true, verified, independentSourceCount, newestEventTime, statedStart };
}

function parseEventTime(ts: string | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Temporal normalization (system owns time) ────────────────────────────────

export interface NormalizedValidTime {
  validFrom: Date | null;
  validFromBasis: ValidFromBasis;
  validFromGranularity: string;
}

// valid_from is honored ONLY when the model marked it "stated" AND it parses to a
// real date. Anything else collapses to null/unknown — the ledger never invents a
// start date from when evidence merely appeared.
export function normalizeValidTime(vt: ExtractedValidTime): NormalizedValidTime {
  if (vt.fromBasis === "stated" && vt.from) {
    const parsed = parseStatedDate(vt.from);
    if (parsed) {
      return {
        validFrom: parsed.date,
        validFromBasis: "stated",
        validFromGranularity: vt.fromGranularity !== "unknown" ? vt.fromGranularity : parsed.granularity,
      };
    }
  }
  const basis: ValidFromBasis = vt.fromBasis === "knowledge_derived" ? "knowledge_derived" : "unknown";
  return { validFrom: null, validFromBasis: basis, validFromGranularity: "unknown" };
}

// Parses an explicitly-stated date. Accepts YYYY-MM, YYYY-MM-DD, or full ISO.
// Returns null (never a guess) for anything else. Interpreted as UTC.
function parseStatedDate(s: string): { date: Date; granularity: string } | null {
  const trimmed = s.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}-01T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : { date: d, granularity: "month" };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const d = new Date(`${trimmed}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : { date: d, granularity: "day" };
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : { date: d, granularity: "day" };
}

// ─── Confidence (system-computed; model never supplies it) ────────────────────

const INFERENCE_WEIGHT: Record<InferenceStatus, number> = { stated: 1.0, corroborated: 0.9, inferred: 0.6 };
const BASIS_WEIGHT: Record<ValidFromBasis, number> = { stated: 1.0, knowledge_derived: 0.8, unknown: 0.7 };
// Never 1.0 — an LLM extraction is never certain, and the spec forbids a default of certainty.
const MAX_CONFIDENCE = 0.95;

export interface ConfidenceInputs {
  independentSourceCount: number;
  inferenceStatus: InferenceStatus;
  validFromBasis: ValidFromBasis;
  newestEventTime: Date | null;
  now: Date;
}

export interface ConfidenceResult {
  confidence: number;
  breakdown: Record<string, unknown>;
}

// Confidence is derived only from observable, system-measured signals. The
// recency term is computed against `now` and stored alongside its inputs in the
// breakdown, so a reader can recompute a fresh recency-adjusted value without
// mutating the (append-only) row.
export function computeConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  const n = inputs.independentSourceCount;
  const sourceScore = Math.min(1, Math.log(n + 1) / Math.log(4)); // 1->~0.5, 2->~0.79, 3->1
  const inferenceWeight = INFERENCE_WEIGHT[inputs.inferenceStatus];
  const basisWeight = BASIS_WEIGHT[inputs.validFromBasis];
  const recency = computeRecency(inputs.newestEventTime, inputs.now);

  const raw = 0.35 * sourceScore + 0.3 * inferenceWeight + 0.15 * basisWeight + 0.2 * recency;
  const confidence = Math.max(0, Math.min(MAX_CONFIDENCE, raw));

  return {
    confidence,
    breakdown: {
      independentSourceCount: n,
      sourceScore,
      inferenceStatus: inputs.inferenceStatus,
      inferenceWeight,
      validFromBasis: inputs.validFromBasis,
      basisWeight,
      recency,
      newestEventTime: inputs.newestEventTime?.toISOString() ?? null,
      computedAt: inputs.now.toISOString(),
    },
  };
}

function computeRecency(eventTime: Date | null, now: Date): number {
  if (!eventTime) return 0.7; // no timestamp — neutral, not certain
  const days = Math.max(0, (now.getTime() - eventTime.getTime()) / 86_400_000);
  return Math.exp(-days / 90);
}

// ─── Ingest orchestration (append-only) ───────────────────────────────────────

export interface IngestRefusal {
  claim?: string;
  claimFingerprint?: string;
  sourceId?: string;
  reason: string;
}

export interface IngestResult {
  written: Awaited<ReturnType<typeof insertAttestation>>[];
  refusals: IngestRefusal[];
  noops: number; // idempotent skips (fingerprint already active)
}

export interface IngestParams {
  workspaceId: string;
  developerId: string;
  memoryUserId?: string | null;
  extraction: ExtractionOutput;
  now?: Date;
}

// Persist an extraction append-only. For each proposed attestation: verify
// evidence (hard gate), normalize time, compute confidence, then insert — closing
// any conflicting prior answer first when the model flagged a change. Re-running
// the same extraction is a no-op (the fingerprint is already active).
export async function ingestExtraction(params: IngestParams): Promise<IngestResult> {
  const now = params.now ?? new Date();
  const result: IngestResult = {
    written: [],
    refusals: params.extraction.refusals.map((r) => ({ sourceId: r.sourceId, reason: r.reason })),
    noops: 0,
  };

  for (const e of params.extraction.attestations) {
    const verification = await verifyEvidence(params.workspaceId, e.evidence);
    if (!verification.ok) {
      result.refusals.push({ claim: e.claim, claimFingerprint: e.claimFingerprint, reason: verification.reason });
      continue;
    }

    let temporal = normalizeValidTime(e.validTime);
    // Timekeeper fallback: the model omits the stated start date ~80% of the time
    // even when it is in the source; recover it deterministically from the verified
    // evidence (still fully grounded — the date is a verbatim part of the chunk).
    if (temporal.validFrom === null && verification.statedStart) {
      temporal = {
        validFrom: verification.statedStart.date,
        validFromBasis: "stated",
        validFromGranularity: verification.statedStart.granularity,
      };
    }
    const { confidence, breakdown } = computeConfidence({
      independentSourceCount: verification.independentSourceCount,
      inferenceStatus: e.inferenceStatus,
      validFromBasis: temporal.validFromBasis,
      newestEventTime: verification.newestEventTime,
      now,
    });
    // observed requires >=2 independent sources; single-source stays candidate.
    // 'disputed' is derived at the query layer (>1 active fingerprint per
    // claim_key), never stored by mutating rows.
    const status = verification.independentSourceCount >= 2 ? "observed" : "candidate";

    // Correction / change: close the superseded answer(s) under this claim_key
    // before inserting the new one. Closing stamps only the two time boundaries.
    if (e.corrects) {
      const conflicting = await getActiveByClaimKey(params.workspaceId, e.claimKey);
      for (const c of conflicting) {
        if (c.claimFingerprint === e.claimFingerprint) continue;
        await closeAttestation(c.id, { validUntil: temporal.validFrom ?? now, validUntilRecordedAt: now });
      }
    }

    // Idempotency + reinforcement: if this exact answer is already active, do not
    // duplicate and do not mutate the original historical row. (Merging new
    // evidence into an existing active claim is deferred — see PR-1 review.)
    const existing = await getActiveByFingerprint(params.workspaceId, e.claimFingerprint);
    if (existing) {
      result.noops++;
      continue;
    }

    const inserted = await insertAttestation({
      workspaceId: params.workspaceId,
      developerId: params.developerId,
      memoryUserId: params.memoryUserId ?? null,
      claim: e.claim,
      claimFingerprint: e.claimFingerprint,
      claimKey: e.claimKey,
      claimType: e.claimType,
      domain: e.domain,
      polarity: e.polarity,
      inferenceStatus: e.inferenceStatus,
      status,
      confidence,
      confidenceBreakdown: breakdown,
      validFrom: temporal.validFrom,
      validFromBasis: temporal.validFromBasis,
      validFromGranularity: temporal.validFromGranularity,
      recordedAt: now,
      evidence: verification.verified,
      metadata: e.corrects ? { correctionReason: e.corrects.reason } : {},
    });
    result.written.push(inserted);
  }

  return result;
}
