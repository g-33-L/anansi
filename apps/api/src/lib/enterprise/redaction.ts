/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

/*
 * Admin-configurable PII redaction (Phase 7), applied ON TOP of the static
 * secret scrubber (lib/utils/sanitize.ts). Each org row is a pattern (a named
 * detector or a raw regex source) + an action (mask | drop | hash). Rules run
 * after sanitizeText during ingestion, so orgs can enforce PII controls the
 * global scrubber intentionally leaves alone (emails, phone numbers, …).
 */
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { redactionRules, workspaces, type RedactionRule } from "../db/schema.js";
import { sanitizeText } from "../utils/sanitize.js";

export type RedactionAction = "mask" | "drop" | "hash";

// Named detectors: friendlier than raw regex for common PII. Anchored, global.
const NAMED_DETECTORS: Record<string, RegExp> = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  phone: /\+?\d[\d\s().-]{7,}\d/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:\d[ -]*?){13,16}\b/g,
  ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
};

const MAX_RULE_SOURCE = 512;

/** Compile a rule's pattern to a global RegExp, or null if it is unsafe/invalid. */
export function compileRule(pattern: string): RegExp | null {
  const named = NAMED_DETECTORS[pattern.toLowerCase()];
  if (named) return new RegExp(named.source, named.flags);
  if (pattern.length > MAX_RULE_SOURCE) return null;
  try {
    // Force global so replace() hits every occurrence; drop any dangerous flags.
    return new RegExp(pattern, "g");
  } catch {
    return null;
  }
}

export function isRedactionAction(v: string): v is RedactionAction {
  return v === "mask" || v === "drop" || v === "hash";
}

function shortHash(s: string): string {
  return "[#" + crypto.createHash("sha256").update(s).digest("hex").slice(0, 8) + "]";
}

function applyRule(text: string, re: RegExp, action: RedactionAction): string {
  switch (action) {
    case "drop":
      return text.replace(re, "");
    case "hash":
      return text.replace(re, (m) => shortHash(m));
    case "mask":
    default:
      return text.replace(re, "[REDACTED]");
  }
}

/** Apply an in-memory rule set to text (pure — no DB). Invalid rules are skipped. */
export function applyRedactionRules(
  text: string,
  rules: Pick<RedactionRule, "pattern" | "action" | "enabled">[]
): string {
  let out = text;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const re = compileRule(rule.pattern);
    if (!re) continue;
    const action = isRedactionAction(rule.action) ? rule.action : "mask";
    out = applyRule(out, re, action);
  }
  return out;
}

/** Load an org's enabled rules (small set; safe to fetch per ingestion batch). */
export async function getEnabledRules(organizationId: string): Promise<RedactionRule[]> {
  return db
    .select()
    .from(redactionRules)
    .where(and(eq(redactionRules.organizationId, organizationId), eq(redactionRules.enabled, true)));
}

/**
 * Resolve a workspace to its org's enabled redaction rules. The engine ingest path
 * is keyed by workspace, but rules are org-scoped — a workspace rolls up to an org
 * via workspaces.organization_id (Phase 5). Returns [] for an unparented workspace
 * (legacy/self-host with no org), so ingest keeps working unchanged.
 *
 * Fetch this ONCE before a batch loop, then apply per item with applyRedactionRules.
 */
export async function getEnabledRulesForWorkspace(workspaceId: string): Promise<RedactionRule[]> {
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { organizationId: true },
  });
  if (!ws?.organizationId) return [];
  return getEnabledRules(ws.organizationId);
}

/**
 * Full redaction for a workspace-keyed ingest: static secret scrub first, then the
 * owning org's PII rules. Single-shot convenience — for batches, resolve rules once
 * with getEnabledRulesForWorkspace and call applyRedactionRules per item instead.
 */
export async function redactForWorkspace(
  workspaceId: string,
  text: string
): Promise<{ text: string; secretsRedacted: number }> {
  const base = sanitizeText(text);
  const rules = await getEnabledRulesForWorkspace(workspaceId);
  return { text: rules.length ? applyRedactionRules(base.text, rules) : base.text, secretsRedacted: base.redactedCount };
}

/**
 * Full redaction pass for an org: static secret scrub first, then the org's
 * configured PII rules. Returns the cleaned text and how many secrets the static
 * scrubber caught (org-rule hits are not counted — they may be lossy by design).
 */
export async function redactForOrg(
  organizationId: string,
  text: string
): Promise<{ text: string; secretsRedacted: number }> {
  const base = sanitizeText(text);
  const rules = await getEnabledRules(organizationId);
  return { text: applyRedactionRules(base.text, rules), secretsRedacted: base.redactedCount };
}
