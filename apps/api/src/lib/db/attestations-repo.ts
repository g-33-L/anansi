import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./index.js";
import { attestations, type Attestation, type NewAttestation } from "./schema.js";

// Repository for the append-only attestation primitive. Read methods mirror the
// entity_edges bi-temporal semantics: the valid-time / knowledge-time filter is
// applied in JS after a bounded workspace-scoped read, NOT in SQL. Drizzle reads
// `timestamp` columns back as the exact UTC instants they were written, so
// getTime() comparisons are tz-safe — binding a raw Date into SQL would let
// node-pg serialize it in local time (see query-engine.ts getEntitiesForUser).

// Upper bound on rows projected per query — matches the entity_edges convention of
// reading a bounded set then filtering in JS.
const MAX_ATTESTATIONS = 5000;

export interface AttestationFilter {
  domain?: string;
  status?: string;
  subjectEntityId?: string;
}

export interface AsOfValidTimeOptions extends AttestationFilter {
  asOf: Date;
}

export interface AsOfKnowledgeTimeOptions extends AttestationFilter {
  // asOf is optional: with only asOfKnowledge you reconstruct "everything we
  // believed as of knowledge-time K", regardless of valid-time.
  asOf?: Date;
  asOfKnowledge: Date;
}

// Append-only insert. Race-safe via the partial unique index on active claims
// (attestations_active_unique, valid_until IS NULL): an identical active claim in
// the same workspace is a no-op rather than a duplicate. Returns the inserted row,
// or — when the insert was a no-op — the existing active claim with that fingerprint.
export async function insertAttestation(input: NewAttestation): Promise<Attestation> {
  const [inserted] = await db
    .insert(attestations)
    .values(input)
    .onConflictDoNothing({
      target: [attestations.workspaceId, attestations.claimFingerprint],
      where: sql`${attestations.validUntil} IS NULL`,
    })
    .returning();

  if (inserted) return inserted;

  // Conflict: an active claim with this fingerprint already exists — return it so
  // callers always get the current active row for the fingerprint.
  const [existing] = await db
    .select()
    .from(attestations)
    .where(
      and(
        eq(attestations.workspaceId, input.workspaceId),
        eq(attestations.claimFingerprint, input.claimFingerprint),
        isNull(attestations.validUntil)
      )
    )
    .limit(1);

  return existing;
}

// Currently-believed-open claims (valid_until IS NULL). The null check is tz-safe,
// so this filter runs in SQL. Status is filtered only when provided — publish
// policy (e.g. "observed only") belongs to the view layer, not the primitive.
export async function getActive(
  workspaceId: string,
  filter: AttestationFilter = {}
): Promise<Attestation[]> {
  const conditions = [eq(attestations.workspaceId, workspaceId), isNull(attestations.validUntil)];
  if (filter.status !== undefined) conditions.push(eq(attestations.status, filter.status));
  if (filter.domain !== undefined) conditions.push(eq(attestations.domain, filter.domain));
  if (filter.subjectEntityId !== undefined)
    conditions.push(eq(attestations.subjectEntityId, filter.subjectEntityId));

  return db
    .select()
    .from(attestations)
    .where(and(...conditions))
    .orderBy(desc(attestations.recordedAt))
    .limit(MAX_ATTESTATIONS);
}

// Shared bi-temporal projector. Reads the workspace's attestations (optionally
// pre-filtered by domain/status/subject in SQL) then keeps only those that held at
// the requested (valid-time, knowledge-time) coordinate, applying the exact
// entity_edges semantics.
async function reconstruct(
  workspaceId: string,
  opts: { asOf?: Date; asOfKnowledge?: Date } & AttestationFilter
): Promise<Attestation[]> {
  const conditions = [eq(attestations.workspaceId, workspaceId)];
  if (opts.status !== undefined) conditions.push(eq(attestations.status, opts.status));
  if (opts.domain !== undefined) conditions.push(eq(attestations.domain, opts.domain));
  if (opts.subjectEntityId !== undefined)
    conditions.push(eq(attestations.subjectEntityId, opts.subjectEntityId));

  const rows = await db
    .select()
    .from(attestations)
    .where(and(...conditions))
    .orderBy(desc(attestations.recordedAt))
    .limit(MAX_ATTESTATIONS);

  const V = opts.asOf?.getTime(); // valid-time instant
  const K = opts.asOfKnowledge?.getTime(); // knowledge-time instant
  const kept: Attestation[] = [];

  for (const a of rows) {
    // Knowledge-time: skip claims we hadn't recorded yet, and treat a claim's end
    // as unknown unless we'd learned of it by K.
    let effectiveUntil = a.validUntil;
    if (K !== undefined) {
      if (a.recordedAt.getTime() > K) continue;
      effectiveUntil =
        a.validUntilRecordedAt && a.validUntilRecordedAt.getTime() <= K ? a.validUntil : null;
    }

    // Valid-time: keep only claims active at V, half-open [lower, effectiveUntil).
    // The lower bound floors at recordedAt when validFrom is unknown — the ledger
    // must never imply a truth existed before the evidence for it.
    if (V !== undefined) {
      const lower = (a.validFrom ?? a.recordedAt).getTime();
      if (lower > V) continue;
      if (effectiveUntil && effectiveUntil.getTime() <= V) continue;
    }

    kept.push(a);
  }

  return kept;
}

// Claims that held at `asOf` (valid-time point query). Half-open boundaries and
// the recordedAt floor for unknown validFrom match entity_edges.
export async function getAsOfValidTime(
  workspaceId: string,
  opts: AsOfValidTimeOptions
): Promise<Attestation[]> {
  const { asOf, ...filter } = opts;
  return reconstruct(workspaceId, { asOf, ...filter });
}

// Bi-temporal reconstruction: claims as they were BELIEVED as of knowledge-time
// asOfKnowledge (optionally also constrained to a valid-time instant asOf). A
// claim's close is applied only if we'd learned of it by asOfKnowledge, so a
// correction recorded later does not leak into an earlier knowledge-time view.
export async function getAsOfKnowledgeTime(
  workspaceId: string,
  opts: AsOfKnowledgeTimeOptions
): Promise<Attestation[]> {
  const { asOf, asOfKnowledge, ...filter } = opts;
  return reconstruct(workspaceId, { asOf, asOfKnowledge, ...filter });
}

// The active claims answering a given claim_key (the "question"). More than one
// row means competing answers coexist — a dispute — which callers derive at the
// query layer rather than by mutating rows.
export async function getActiveByClaimKey(
  workspaceId: string,
  claimKey: string
): Promise<Attestation[]> {
  return db
    .select()
    .from(attestations)
    .where(
      and(
        eq(attestations.workspaceId, workspaceId),
        eq(attestations.claimKey, claimKey),
        isNull(attestations.validUntil)
      )
    );
}

// Full history for a workspace (optionally one domain): active AND closed rows,
// oldest-recorded first. Used by the timeline view, which needs superseded rows,
// not just the currently-active ones.
export async function getHistory(
  workspaceId: string,
  filter: { domain?: string } = {}
): Promise<Attestation[]> {
  const conditions = [eq(attestations.workspaceId, workspaceId)];
  if (filter.domain !== undefined) conditions.push(eq(attestations.domain, filter.domain));
  return db
    .select()
    .from(attestations)
    .where(and(...conditions))
    .orderBy(attestations.recordedAt)
    .limit(MAX_ATTESTATIONS);
}

// The single active claim for a specific answer (fingerprint), if any. At most one
// exists — guaranteed by the attestations_active_unique partial index.
export async function getActiveByFingerprint(
  workspaceId: string,
  claimFingerprint: string
): Promise<Attestation | undefined> {
  const [row] = await db
    .select()
    .from(attestations)
    .where(
      and(
        eq(attestations.workspaceId, workspaceId),
        eq(attestations.claimFingerprint, claimFingerprint),
        isNull(attestations.validUntil)
      )
    )
    .limit(1);
  return row;
}

// The ONLY permitted mutation on an attestation: close it by stamping the two time
// boundaries. Content columns (claim, evidence, confidence, valid_from, claim_key,
// claim_fingerprint) are never touched — the ledger is append-only, so a
// correction closes the old row and inserts a new one rather than editing history.
export async function closeAttestation(
  id: string,
  close: { validUntil: Date; validUntilRecordedAt: Date }
): Promise<void> {
  await db
    .update(attestations)
    .set({ validUntil: close.validUntil, validUntilRecordedAt: close.validUntilRecordedAt })
    .where(eq(attestations.id, id));
}
