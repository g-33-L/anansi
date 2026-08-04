import { getHistory } from "../db/attestations-repo.js";
import type { Attestation, AttestationEvidence } from "../db/schema.js";

// PR-4: the moat feature. Compares what the DOCUMENTS say against what the ledger
// OBSERVED actually happens (doc-vs-reality divergence), and builds a timeline of
// when practices changed. Read-only over the repo; only possible because the
// ledger keeps two-axis history and never overwrites.

// Evidence from a document surface is "documented"; behaviour (chat/tickets) is
// "observed". The robust signal is the chunk's SOURCE TYPE — not the doc title,
// which for realistic docs ("Information Security Policy") matches no keyword. The
// title regex is kept only as a fallback for evidence that predates sourceType.
const DOC_SOURCE_TYPES = new Set(["notion_page", "gdoc", "file_doc", "file_pdf", "confluence_page"]);
const DOC_SOURCE_RE = /notion|confluence|runbook|wiki|gdoc|google\s*docs?|playbook/i;

function evidenceIsDocumented(e: AttestationEvidence): boolean {
  if (e.sourceType != null) return DOC_SOURCE_TYPES.has(e.sourceType);
  return e.source != null && DOC_SOURCE_RE.test(e.source);
}
function isDocumented(a: Attestation): boolean {
  return a.evidence.some(evidenceIsDocumented);
}
function isObserved(a: Attestation): boolean {
  return a.evidence.some((e) => !evidenceIsDocumented(e));
}

export interface DivergenceSide {
  claim: string;
  fingerprint: string;
  validFrom: string | null;
  evidence: AttestationEvidence[];
}

export interface Divergence {
  claimKey: string;
  documented: DivergenceSide;
  observed: DivergenceSide;
  changedAt: string | null; // when observed practice began, if a start date was stated
}

function toSide(a: Attestation): DivergenceSide {
  return {
    claim: a.claim,
    fingerprint: a.claimFingerprint,
    validFrom: a.validFrom?.toISOString() ?? null,
    evidence: a.evidence,
  };
}

// A divergence exists when, for one claim_key, a DOCUMENTED answer disagrees with
// the OBSERVED reality — the wiki says one thing and the team actually does another.
// Crucially this reads HISTORY, not just active rows: a stale doc is often one the
// ledger already superseded via a change (which CLOSES the documented answer). Only
// looking at active rows misses exactly the "doc drifted" case we most want to show.
export async function computeDivergences(
  workspaceId: string,
  opts: { domain?: string } = {}
): Promise<Divergence[]> {
  const all = await getHistory(workspaceId, { domain: opts.domain });

  const byKey = new Map<string, Attestation[]>();
  for (const a of all) {
    if (a.claimKey == null) continue; // divergence needs a shared question
    const bucket = byKey.get(a.claimKey);
    if (bucket) bucket.push(a);
    else byKey.set(a.claimKey, [a]);
  }

  const divergences: Divergence[] = [];
  for (const [claimKey, group] of byKey) {
    if (group.length < 2) continue;

    // The documented answer (active or already superseded) backed by a doc source.
    const documented = group.find(isDocumented);
    if (!documented) continue;

    // The observed answer must be a different-fingerprint answer from behaviour
    // that is currently active (the present reality). A closed observed claim is
    // historical context, not a live doc-vs-reality divergence.
    const observedCandidates = group.filter(
      (g) => g.claimFingerprint !== documented.claimFingerprint && isObserved(g)
    );
    // An active observed answer of a different fingerprint is, by itself, proof the
    // documented answer is not the present reality, whether the documented answer is
    // still open or was already superseded. A closed observed answer is historical
    // context, not a live divergence, so it never qualifies.
    const observed = observedCandidates.find((g) => g.validUntil === null);
    if (!observed) continue;

    // When practice changed: the observed answer's stated start, else the moment the
    // documented answer was superseded.
    const changedAt =
      (observed.validFromBasis === "stated" ? (observed.validFrom?.toISOString() ?? null) : null) ??
      documented.validUntil?.toISOString() ??
      null;
    divergences.push({ claimKey, documented: toSide(documented), observed: toSide(observed), changedAt });
  }

  return divergences;
}

export interface TimelineEntry {
  at: string; // ISO instant of the change
  claimKey: string | null;
  claim: string;
  fingerprint: string;
  kind: "adopted" | "superseded";
}

// A chronological record of when each answer was adopted and (if closed) when it
// was superseded. "adopted" uses a stated start date when one exists, otherwise
// the moment we first recorded the claim (never an invented date).
export async function computeTimeline(
  workspaceId: string,
  opts: { domain?: string } = {}
): Promise<TimelineEntry[]> {
  const rows = await getHistory(workspaceId, { domain: opts.domain });
  const events: TimelineEntry[] = [];

  for (const a of rows) {
    const adoptedAt = a.validFromBasis === "stated" && a.validFrom ? a.validFrom : a.recordedAt;
    events.push({
      at: adoptedAt.toISOString(),
      claimKey: a.claimKey,
      claim: a.claim,
      fingerprint: a.claimFingerprint,
      kind: "adopted",
    });
    if (a.validUntil) {
      events.push({
        at: a.validUntil.toISOString(),
        claimKey: a.claimKey,
        claim: a.claim,
        fingerprint: a.claimFingerprint,
        kind: "superseded",
      });
    }
  }

  return events.sort((x, y) => x.at.localeCompare(y.at));
}
