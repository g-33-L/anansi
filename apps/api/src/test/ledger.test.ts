import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, developerAccounts, type NewAttestation } from "../lib/db/schema.js";
import { insertAttestation, closeAttestation } from "../lib/db/attestations-repo.js";
import { reconstructLedger } from "../lib/ai/ledger.js";
import { cleanDatabase } from "./setup.js";

// PR-3 ledger fold. Reconstructs cited, trust-tiered answers at any (valid-time,
// knowledge-time) coordinate and flags disputes. Read-only over the repo.

let workspaceId: string;
let developerId: string;

const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-04-01T00:00:00Z");
const MID = new Date("2026-02-15T00:00:00Z");
const AFTER = new Date("2026-06-01T00:00:00Z");

beforeEach(async () => {
  await cleanDatabase();
  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  workspaceId = ws.id;
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId, name: "Dev", email: "ledger@test.com" })
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
    status: "candidate",
    confidence: 0.5,
    evidence: [{ chunkId: "c1", quote: "q", source: "slack #incidents", author: "dan" }],
    ...o,
  };
}

describe("reconstructLedger — current view", () => {
  it("returns cited active claims and no dispute for distinct questions", async () => {
    await insertAttestation(make({ claimKey: "k1", claimFingerprint: "k1:a", status: "observed", confidence: 0.8 }));
    await insertAttestation(make({ claimKey: "k2", claimFingerprint: "k2:b" }));

    const view = await reconstructLedger(workspaceId, { domain: "incident_response" });
    expect(view.claims).toHaveLength(2);
    expect(view.disputes).toHaveLength(0);
    // Every surfaced claim is cited.
    for (const c of view.claims) expect(c.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("orders observed before candidate", async () => {
    await insertAttestation(make({ claimKey: "kc", claimFingerprint: "kc:x", status: "candidate", confidence: 0.9 }));
    await insertAttestation(make({ claimKey: "ko", claimFingerprint: "ko:y", status: "observed", confidence: 0.6 }));

    const view = await reconstructLedger(workspaceId, {});
    expect(view.claims[0].status).toBe("observed");
    expect(view.claims[1].status).toBe("candidate");
  });
});

describe("reconstructLedger — disputes", () => {
  it("groups competing answers under one claim_key and marks them disputed", async () => {
    await insertAttestation(make({ claimKey: "escalation_channel", claimFingerprint: "escalation_channel:#incidents" }));
    await insertAttestation(make({ claimKey: "escalation_channel", claimFingerprint: "escalation_channel:#engineering" }));

    const view = await reconstructLedger(workspaceId, {});
    expect(view.disputes).toHaveLength(1);
    expect(view.disputes[0].claimKey).toBe("escalation_channel");
    expect(new Set(view.disputes[0].answers.map((a) => a.claimFingerprint))).toEqual(
      new Set(["escalation_channel:#incidents", "escalation_channel:#engineering"])
    );
    expect(view.claims.every((c) => c.disputed)).toBe(true);
  });
});

describe("reconstructLedger — time travel", () => {
  it("valid-time: a closed claim appears in its window, not after", async () => {
    const a = await insertAttestation(make({ claimFingerprint: "k:old", validFrom: T0 }));
    await closeAttestation(a.id, { validUntil: T1, validUntilRecordedAt: new Date() });

    const inWindow = await reconstructLedger(workspaceId, { asOf: MID });
    expect(inWindow.claims.map((c) => c.claimFingerprint)).toEqual(["k:old"]);
    const afterEnd = await reconstructLedger(workspaceId, { asOf: AFTER });
    expect(afterEnd.claims).toHaveLength(0);
  });

  it("knowledge-time: a later-learned close does not leak into an earlier belief", async () => {
    const learnedAt = new Date("2026-05-01T00:00:00Z");
    const a = await insertAttestation(make({ claimFingerprint: "k:belief", validFrom: T0, recordedAt: T0 }));
    await closeAttestation(a.id, { validUntil: T1, validUntilRecordedAt: learnedAt });

    // Before we learned it ended, it reads as still true even past its real end.
    const believedThen = await reconstructLedger(workspaceId, {
      asOf: AFTER,
      asOfKnowledge: new Date("2026-04-15T00:00:00Z"),
    });
    expect(believedThen.claims.map((c) => c.claimFingerprint)).toEqual(["k:belief"]);
    // After we learned it, it is closed.
    const knownNow = await reconstructLedger(workspaceId, {
      asOf: AFTER,
      asOfKnowledge: new Date("2026-05-15T00:00:00Z"),
    });
    expect(knownNow.claims).toHaveLength(0);
  });
});

describe("reconstructLedger — domain isolation", () => {
  it("only returns claims in the requested domain", async () => {
    await insertAttestation(make({ domain: "incident_response", claimFingerprint: "k:inc" }));
    await insertAttestation(make({ domain: "refunds", claimFingerprint: "k:ref" }));

    const view = await reconstructLedger(workspaceId, { domain: "incident_response" });
    expect(view.claims.map((c) => c.claimFingerprint)).toEqual(["k:inc"]);
  });
});
