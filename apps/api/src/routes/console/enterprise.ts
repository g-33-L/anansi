/*
 * /console/enterprise — admin surface for the edition-gated enterprise layer
 * (Phase 7). Mounted under the authed console group, so every route already has
 * session + CSRF. The whole group is additionally behind requireEnterprise (402
 * unless the active org's edition is 'enterprise'), and each route carries its own
 * requirePermission() check.
 *
 * Groups: SSO config · SCIM tokens · audit log · governance approvals · redaction
 * rules · license. Mutations here write audit_events.
 */
import { Hono, type Context } from "hono";
import { requirePermission, type ConsoleEnv } from "../../lib/auth/console-middleware.js";
import { requireEnterprise, verifyLicense } from "../../lib/enterprise/license.js";
import { recordAuditEvent, listAuditEvents, exportAuditNdjson } from "../../lib/enterprise/audit.js";
import {
  getConnectionByOrg,
  upsertConnection,
  setEnabled,
  deleteConnection,
  publicConnectionView,
  type OidcConfig,
  type SamlConfig,
} from "../../lib/enterprise/sso/connections.js";
import { mintScimToken, listScimTokens, revokeScimToken } from "../../lib/enterprise/scim/tokens.js";
import {
  createApprovalRequest,
  listApprovalRequests,
  decideApprovalRequest,
  getApprovedApprovalRequest,
  isApprovalKind,
  AUDIT_EXPORT_SUBJECT_REF,
  type ApprovalStatus,
} from "../../lib/enterprise/governance.js";
import { db } from "../../lib/db/index.js";
import { and, desc, eq } from "drizzle-orm";
import { organizations, redactionRules, licenses } from "../../lib/db/schema.js";
import { compileRule, isRedactionAction } from "../../lib/enterprise/redaction.js";
import { parseKeysetPagination } from "../../lib/http/pagination.js";

export const enterpriseRoutes = new Hono<ConsoleEnv>();

// The license route is intentionally reachable before enterprise entitlement:
// self-hosted owners need it to install their first verified license. Every
// other enterprise route remains fail-closed behind requireEnterprise.
enterpriseRoutes.use("*", async (c, next) => {
  if (c.req.path === "/console/enterprise/license") {
    await next();
    return;
  }
  return requireEnterprise(c, next);
});

function clientIp(c: Context): string | null {
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

// ── SSO ────────────────────────────────────────────────────────────────────────

enterpriseRoutes.get("/sso", requirePermission("sso:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const conn = await getConnectionByOrg(organization.id);
  return c.json({ connection: conn ? publicConnectionView(conn) : null });
});

enterpriseRoutes.put("/sso", requirePermission("sso:write"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as {
    protocol?: unknown;
    config?: unknown;
    clientSecret?: unknown;
    groupRoleMap?: unknown;
    enabled?: unknown;
  };
  const protocol = body.protocol === "saml" || body.protocol === "oidc" ? body.protocol : null;
  if (!protocol) return c.json({ error: "protocol must be 'saml' or 'oidc'" }, 400);
  if (typeof body.config !== "object" || body.config === null) {
    return c.json({ error: "config object is required" }, 400);
  }
  const conn = await upsertConnection({
    organizationId: organization.id,
    protocol,
    config: body.config as unknown as OidcConfig | SamlConfig,
    clientSecret: typeof body.clientSecret === "string" ? body.clientSecret : null,
    groupRoleMap:
      typeof body.groupRoleMap === "object" && body.groupRoleMap
        ? (body.groupRoleMap as Record<string, string>)
        : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
  });
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: user.id,
    action: "sso.configure",
    targetType: "sso_connection",
    targetId: conn.id,
    metadata: { protocol, enabled: conn.enabled },
    ip: clientIp(c),
  });
  return c.json({ connection: publicConnectionView(conn) });
});

enterpriseRoutes.post("/sso/enable", requirePermission("sso:write"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };
  const enabled = Boolean(body.enabled);
  await setEnabled(organization.id, enabled);
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: user.id,
    action: enabled ? "sso.enable" : "sso.disable",
    targetType: "sso_connection",
    ip: clientIp(c),
  });
  return c.json({ ok: true, enabled });
});

enterpriseRoutes.delete("/sso", requirePermission("sso:write"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const ok = await deleteConnection(organization.id);
  if (ok) {
    await recordAuditEvent({
      organizationId: organization.id,
      actorUserId: user.id,
      action: "sso.delete",
      targetType: "sso_connection",
      ip: clientIp(c),
    });
  }
  return ok ? c.json({ ok: true }) : c.json({ error: "no connection" }, 404);
});

// ── SCIM tokens ──────────────────────────────────────────────────────────────

enterpriseRoutes.get("/scim-tokens", requirePermission("scim:manage"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const tokens = await listScimTokens(organization.id);
  return c.json({
    tokens: tokens.map((t) => ({ id: t.id, name: t.name, lastUsedAt: t.lastUsedAt, createdAt: t.createdAt })),
  });
});

enterpriseRoutes.post("/scim-tokens", requirePermission("scim:manage"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "SCIM";
  const { token, secret } = await mintScimToken(organization.id, name);
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: user.id,
    action: "scim.token.create",
    targetType: "scim_token",
    targetId: token.id,
    ip: clientIp(c),
  });
  // Secret shown exactly once.
  return c.json({ token: { id: token.id, name: token.name, createdAt: token.createdAt }, secret }, 201);
});

enterpriseRoutes.delete("/scim-tokens/:id", requirePermission("scim:manage"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const ok = await revokeScimToken(c.req.param("id")!, organization.id);
  if (ok) {
    await recordAuditEvent({
      organizationId: organization.id,
      actorUserId: user.id,
      action: "scim.token.revoke",
      targetType: "scim_token",
      targetId: c.req.param("id")!,
      ip: clientIp(c),
    });
  }
  return ok ? c.json({ ok: true }) : c.json({ error: "token not found" }, 404);
});

// ── Audit log ────────────────────────────────────────────────────────────────

enterpriseRoutes.get("/audit", requirePermission("audit:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const page = parseKeysetPagination((name) => c.req.query(name));
  if (!page.ok) return c.json({ error: page.error }, 400);
  const rows = await listAuditEvents({
    organizationId: organization.id,
    action: c.req.query("action") || undefined,
    limit: page.value.limit + 1,
    before: page.value.before,
  });
  const hasMore = rows.length > page.value.limit;
  const events = rows.slice(0, page.value.limit);
  return c.json({
    events,
    // A cursor is emitted only when an extra row proves another page exists.
    nextBefore: hasMore ? events[events.length - 1]?.createdAt.toISOString() ?? null : null,
  });
});

enterpriseRoutes.get("/audit/export", requirePermission("audit:export"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const approvalId = c.req.query("approvalId");
  const approval = approvalId
    ? await getApprovedApprovalRequest({
        id: approvalId,
        organizationId: organization.id,
        kind: "data_export",
        subjectRef: AUDIT_EXPORT_SUBJECT_REF,
      })
    : null;
  if (!approval) {
    await recordAuditEvent({
      organizationId: organization.id,
      actorUserId: user.id,
      action: "governance.denied",
      targetType: "audit_export",
      targetId: approvalId ?? null,
      metadata: {
        requiredKind: "data_export",
        requiredSubjectRef: AUDIT_EXPORT_SUBJECT_REF,
        reason: "approved_request_required",
      },
      ip: clientIp(c),
    });
    return c.json(
      {
        error: "approved data_export request required",
        requiredKind: "data_export",
        subjectRef: AUDIT_EXPORT_SUBJECT_REF,
      },
      403
    );
  }
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: user.id,
    action: "audit.export",
    targetType: "approval_request",
    targetId: approval.id,
    metadata: { approvalId: approval.id, kind: approval.kind, subjectRef: approval.subjectRef },
    ip: clientIp(c),
  });
  const stream = exportAuditNdjson(organization.id);
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await stream.next();
      if (done) controller.close();
      else controller.enqueue(new TextEncoder().encode(value));
    },
  });
  return c.body(body, 200, {
    "Content-Type": "application/x-ndjson",
    "Content-Disposition": `attachment; filename="audit-${organization.slug}.ndjson"`,
  });
});

// ── Governance approvals ──────────────────────────────────────────────────────

enterpriseRoutes.get("/approvals", requirePermission("governance:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const status = c.req.query("status") as ApprovalStatus | undefined;
  const requests = await listApprovalRequests(
    organization.id,
    status === "pending" || status === "approved" || status === "rejected" ? status : undefined
  );
  return c.json({ requests });
});

enterpriseRoutes.post("/approvals", requirePermission("governance:read"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; subjectRef?: unknown; notes?: unknown };
  const kind = typeof body.kind === "string" ? body.kind : "";
  const subjectRef = typeof body.subjectRef === "string" ? body.subjectRef.trim() : "";
  if (!isApprovalKind(kind)) return c.json({ error: "invalid approval kind" }, 400);
  if (!subjectRef) return c.json({ error: "subjectRef is required" }, 400);
  const request = await createApprovalRequest({
    organizationId: organization.id,
    kind,
    subjectRef,
    requestedBy: user.id,
    notes: typeof body.notes === "string" ? body.notes : null,
  });
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: user.id,
    action: "governance.request",
    targetType: "approval_request",
    targetId: request.id,
    metadata: { kind, subjectRef },
    ip: clientIp(c),
  });
  return c.json({ request }, 201);
});

enterpriseRoutes.post("/approvals/:id/decision", requirePermission("governance:decide"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { decision?: unknown; notes?: unknown };
  const decision = body.decision === "approved" || body.decision === "rejected" ? body.decision : null;
  if (!decision) return c.json({ error: "decision must be 'approved' or 'rejected'" }, 400);
  const request = await decideApprovalRequest({
    id: c.req.param("id")!,
    organizationId: organization.id,
    decision,
    decidedBy: user.id,
    notes: typeof body.notes === "string" ? body.notes : null,
  });
  if (!request) return c.json({ error: "request not found or already decided" }, 409);
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: user.id,
    action: `governance.${decision}`,
    targetType: "approval_request",
    targetId: request.id,
    ip: clientIp(c),
  });
  return c.json({ request });
});

// ── Redaction rules ────────────────────────────────────────────────────────────

enterpriseRoutes.get("/redaction-rules", requirePermission("redaction:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const rules = await db
    .select()
    .from(redactionRules)
    .where(eq(redactionRules.organizationId, organization.id))
    .orderBy(desc(redactionRules.createdAt));
  return c.json({ rules });
});

enterpriseRoutes.post("/redaction-rules", requirePermission("redaction:write"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { pattern?: unknown; action?: unknown; enabled?: unknown };
  const pattern = typeof body.pattern === "string" ? body.pattern.trim() : "";
  const action = typeof body.action === "string" ? body.action : "mask";
  if (!pattern) return c.json({ error: "pattern is required" }, 400);
  if (!isRedactionAction(action)) return c.json({ error: "action must be mask|drop|hash" }, 400);
  if (!compileRule(pattern)) return c.json({ error: "pattern is not a valid regex or named detector" }, 400);
  const [rule] = await db
    .insert(redactionRules)
    .values({
      organizationId: organization.id,
      pattern,
      action,
      enabled: typeof body.enabled === "boolean" ? body.enabled : true,
    })
    .returning();
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: user.id,
    action: "redaction.create",
    targetType: "redaction_rule",
    targetId: rule.id,
    metadata: { pattern, action },
    ip: clientIp(c),
  });
  return c.json({ rule }, 201);
});

enterpriseRoutes.delete("/redaction-rules/:id", requirePermission("redaction:write"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const rows = await db
    .delete(redactionRules)
    .where(and(eq(redactionRules.id, c.req.param("id")!), eq(redactionRules.organizationId, organization.id)))
    .returning({ id: redactionRules.id });
  if (rows.length) {
    await recordAuditEvent({
      organizationId: organization.id,
      actorUserId: user.id,
      action: "redaction.delete",
      targetType: "redaction_rule",
      targetId: c.req.param("id")!,
      ip: clientIp(c),
    });
  }
  return rows.length ? c.json({ ok: true }) : c.json({ error: "rule not found" }, 404);
});

// ── License ─────────────────────────────────────────────────────────────────────

enterpriseRoutes.get("/license", requirePermission("license:read"), async (c) => {
  const { organization } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const [row] = await db
    .select({
      id: licenses.id,
      edition: licenses.edition,
      seats: licenses.seats,
      expiresAt: licenses.expiresAt,
      createdAt: licenses.createdAt,
    })
    .from(licenses)
    .where(eq(licenses.organizationId, organization.id))
    .orderBy(desc(licenses.createdAt))
    .limit(1);
  return c.json({ edition: organization.edition, license: row ?? null });
});

// Install a signed license: verify the signature/expiry, store it, and set the
// org edition to the licensed value. Fail-closed — an unverifiable token is 400.
enterpriseRoutes.put("/license", requirePermission("license:write"), async (c) => {
  const { organization, user } = c.get("session");
  if (!organization) return c.json({ error: "no active organization" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  const payload = verifyLicense(token);
  if (!payload) return c.json({ error: "license is invalid, expired, or unverifiable" }, 400);
  if (payload.organizationId !== organization.id) {
    return c.json({ error: "license was issued for a different organization" }, 403);
  }
  const [row] = await db
    .insert(licenses)
    .values({
      organizationId: organization.id,
      edition: payload.edition,
      signedPayload: token,
      seats: payload.seats ?? null,
      expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
    })
    .returning();
  await db
    .update(organizations)
    .set({ edition: payload.edition, updatedAt: new Date() })
    .where(eq(organizations.id, organization.id));
  await recordAuditEvent({
    organizationId: organization.id,
    actorUserId: user.id,
    action: "license.install",
    targetType: "license",
    targetId: row.id,
    metadata: { edition: payload.edition, seats: payload.seats },
    ip: clientIp(c),
  });
  return c.json({ ok: true, edition: payload.edition, license: { id: row.id, seats: row.seats, expiresAt: row.expiresAt } });
});
