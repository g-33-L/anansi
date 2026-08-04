import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, developerAccounts, attestations, type NewAttestation } from "../lib/db/schema.js";
import {
  insertAttestation,
  getActive,
  getAsOfValidTime,
  getAsOfKnowledgeTime,
} from "../lib/db/attestations-repo.js";
import { cleanDatabase } from "./setup.js";

// ─── Attestation primitive — append-only bi-temporal repository ───────────────
// Proves the ledger primitive holds both time axes, preserves history (never
// forgets), floors truth at its evidence, and keeps competing claims side by side.
// Temporal predicates mirror entity_edges (see temporal-query.test.ts).

let workspaceId: string;
let developerId: string;
let otherWorkspaceId: string;
let otherDeveloperId: string;

// A fixed timeline for the valid-time / knowledge-time assertions.
const T0 = new Date("2026-01-01T00:00:00Z"); // claim becomes true
const T1 = new Date("2026-04-01T00:00:00Z"); // claim ends (real world)
const MID = new Date("2026-02-15T00:00:00Z"); // between T0 and T1
const AFTER = new Date("2026-06-01T00:00:00Z"); // after T1

async function makeWorkspace(email: string): Promise<{ workspaceId: string; developerId: string }> {
  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId: ws.id, name: "Test Dev", email })
    .returning({ id: developerAccounts.id });
  return { workspaceId: ws.id, developerId: dev.id };
}

beforeEach(async () => {
  await cleanDatabase();
  ({ workspaceId, developerId } = await makeWorkspace("attest@test.com"));
  ({ workspaceId: otherWorkspaceId, developerId: otherDeveloperId } =
    await makeWorkspace("attest-other@test.com"));
});

afterAll(closePool);

function make(overrides: Partial<NewAttestation> = {}): NewAttestation {
  return {
    workspaceId,
    developerId,
    claim: "P0 incidents open a war room in #incidents",
    claimFingerprint: "incident_response::war_room::incidents",
    ...overrides,
  };
}

describe("insertAttestation — round trip, evidence, conservative defaults", () => {
  it("round-trips the claim, evidence, and conservative trust defaults", async () => {
    const inserted = await insertAttestation(
      make({
        domain: "incident_response",
        evidence: [
          { chunkId: "chunk-1", quote: "opening the war room in #incidents", source: "slack #incidents", author: "sarah" },
        ],
      })
    );

    const [row] = await getActive(workspaceId);
    expect(row.id).toBe(inserted.id);
    expect(row.claim).toBe("P0 incidents open a war room in #incidents");
    expect(row.domain).toBe("incident_response");
    // Evidence persists intact.
    expect(row.evidence).toHaveLength(1);
    expect(row.evidence[0]).toMatchObject({ chunkId: "chunk-1", quote: "opening the war room in #incidents" });
    // The ledger never invents certainty: defaults must be conservative.
    expect(row.confidence).toBe(0);
    expect(row.status).toBe("candidate");
    expect(row.inferenceStatus).toBe("inferred");
    expect(row.validFromBasis).toBe("unknown");
    // recordedAt is always stamped (knowledge-time is free and certain).
    expect(row.recordedAt).toBeInstanceOf(Date);
  });
});

describe("append-only behavior — closing preserves history", () => {
  it("a closed claim is absent from getActive but still reconstructs in the past", async () => {
    const a = await insertAttestation(make({ validFrom: T0 }));
    // Close it (real-world end T1, learned now) — an update, never a delete.
    await db
      .update(attestations)
      .set({ validUntil: T1, validUntilRecordedAt: new Date() })
      .where(eq(attestations.id, a.id));

    expect(await getActive(workspaceId)).toHaveLength(0);
    // The row is preserved: a valid-time query in its window still returns it.
    const past = await getAsOfValidTime(workspaceId, { asOf: MID });
    expect(past.map((r) => r.id)).toEqual([a.id]);
  });
});

describe("valid-time — half-open boundaries", () => {
  beforeEach(async () => {
    // Claim A holds [T0, T1); successor claim B holds [T1, open). Distinct
    // fingerprints so both may exist (A closed, B active).
    const a = await insertAttestation(make({ claimFingerprint: "fp-a", validFrom: T0 }));
    await db
      .update(attestations)
      .set({ validUntil: T1, validUntilRecordedAt: new Date() })
      .where(eq(attestations.id, a.id));
    await insertAttestation(make({ claim: "successor", claimFingerprint: "fp-b", validFrom: T1 }));
  });

  it("includes a claim at its start instant", async () => {
    const rows = await getAsOfValidTime(workspaceId, { asOf: T0 });
    expect(rows.map((r) => r.claimFingerprint)).toEqual(["fp-a"]);
  });

  it("excludes a claim at its end instant (half-open [from, until)) and hands off to the successor", async () => {
    const rows = await getAsOfValidTime(workspaceId, { asOf: T1 });
    // At exactly T1, A has ended and B has begun.
    expect(rows.map((r) => r.claimFingerprint)).toEqual(["fp-b"]);
  });

  it("includes a claim mid-window", async () => {
    const rows = await getAsOfValidTime(workspaceId, { asOf: MID });
    expect(rows.map((r) => r.claimFingerprint)).toEqual(["fp-a"]);
  });
});

describe("knowledge-time — reconstructing past beliefs", () => {
  // Claim recorded at R0, believed to hold [T0, open). We learned at LEARN it had
  // ended at T1. recordedAt=R0, validUntil=T1, validUntilRecordedAt=LEARN.
  const R0 = new Date("2026-01-01T00:00:00Z");
  const LEARN = new Date("2026-05-01T00:00:00Z");
  const BEFORE_LEARN = new Date("2026-04-15T00:00:00Z");
  const AFTER_LEARN = new Date("2026-05-15T00:00:00Z");

  beforeEach(async () => {
    const a = await insertAttestation(make({ claimFingerprint: "fp-k", validFrom: T0, recordedAt: R0 }));
    await db
      .update(attestations)
      .set({ validUntil: T1, validUntilRecordedAt: LEARN })
      .where(eq(attestations.id, a.id));
  });

  it("before we learned of the end, the claim reads as still open (belief at that time)", async () => {
    // asOf after the real-world end, but knowledge-time before we learned it ended.
    const rows = await getAsOfKnowledgeTime(workspaceId, { asOf: AFTER, asOfKnowledge: BEFORE_LEARN });
    expect(rows.map((r) => r.claimFingerprint)).toEqual(["fp-k"]);
  });

  it("after we learned of the end, the claim is closed and excluded past its end", async () => {
    const rows = await getAsOfKnowledgeTime(workspaceId, { asOf: AFTER, asOfKnowledge: AFTER_LEARN });
    expect(rows).toHaveLength(0);
  });

  it("a claim not yet recorded is invisible at an earlier knowledge-time", async () => {
    const beforeRecorded = new Date("2025-12-01T00:00:00Z");
    const rows = await getAsOfKnowledgeTime(workspaceId, { asOf: MID, asOfKnowledge: beforeRecorded });
    expect(rows).toHaveLength(0);
  });
});

describe("unknown valid_from — never imply truth before evidence", () => {
  it("floors the lower bound at recordedAt when valid_from is unknown", async () => {
    const R0 = new Date("2026-03-01T00:00:00Z");
    await insertAttestation(make({ claimFingerprint: "fp-u", validFrom: null, recordedAt: R0 }));

    // Before we observed it: the ledger must not claim it was true.
    const before = await getAsOfValidTime(workspaceId, { asOf: new Date("2026-02-01T00:00:00Z") });
    expect(before).toHaveLength(0);
    // At/after first observation: it holds.
    const after = await getAsOfValidTime(workspaceId, { asOf: new Date("2026-03-15T00:00:00Z") });
    expect(after.map((r) => r.claimFingerprint)).toEqual(["fp-u"]);
  });
});

describe("workspace isolation", () => {
  it("never returns another workspace's attestations", async () => {
    await insertAttestation(make({ claim: "other-ws", claimFingerprint: "fp-other" }));
    await insertAttestation({
      workspaceId: otherWorkspaceId,
      developerId: otherDeveloperId,
      claim: "leak",
      claimFingerprint: "fp-leak",
      validFrom: T0,
    });

    const active = await getActive(workspaceId);
    expect(active.every((r) => r.workspaceId === workspaceId)).toBe(true);
    expect(active.map((r) => r.claim)).not.toContain("leak");

    const asOf = await getAsOfValidTime(workspaceId, { asOf: MID });
    expect(asOf.every((r) => r.workspaceId === workspaceId)).toBe(true);
  });
});

describe("competing claims coexist (dispute substrate)", () => {
  it("two active claims sharing a claim_key but with distinct fingerprints both persist", async () => {
    await insertAttestation(
      make({ claim: "escalate in #eng", claimKey: "where_do_escalations_go", claimFingerprint: "fp-eng" })
    );
    await insertAttestation(
      make({ claim: "escalate in #incidents", claimKey: "where_do_escalations_go", claimFingerprint: "fp-inc" })
    );

    const active = await getActive(workspaceId);
    expect(active).toHaveLength(2);
    expect(new Set(active.map((r) => r.claimFingerprint))).toEqual(new Set(["fp-eng", "fp-inc"]));
  });
});

describe("active uniqueness behavior", () => {
  it("re-inserting the same active fingerprint is a no-op that returns the existing row", async () => {
    const first = await insertAttestation(make({ claimFingerprint: "fp-dupe" }));
    const second = await insertAttestation(make({ claimFingerprint: "fp-dupe", claim: "different text" }));

    expect(second.id).toBe(first.id); // collapsed, not duplicated
    const active = await getActive(workspaceId);
    expect(active).toHaveLength(1);
  });

  it("allows a new active claim with the same fingerprint once the prior one is closed", async () => {
    const first = await insertAttestation(make({ claimFingerprint: "fp-reuse", validFrom: T0 }));
    await db
      .update(attestations)
      .set({ validUntil: T1, validUntilRecordedAt: new Date() })
      .where(eq(attestations.id, first.id));

    const second = await insertAttestation(make({ claimFingerprint: "fp-reuse", validFrom: T1 }));
    expect(second.id).not.toBe(first.id);

    // One active now; two rows total (history preserved).
    const active = await getActive(workspaceId);
    expect(active.map((r) => r.id)).toEqual([second.id]);
    const all = await db.select().from(attestations).where(eq(attestations.workspaceId, workspaceId));
    expect(all).toHaveLength(2);
  });
});
