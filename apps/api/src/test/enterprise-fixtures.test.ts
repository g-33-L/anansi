import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { scoreDivergence, claimsMatch, scoreDocsBaseline } from "../lib/ai/extraction-eval.js";

// Regression protection for the enterprise evaluation dataset. These are
// deterministic (no model) and MUST fail loudly if evidence integrity drops,
// oracle references break, planted divergence ids disappear, or the fixture
// structure changes — the exact guarantees the eval harness relies on.

const DIR = resolve(process.cwd(), "scripts/eval/fixtures/enterprise");
const domains = existsSync(DIR)
  ? readdirSync(DIR).filter((d) => existsSync(resolve(DIR, d, "expected_attestations.json"))).sort()
  : [];

describe("enterprise fixture dataset", () => {
  it("has at least the five committed domains", () => {
    expect(domains.length).toBeGreaterThanOrEqual(5);
    for (const d of ["incidents", "customer_escalation", "product_decisions", "security_compliance", "onboarding"]) {
      expect(domains).toContain(d);
    }
  });

  for (const domain of domains) {
    describe(domain, () => {
      const j = (f: string) => JSON.parse(readFileSync(resolve(DIR, domain, f), "utf8"));
      const slack = j("slack_messages.json").messages as Array<{ id: string; text: string }>;
      const docs = j("notion_docs.json").docs as Array<{ blocks: Array<{ id: string; text: string }> }>;
      const oracle = j("expected_attestations.json");
      const src = new Map<string, string>();
      for (const m of slack) src.set(m.id, m.text);
      for (const doc of docs) for (const b of doc.blocks) src.set(b.id, b.text);

      it("has the required structure", () => {
        expect(Array.isArray(slack)).toBe(true);
        expect(Array.isArray(oracle.attestations)).toBe(true);
        expect(Array.isArray(oracle.refusals)).toBe(true);
        expect(Array.isArray(oracle.divergences)).toBe(true);
        expect(oracle.divergences.length).toBeGreaterThanOrEqual(1);
      });

      it("every oracle quote is a verbatim substring of its source (evidence integrity)", () => {
        for (const a of oracle.attestations) {
          for (const e of a.evidence) {
            const text = src.get(e.source_id);
            expect(text, `${domain}: source ${e.source_id} missing`).toBeDefined();
            expect(text!.includes(e.quote), `${domain}: non-verbatim quote in ${e.source_id}: "${e.quote}"`).toBe(true);
          }
        }
      });

      it("every refusal source id resolves", () => {
        for (const r of oracle.refusals) expect(src.has(r.source_id), `${domain}: refusal ${r.source_id} missing`).toBe(true);
      });

      it("every divergence fingerprint resolves to an attestation", () => {
        const fps = new Set(oracle.attestations.map((a: { claim_fingerprint: string }) => a.claim_fingerprint));
        for (const dv of oracle.divergences) {
          expect(fps.has(dv.documented), `${domain}: divergence documented ${dv.documented} missing`).toBe(true);
          expect(fps.has(dv.observed), `${domain}: divergence observed ${dv.observed} missing`).toBe(true);
        }
      });
    });
  }
});

describe("scoreDivergence", () => {
  const expected = { documentedClaim: "Access reviews are conducted quarterly", observedClaim: "Access reviews are conducted monthly", changedAt: "2026-02" };

  it("detects a semantically-matching fired divergence with the correct change month", () => {
    const s = scoreDivergence(
      [{ documented: { claim: "Access reviews are done quarterly by security" }, observed: { claim: "Access reviews are now done monthly" }, changedAt: "2026-02-01T00:00:00.000Z" }],
      expected
    );
    expect(s.expectedDetected).toBe(true);
    expect(s.falseAlerts).toBe(0);
    expect(s.changedDateCorrect).toBe(true);
  });

  it("counts a non-matching fired divergence as a false alert and a miss", () => {
    const s = scoreDivergence([{ documented: { claim: "Deploys happen on Fridays" }, observed: { claim: "Deploys happen daily" }, changedAt: null }], expected);
    expect(s.expectedDetected).toBe(false);
    expect(s.falseAlerts).toBe(1);
  });

  it("flags a detected divergence with the wrong change date", () => {
    const s = scoreDivergence(
      [{ documented: { claim: "Access reviews are conducted quarterly" }, observed: { claim: "Access reviews are conducted monthly" }, changedAt: "2026-09-01T00:00:00.000Z" }],
      expected
    );
    expect(s.expectedDetected).toBe(true);
    expect(s.changedDateCorrect).toBe(false);
  });

  it("reports a miss when nothing fired", () => {
    expect(scoreDivergence([], expected).expectedDetected).toBe(false);
  });
});

describe("scoreDocsBaseline", () => {
  const oracle = {
    attestations: [
      { evidence: [{ source_id: "b1" }] }, // documented
      { evidence: [{ source_id: "m1" }] }, // slack-only (not in docs)
      { evidence: [{ source_id: "b2" }, { source_id: "m2" }] }, // documented + slack
    ],
    divergences: [{}],
  };
  const isDoc = (id: string) => id.startsWith("b");

  it("counts only documented facts toward coverage", () => {
    const s = scoreDocsBaseline(oracle, isDoc);
    expect(s.goldTotal).toBe(3);
    expect(s.documentedGold).toBe(2);
    expect(s.coverage).toBeCloseTo(2 / 3);
  });

  it("never detects drift and treats every drifted doc as stale", () => {
    const s = scoreDocsBaseline(oracle, isDoc);
    expect(s.driftDetected).toBe(0);
    expect(s.staleUnderDrift).toBe(1);
  });
});

describe("claimsMatch", () => {
  it("matches paraphrases and rejects unrelated claims", () => {
    expect(claimsMatch("P0 incidents open a war room in #incidents", "P0 incidents require opening a war room")).toBe(true);
    expect(claimsMatch("Postmortems are required for P0 and P1", "Bananas are stored in the fridge")).toBe(false);
  });
});
