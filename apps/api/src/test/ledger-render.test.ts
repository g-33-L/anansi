import { describe, it, expect } from "vitest";
import { renderLedgerReport } from "../lib/ai/ledger-render.js";
import { scoreExtraction } from "../lib/ai/extraction-eval.js";
import type { LedgerView } from "../lib/ai/ledger.js";
import type { Divergence, TimelineEntry } from "../lib/ai/ledger-diff.js";
import type { ExtractionOutput } from "../lib/ai/attestation-extraction-prompt.js";

// PR-6 pure units: the human-readable report + the extraction quality scorer.

const view: LedgerView = {
  workspaceId: "ws",
  domain: "incident_response",
  asOf: null,
  asOfKnowledge: null,
  claims: [
    { claim: "P0 incidents open a war room in #incidents", claimKey: "p0", claimFingerprint: "p0:#incidents", claimType: "propositional", status: "observed", disputed: false, confidence: 0.82, validFrom: null, validFromBasis: "unknown", evidence: [{ chunkId: "m1", quote: "war room" }], recordedAt: "2026-05-11T00:00:00.000Z" },
    { claim: "Incident comms happen in #incidents", claimKey: "escalation_channel", claimFingerprint: "escalation_channel:#incidents", claimType: "propositional", status: "observed", disputed: true, confidence: 0.7, validFrom: "2026-03-01T00:00:00.000Z", validFromBasis: "stated", evidence: [{ chunkId: "m4", quote: "since March" }], recordedAt: "2026-05-01T00:00:00.000Z" },
  ],
  disputes: [{ claimKey: "escalation_channel", answers: [] }],
};

const divergences: Divergence[] = [
  {
    claimKey: "escalation_channel",
    documented: { claim: "escalate in #engineering", fingerprint: "escalation_channel:#engineering", validFrom: null, evidence: [] },
    observed: { claim: "escalate in #incidents", fingerprint: "escalation_channel:#incidents", validFrom: "2026-03-01T00:00:00.000Z", evidence: [] },
    changedAt: "2026-03-01T00:00:00.000Z",
  },
];

const timeline: TimelineEntry[] = [
  { at: "2026-01-01T00:00:00.000Z", claimKey: "escalation_channel", claim: "escalate in #engineering", fingerprint: "escalation_channel:#engineering", kind: "adopted" },
  { at: "2026-03-01T00:00:00.000Z", claimKey: "escalation_channel", claim: "escalate in #incidents", fingerprint: "escalation_channel:#incidents", kind: "adopted" },
];

describe("renderLedgerReport", () => {
  it("renders the procedure, the doc-vs-reality divergence with a date, and the timeline", () => {
    const md = renderLedgerReport({ domain: "incident_response", view, divergences, timeline });
    expect(md).toContain("# Ledger report — incident_response (current)");
    expect(md).toContain("P0 incidents open a war room in #incidents — observed, confidence 82%");
    expect(md).toContain("(since 2026-03-01)");
    expect(md).toContain("disputed");
    expect(md).toContain("## Doc vs reality");
    expect(md).toContain("changed ~2026-03-01");
    expect(md).toContain("## Timeline");
    expect(md).toContain("2026-03-01 — adopted: escalate in #incidents");
  });

  it("handles empty sections gracefully", () => {
    const md = renderLedgerReport({
      domain: "refunds",
      view: { workspaceId: "ws", domain: "refunds", asOf: null, asOfKnowledge: null, claims: [], disputes: [] },
      divergences: [],
      timeline: [],
    });
    expect(md).toContain("_No attestations yet._");
    expect(md).toContain("_No documented-vs-observed divergences._");
    expect(md).toContain("_No timeline events yet._");
  });
});

describe("scoreExtraction (semantic, claim-text matching)", () => {
  // Oracle claims as free text — the scorer matches on content, not fingerprints.
  const oracle = {
    attestations: [
      { claim: "P0 incidents open a war room in #incidents" },
      { claim: "A postmortem is required for P0 and P1 incidents" },
    ],
  };
  const att = (claim: string, cited = true): ExtractionOutput["attestations"][number] => ({
    claim, claimType: "propositional", claimKey: "k", claimFingerprint: "k:x", polarity: "assertion",
    inferenceStatus: "stated", domain: "d", evidence: cited ? [{ chunkId: "c1", quote: "q" }] : [], validTime: { from: null, fromBasis: "unknown", fromGranularity: "unknown" }, corrects: null,
  });

  it("matches semantically even when wording differs (no false 0%)", () => {
    // Different phrasing than the oracle — exact-fingerprint matching would score 0.
    const out: ExtractionOutput = {
      attestations: [att("P0 incidents require opening a war room"), att("Postmortems are mandatory for P0/P1 incidents")],
      refusals: [],
    };
    const s = scoreExtraction(out, oracle);
    expect(s.precision).toBe(1);
    expect(s.recall).toBe(1);
    expect(s.f1).toBe(1);
    expect(s.citationRate).toBe(1);
  });

  it("penalizes a miss (recall) and a hallucination (precision)", () => {
    const out: ExtractionOutput = {
      attestations: [att("P0 incidents open a war room in #incidents"), att("Bananas are stored in the fridge")],
      refusals: [],
    };
    const s = scoreExtraction(out, oracle);
    expect(s.recall).toBe(0.5); // matched 1 of 2 oracle claims
    expect(s.precision).toBe(0.5); // 1 of 2 emitted matches something real
  });

  it("detects chatter that leaked in as an attestation", () => {
    const out: ExtractionOutput = {
      attestations: [att("No coffee is allowed until the incident is resolved")],
      refusals: [],
    };
    const s = scoreExtraction(out, oracle, { chatterTexts: ["rule: no coffee until the incident is resolved lol"] });
    expect(s.chatterLeaks).toBe(1);
    expect(s.refusalRate).toBe(0); // failed to refuse the one chatter item
  });

  it("flags an uncited attestation via citationRate", () => {
    const out: ExtractionOutput = { attestations: [att("P0 incidents open a war room in #incidents", false)], refusals: [] };
    expect(scoreExtraction(out, oracle).citationRate).toBe(0);
  });
});
