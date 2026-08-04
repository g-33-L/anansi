import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseExtractionResponse } from "../lib/ai/attestation-extraction-prompt.js";
import { chatSynthesis } from "../lib/ai/llm.js";
import { extractAttestations } from "../lib/ai/attestation-extraction.js";

// Pure tests for the LLM "reporter" boundary: parsing + the guarantee that the
// model can never smuggle in a confidence score or a system-owned field. No DB.

vi.mock("../lib/ai/llm.js", () => ({ chatSynthesis: vi.fn(), chat: vi.fn() }));

describe("parseExtractionResponse", () => {
  it("maps a valid response to the typed contract (snake_case -> camelCase)", () => {
    const raw = JSON.stringify({
      attestations: [
        {
          claim: "P0 incidents open a war room in #incidents",
          claim_type: "propositional",
          claim_key: "p0_war_room_channel",
          claim_fingerprint: "p0_war_room_channel:#incidents",
          polarity: "assertion",
          inference_status: "corroborated",
          domain: "incident_response",
          evidence: [{ chunk_id: "c1", quote: "Opening the war room in #incidents now" }],
          valid_time: { from: null, from_basis: "unknown", from_granularity: "unknown" },
          corrects: null,
        },
      ],
      refusals: [{ source_id: "m9", reason: "opinion" }],
    });

    const out = parseExtractionResponse(raw)!;
    expect(out.attestations).toHaveLength(1);
    const a = out.attestations[0];
    expect(a.claimFingerprint).toBe("p0_war_room_channel:#incidents");
    expect(a.inferenceStatus).toBe("corroborated");
    expect(a.evidence[0]).toEqual({ chunkId: "c1", quote: "Opening the war room in #incidents now" });
    expect(out.refusals[0]).toEqual({ sourceId: "m9", candidate: undefined, reason: "opinion" });
  });

  it("STRIPS any model-supplied confidence and system-owned fields", () => {
    const raw = JSON.stringify({
      attestations: [
        {
          claim: "x",
          claim_fingerprint: "k:x",
          claim_key: "k",
          evidence: [{ chunk_id: "c1", quote: "x" }],
          valid_time: { from: null, from_basis: "unknown", from_granularity: "unknown" },
          // Everything below must be ignored — the system owns these:
          confidence: 0.99,
          confidence_breakdown: { faked: true },
          recorded_at: "2026-07-15T00:00:00Z",
          valid_until: "2026-08-01T00:00:00Z",
          valid_until_recorded_at: "2026-08-01T00:00:00Z",
          status: "observed",
        },
      ],
    });

    const a = parseExtractionResponse(raw)!.attestations[0] as unknown as Record<string, unknown>;
    expect(a.confidence).toBeUndefined();
    expect(a.confidenceBreakdown).toBeUndefined();
    expect(a.recordedAt).toBeUndefined();
    expect(a.validUntil).toBeUndefined();
    expect(a.status).toBeUndefined();
  });

  it("normalizes unknown enums to the conservative default", () => {
    const raw = JSON.stringify({
      attestations: [
        {
          claim: "x",
          claim_fingerprint: "k:x",
          claim_key: "k",
          claim_type: "nonsense",
          polarity: "sideways",
          inference_status: "very-sure",
          evidence: [{ chunk_id: "c1", quote: "x" }],
          valid_time: { from: "2026-03", from_basis: "made-up", from_granularity: "month" },
        },
      ],
    });
    const a = parseExtractionResponse(raw)!.attestations[0];
    expect(a.claimType).toBe("propositional");
    expect(a.polarity).toBe("assertion");
    expect(a.inferenceStatus).toBe("inferred");
    expect(a.validTime.fromBasis).toBe("unknown");
  });

  it("drops an attestation with no fingerprint (nothing uncitable slips through)", () => {
    const raw = JSON.stringify({
      attestations: [{ claim: "no fingerprint", evidence: [{ chunk_id: "c1", quote: "x" }] }],
    });
    expect(parseExtractionResponse(raw)!.attestations).toHaveLength(0);
  });

  it.each([
    ["should we auto-page on P2?", "proposal_or_question"],
    ["onboarding = drinking from a firehose lol", "banter"],
    ["SOC2 Type II audit kicks off next week", "incidental_update"],
    ["New hire starting Monday — kicking off onboarding", "incidental_update"],
  ])("refuses unmistakably non-operational evidence: %s", (quote, reason) => {
    const raw = JSON.stringify({
      attestations: [{
        claim: quote,
        claim_key: "test_claim",
        claim_fingerprint: "test_claim:value",
        evidence: [{ chunk_id: "c1", quote }],
        valid_time: { from: null, from_basis: "unknown", from_granularity: "unknown" },
      }],
      refusals: [],
    });

    const out = parseExtractionResponse(raw)!;
    expect(out.attestations).toHaveLength(0);
    expect(out.refusals).toContainEqual({ candidate: quote, reason });
  });

  it("keeps a single-source, evidence-backed operating procedure", () => {
    const raw = JSON.stringify({
      attestations: [{
        claim: "Critical escalations are tagged with the P0 label in Zendesk",
        claim_key: "escalation_tagging",
        claim_fingerprint: "escalation_tagging:zendesk_p0",
        evidence: [{ chunk_id: "c1", quote: "we tag critical escalations with the P0 label in Zendesk" }],
        valid_time: { from: null, from_basis: "unknown", from_granularity: "unknown" },
      }],
      refusals: [],
    });

    expect(parseExtractionResponse(raw)!.attestations).toHaveLength(1);
  });

  it.each([
    "Starting Monday all incidents require an incident commander.",
    "Beginning March, access reviews change to monthly.",
    "Effective next quarter, customer-facing changes require design sign-off.",
  ])("accepts an explicitly future-dated operational change: %s", (quote) => {
    const raw = JSON.stringify({
      attestations: [{
        claim: quote,
        claim_key: "future_policy",
        claim_fingerprint: `future_policy:${quote}`,
        evidence: [{ chunk_id: "c1", quote }],
        valid_time: { from: null, from_basis: "unknown", from_granularity: "unknown" },
      }],
      refusals: [],
    });

    expect(parseExtractionResponse(raw)!.attestations).toHaveLength(1);
  });

  it.each([
    ["I will update the incident template next week.", "incidental_update"],
    ["We should require hardware keys for everyone.", "proposal_or_question"],
    ["On-call is a haunted house lol", "banter"],
  ])("refuses a non-operational %s", (quote, reason) => {
    const raw = JSON.stringify({
      attestations: [{
        claim: quote,
        claim_key: "weak_claim",
        claim_fingerprint: `weak_claim:${quote}`,
        evidence: [{ chunk_id: "c1", quote }],
        valid_time: { from: null, from_basis: "unknown", from_granularity: "unknown" },
      }],
      refusals: [],
    });

    const out = parseExtractionResponse(raw)!;
    expect(out.attestations).toHaveLength(0);
    expect(out.refusals).toContainEqual({ candidate: quote, reason });
  });

  it("recovers JSON wrapped in a code fence with preamble", () => {
    const raw = "Sure!\n```json\n" + JSON.stringify({ attestations: [], refusals: [] }) + "\n```";
    expect(parseExtractionResponse(raw)).not.toBeNull();
  });

  it("returns null when no JSON object is present", () => {
    expect(parseExtractionResponse("no json here at all")).toBeNull();
  });
});

describe("extractAttestations (reporter over the provider chain)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the parsed extraction on a valid response", async () => {
    vi.mocked(chatSynthesis).mockResolvedValue(
      JSON.stringify({
        attestations: [
          { claim: "x", claim_key: "k", claim_fingerprint: "k:x", evidence: [{ chunk_id: "c1", quote: "x" }], valid_time: { from: null, from_basis: "unknown", from_granularity: "unknown" } },
        ],
        refusals: [],
      })
    );
    const out = await extractAttestations({ domain: "incident_response", chunks: [{ id: "c1", source: "slack", text: "x" }] });
    expect(out.attestations).toHaveLength(1);
    expect(vi.mocked(chatSynthesis)).toHaveBeenCalledTimes(1);
  });

  it("retries once then yields an empty result on unparseable responses", async () => {
    vi.mocked(chatSynthesis).mockResolvedValue("not json");
    const out = await extractAttestations({ domain: "incident_response", chunks: [{ id: "c1", source: "slack", text: "x" }] });
    expect(out).toEqual({ attestations: [], refusals: [] });
    expect(vi.mocked(chatSynthesis)).toHaveBeenCalledTimes(2);
  });
});
