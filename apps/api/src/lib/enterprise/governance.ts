/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

/*
 * Generic governance approval queue (Phase 7). approval_requests is a small,
 * kind-tagged workflow table: something requests an action (skill_publish,
 * role_grant, data_export, …), an approver decides, and the decision is recorded
 * with who/when. Skill-publish review reuses skill_drafts fields elsewhere; this
 * is the org-wide queue for everything that isn't skill-specific.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { approvalRequests, type ApprovalRequest } from "../db/schema.js";

export const APPROVAL_KINDS = ["skill_publish", "role_grant", "data_export", "connector_add"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
export type ApprovalStatus = "pending" | "approved" | "rejected";

/**
 * Subject reference used by the governed audit-log export action. Keeping this
 * stable lets an approval be inspected at enforcement time instead of treating
 * the approval queue as a record-only workflow.
 */
export const AUDIT_EXPORT_SUBJECT_REF = "audit_export";

export function isApprovalKind(v: string): v is ApprovalKind {
  return (APPROVAL_KINDS as readonly string[]).includes(v);
}

export async function createApprovalRequest(input: {
  organizationId: string;
  kind: ApprovalKind;
  subjectRef: string;
  requestedBy: string;
  notes?: string | null;
}): Promise<ApprovalRequest> {
  const [row] = await db
    .insert(approvalRequests)
    .values({
      organizationId: input.organizationId,
      kind: input.kind,
      subjectRef: input.subjectRef,
      requestedBy: input.requestedBy,
      notes: input.notes ?? null,
    })
    .returning();
  return row;
}

export async function listApprovalRequests(
  organizationId: string,
  status?: ApprovalStatus
): Promise<ApprovalRequest[]> {
  const filters = [eq(approvalRequests.organizationId, organizationId)];
  if (status) filters.push(eq(approvalRequests.status, status));
  return db
    .select()
    .from(approvalRequests)
    .where(and(...filters))
    .orderBy(desc(approvalRequests.createdAt))
    .limit(200);
}

/**
 * Decide a pending request. Atomic + idempotent-safe: the WHERE clause pins
 * status='pending', so a double-decision (race between two approvers) updates
 * zero rows the second time and returns null instead of overwriting the record.
 */
export async function decideApprovalRequest(input: {
  id: string;
  organizationId: string;
  decision: "approved" | "rejected";
  decidedBy: string;
  notes?: string | null;
}): Promise<ApprovalRequest | null> {
  const [row] = await db
    .update(approvalRequests)
    .set({
      status: input.decision,
      decidedBy: input.decidedBy,
      decidedAt: new Date(),
      notes: input.notes ?? null,
    })
    .where(
      and(
        eq(approvalRequests.id, input.id),
        eq(approvalRequests.organizationId, input.organizationId),
        eq(approvalRequests.status, "pending")
      )
    )
    .returning();
  return row ?? null;
}

/**
 * Resolve an approved request that is bound to one concrete governed action.
 * Callers must supply the approval ID they are acting under; an arbitrary
 * approved request from the same organization is never sufficient.
 */
export async function getApprovedApprovalRequest(input: {
  id: string;
  organizationId: string;
  kind: ApprovalKind;
  subjectRef: string;
}): Promise<ApprovalRequest | null> {
  const [row] = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, input.id),
        eq(approvalRequests.organizationId, input.organizationId),
        eq(approvalRequests.kind, input.kind),
        eq(approvalRequests.subjectRef, input.subjectRef),
        eq(approvalRequests.status, "approved")
      )
    )
    .limit(1);
  return row ?? null;
}
