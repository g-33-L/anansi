import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, developerAccounts, type NewAttestation } from "../lib/db/schema.js";
import { insertAttestation, closeAttestation } from "../lib/db/attestations-repo.js";
import { computeDivergences, computeTimeline } from "../lib/ai/ledger-diff.js";
import { cleanDatabase } from "./setup.js";

// PR-4: doc-vs-reality divergence + change timeline. The unique capability — only
// possible because the ledger keeps two-axis history and never overwrites.

let workspaceId: string;
let developerId: string;

const MARCH = new Date("2026-03-01T00:00:00Z");

beforeEach(async () => {
  await cleanDatabase();
  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  workspaceId = ws.id;
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId, name: "Dev", email: "diff@test.com" })
    .returning({ id: developerAccounts.id });
  developerId = dev.id;
});

afterAll(closePool);

function make(o: Partial<NewAttestation> = {}): NewAttestation {
  return {
    workspaceId,
    developerId,
    claim: "a claim",
    claimFingerprint: "k:a",
    claimKey: "k",
    domain: "incident_response",
    status: "observed",
    confidence: 0.6,
    evidence: [{ chunkId: "c1", quote: "q", source: "slack #incidents", author: "dan" }],
    ...o,
  };
}

describe("computeDivergences", () => {
  it("flags where the runbook and observed behaviour disagree, with the change date", async () => {
    // Documented: escalate in #engineering (from the Notion runbook).
    await insertAttestation(
      make({
        claim: "Incidents are escalated in #engineering",
        claimKey: "escalation_channel",
        claimFingerprint: "escalation_channel:#engineering",
        evidence: [{ chunkId: "b1", quote: "escalated in #engineering", source: "notion Incident Response Runbook", author: "notion" }],
      })
    );
    // Observed: escalation actually happens in #incidents, stated since March.
    await insertAttestation(
      make({
        claim: "Incident comms happen in #incidents",
        claimKey: "escalation_channel",
        claimFingerprint: "escalation_channel:#incidents",
        validFrom: MARCH,
        validFromBasis: "stated",
        evidence: [{ chunkId: "m4", quote: "since March we run all incident comms out of #incidents", source: "slack #incidents", author: "sarah" }],
      })
    );

    const divs = await computeDivergences(workspaceId, { domain: "incident_response" });
    expect(divs).toHaveLength(1);
    expect(divs[0].claimKey).toBe("escalation_channel");
    expect(divs[0].documented.fingerprint).toBe("escalation_channel:#engineering");
    expect(divs[0].observed.fingerprint).toBe("escalation_channel:#incidents");
    expect(divs[0].changedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("still flags a divergence when the documented answer was superseded by a change", async () => {
    // The live failure mode: the model marks the change (which CLOSES the documented
    // answer), so it is no longer active — but a stale doc drifting from reality is
    // exactly what we must surface. Divergence must read history, not just active rows.
    const eng = await insertAttestation(
      make({
        claim: "Incidents are escalated in #engineering",
        claimKey: "escalation_channel",
        claimFingerprint: "escalation_channel:#engineering",
        evidence: [{ chunkId: "b1", quote: "escalated in #engineering", source: "notion runbook", author: "notion" }],
      })
    );
    await closeAttestation(eng.id, { validUntil: MARCH, validUntilRecordedAt: new Date("2026-07-01T00:00:00Z") });
    await insertAttestation(
      make({
        claim: "Incident comms happen in #incidents",
        claimKey: "escalation_channel",
        claimFingerprint: "escalation_channel:#incidents",
        validFrom: MARCH,
        validFromBasis: "stated",
        evidence: [{ chunkId: "m4", quote: "since March", source: "slack #incidents", author: "sarah" }],
      })
    );

    const divs = await computeDivergences(workspaceId, { domain: "incident_response" });
    expect(divs).toHaveLength(1);
    expect(divs[0].documented.fingerprint).toBe("escalation_channel:#engineering");
    expect(divs[0].observed.fingerprint).toBe("escalation_channel:#incidents");
    expect(divs[0].changedAt).toBe("2026-03-01T00:00:00.000Z");
  });

  it("does not flag a resolved historical disagreement as an active divergence", async () => {
    await insertAttestation(
      make({
        claim: "Incidents are escalated in #engineering",
        claimKey: "escalation_channel",
        claimFingerprint: "escalation_channel:#engineering",
        evidence: [{ chunkId: "b1", quote: "escalated in #engineering", source: "notion runbook", author: "notion" }],
      })
    );
    const historicalObserved = await insertAttestation(
      make({
        claim: "Incident comms happened in #incidents",
        claimKey: "escalation_channel",
        claimFingerprint: "escalation_channel:#incidents",
        evidence: [{ chunkId: "m4", quote: "ran incident comms out of #incidents", source: "slack #incidents", author: "sarah" }],
      })
    );
    await closeAttestation(historicalObserved.id, {
      validUntil: MARCH,
      validUntilRecordedAt: new Date("2026-07-01T00:00:00Z"),
    });

    expect(await computeDivergences(workspaceId, { domain: "incident_response" })).toHaveLength(0);
  });

  it("does not flag a divergence when there is only one answer", async () => {
    await insertAttestation(make({ claimKey: "postmortem", claimFingerprint: "postmortem:required", evidence: [{ chunkId: "b3", quote: "required", source: "notion runbook" }] }));
    expect(await computeDivergences(workspaceId, {})).toHaveLength(0);
  });

  it("does not flag two observed answers with no documented side", async () => {
    await insertAttestation(make({ claimKey: "tool", claimFingerprint: "tool:grafana", evidence: [{ chunkId: "m1", quote: "grafana", source: "slack" }] }));
    await insertAttestation(make({ claimKey: "tool", claimFingerprint: "tool:datadog", evidence: [{ chunkId: "m2", quote: "datadog", source: "slack" }] }));
    expect(await computeDivergences(workspaceId, {})).toHaveLength(0);
  });
});

describe("computeTimeline", () => {
  it("records adoption (stated start) and supersession (close) in chronological order", async () => {
    // #engineering adopted (no stated start -> recorded_at) then superseded in March.
    const eng = await insertAttestation(
      make({ claimKey: "escalation_channel", claimFingerprint: "escalation_channel:#engineering", recordedAt: new Date("2026-01-01T00:00:00Z") })
    );
    await closeAttestation(eng.id, { validUntil: MARCH, validUntilRecordedAt: new Date("2026-07-01T00:00:00Z") });
    // #incidents adopted with a stated start in March.
    await insertAttestation(
      make({ claimKey: "escalation_channel", claimFingerprint: "escalation_channel:#incidents", validFrom: MARCH, validFromBasis: "stated", recordedAt: new Date("2026-05-01T00:00:00Z") })
    );

    const timeline = await computeTimeline(workspaceId, { domain: "incident_response" });
    expect(timeline).toHaveLength(3);
    expect(timeline.map((e) => `${e.at.slice(0, 10)}:${e.kind}:${e.fingerprint.split(":")[1]}`)).toEqual([
      "2026-01-01:adopted:#engineering",
      "2026-03-01:superseded:#engineering",
      "2026-03-01:adopted:#incidents",
    ]);
  });

  it("uses recorded_at for adoption when no start date was stated (never invents one)", async () => {
    await insertAttestation(make({ claimFingerprint: "k:x", validFrom: null, recordedAt: new Date("2026-02-10T00:00:00Z") }));
    const timeline = await computeTimeline(workspaceId, {});
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ at: "2026-02-10T00:00:00.000Z", kind: "adopted" });
  });
});
