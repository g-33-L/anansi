/*
 * Append-only audit log (Phase 7). `audit_events` is never updated or deleted —
 * recordAuditEvent inserts, and the only reads are list/export for compliance.
 *
 * Writes are best-effort and MUST NOT break the caller: an audit insert that
 * fails is logged and swallowed, never rethrown into a user-facing mutation.
 * Callers pass the org + actor from their SessionContext.
 */
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { auditEvents, type AuditEvent } from "../db/schema.js";

export type ActorType = "user" | "system" | "scim" | "api_key";

export interface AuditInput {
  organizationId: string;
  action: string; // dotted verb, e.g. "member.invite", "sso.login", "apikey.create"
  actorUserId?: string | null;
  actorType?: ActorType;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Insert one audit event. Never throws — failures are logged and swallowed. */
export async function recordAuditEvent(input: AuditInput): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      organizationId: input.organizationId,
      action: input.action,
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType ?? "user",
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
    });
  } catch (err) {
    console.error(`[audit] failed to record ${input.action} for org ${input.organizationId}:`, err);
  }
}

export interface AuditQuery {
  organizationId: string;
  action?: string;
  limit?: number;
  before?: Date; // keyset pagination on created_at (descending)
}

/** Newest-first page of audit events, optionally filtered by action prefix window. */
export async function listAuditEvents(q: AuditQuery): Promise<AuditEvent[]> {
  // Console handlers fetch one extra row to determine whether a keyset cursor
  // should be emitted. Their public page size remains capped at 500.
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 501);
  const filters = [eq(auditEvents.organizationId, q.organizationId)];
  if (q.action) filters.push(eq(auditEvents.action, q.action));
  if (q.before) filters.push(lt(auditEvents.createdAt, q.before));
  return db
    .select()
    .from(auditEvents)
    .where(and(...filters))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
}

/**
 * Stream the whole org log as NDJSON for compliance export. Batches by keyset so
 * a large log never buffers fully in memory. Returns an async generator of lines.
 */
export async function* exportAuditNdjson(organizationId: string): AsyncGenerator<string> {
  const BATCH = 500;
  let before: Date | undefined;
  for (;;) {
    const rows = await listAuditEvents({ organizationId, limit: BATCH, before });
    if (rows.length === 0) return;
    for (const row of rows) yield JSON.stringify(row) + "\n";
    if (rows.length < BATCH) return;
    before = rows[rows.length - 1].createdAt;
  }
}
