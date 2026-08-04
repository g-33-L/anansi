import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  doublePrecision,
  timestamp,
  jsonb,
  index,
  unique,
  uniqueIndex,
  customType,
} from "drizzle-orm/pg-core";
import type {
  SkillStep,
  SkillGraph,
  SkillPredicate,
  SkillCondition,
  SkillDeadline,
} from "../skill/schema.js";

// pgvector column type — drizzle-orm/pg-core doesn't ship this natively yet.
// config generic ensures callers get type-checked dimensions argument.
const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  fromDriver(value: string | null): number[] {
    if (value === null) return [];
    // pgvector returns "[x,y,z]" — valid JSON array
    return JSON.parse(value) as number[];
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});

export const planTypeEnum = pgEnum("plan_type", [
  "free",
  "pro",
  "scale",
  "enterprise",
  "api",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "trialing",
  "past_due",
  "canceled",
  "incomplete",
]);

export const backfillStatusEnum = pgEnum("backfill_status", [
  "pending",
  "running",
  "complete",
  "failed",
]);

export const sourceTypeEnum = pgEnum("source_type", [
  "message",
  "thread",
  "file_pdf",
  "file_doc",
  "url",
  "api_text",
  "meeting_transcript",
  "notion_page",
  "gdoc",
  "linear_issue",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "complete",
  "failed",
]);

export const connectorProviderEnum = pgEnum("connector_provider", [
  "notion",
  "google_docs",
  "linear",
  "transcript_webhook",
]);

// ─── Developer API (memory platform) ─────────────────────────────────────────

export const developerAccounts = pgTable("developer_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable: API-only developers get an auto-provisioned workspace with no Slack credentials.
  // Slack workspace owners who also use the API have this set.
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  // Outbound webhook: Anansi fires POST here after synthesis completes
  webhookUrl: text("webhook_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Magic-link tokens for developer portal login — one-time use, 15-min TTL.
export const developerAuthTokens = pgTable("developer_auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  developerId: uuid("developer_id")
    .notNull()
    .references(() => developerAccounts.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const developerApiKeys = pgTable("developer_api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  developerId: uuid("developer_id")
    .notNull()
    .references(() => developerAccounts.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull().unique(),
  name: text("name").notNull().default("Default"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const memoryUsers = pgTable(
  "memory_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    developerId: uuid("developer_id")
      .notNull()
      .references(() => developerAccounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    // Privacy opt-out (Slack-native per-person memory): when true, no personal
    // profile is built for this user and new messages aren't attributed to them.
    // Their messages remain in the team profile.
    optedOut: boolean("opted_out").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    developerExternalIdUnique: unique("memory_users_developer_external_id_unique").on(
      table.developerId,
      table.externalId
    ),
  })
);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Null for API-only workspaces (auto-provisioned on developer signup, no Slack connection).
  slackTeamId: text("slack_team_id").unique(),
  // Stored as AES-256-GCM ciphertext — encrypt/decrypt via lib/crypto.ts
  slackBotToken: text("slack_bot_token"),
  slackTeamName: text("slack_team_name"),
  // Re-parent under the product identity layer (Phase 5, migration 0021). Nullable +
  // backfilled from developer_accounts; the engine still isolates by workspace_id —
  // organizations are the account boundary ABOVE the workspace, not a replacement.
  // Forward ref (organizations is declared below) is fine: Drizzle references are thunks.
  organizationId: uuid("organization_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    slackChannelId: text("slack_channel_id").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    backfillStatus: backfillStatusEnum("backfill_status")
      .notNull()
      .default("pending"),
    backfilledThroughTs: text("backfilled_through_ts"), // Slack timestamp, resumable backfill cursor
  },
  (table) => ({
    // Deduplication: one row per Slack channel per workspace
    workspaceSlackChannelUnique: unique("channels_workspace_slack_channel_unique").on(
      table.workspaceId,
      table.slackChannelId
    ),
  })
);

export const memoryChunks = pgTable(
  "memory_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .references(() => channels.id, { onDelete: "cascade" }),
    memoryUserId: uuid("memory_user_id")
      .references(() => memoryUsers.id, { onDelete: "cascade" }),
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 768 }),
    metadata: jsonb("metadata").$type<{
      author: string;
      authorId: string;
      timestamp: string;
      channelName: string;
      threadTs?: string;
      title?: string;
    }>(),
    // Team (workspace-level) synthesis tracking.
    synthesized: boolean("synthesized").notNull().default(false),
    // Per-user synthesis tracking — independent of `synthesized` so one chunk can
    // feed BOTH the team profile and the author's personal profile (Slack-native
    // memory). NULL memoryUserId chunks never need user synthesis.
    userSynthesized: boolean("user_synthesized").notNull().default(false),
    // Null = never expires. Set from the optional `ttl` field on POST /v1/ingest.
    // Expired chunks are excluded from search and synthesis (rows are kept until cleanup).
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    // Deduplication: one chunk per source event per workspace
    workspaceSourceUnique: unique("memory_chunks_workspace_source_unique").on(
      table.workspaceId,
      table.sourceId
    ),
    // Composite index for synthesis queries: "count unsynthesized per workspace"
    workspaceSynthesizedIdx: index("memory_chunks_workspace_synthesized_idx").on(
      table.workspaceId,
      table.synthesized
    ),
    // Per-user synthesis scan: "oldest unsynthesized chunks for this memory user"
    memoryUserSynthesizedIdx: index("memory_chunks_memory_user_synthesized_idx").on(
      table.memoryUserId,
      table.userSynthesized
    ),
    // HNSW vector index — created via raw SQL in post-migration.ts (drizzle-kit doesn't support it natively)
  })
);

// Time-bounded fact extracted during synthesis, e.g.
// { fact: "Works at Stripe", validFrom: "2024-01", validUntil: null }
export interface TemporalFact {
  fact: string;
  validFrom?: string | null;
  validUntil?: string | null;
}

export const staticDocuments = pgTable("static_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Workspace-scoped doc: workspaceId set, memoryUserId null
  workspaceId: uuid("workspace_id")
    .references(() => workspaces.id, { onDelete: "cascade" })
    .unique(),
  // User-scoped doc: memoryUserId set, workspaceId null
  memoryUserId: uuid("memory_user_id")
    .references(() => memoryUsers.id, { onDelete: "cascade" })
    .unique(),
  staticFacts: jsonb("static_facts").$type<string[]>().notNull().default([]),
  dynamicContext: jsonb("dynamic_context")
    .$type<string[]>()
    .notNull()
    .default([]),
  temporalFacts: jsonb("temporal_facts").$type<TemporalFact[]>().notNull().default([]),
  version: integer("version").notNull().default(0),
  chunksSynthesizedCount: integer("chunks_synthesized_count")
    .notNull()
    .default(0),
  lastSynthesizedAt: timestamp("last_synthesized_at"),
});

// ─── Entity graph (knowledge graph + temporal relationships) ──────────────────
// Nodes are people/orgs/tech/projects extracted by the synthesis worker;
// edges carry bi-temporal validity — valid_until null means currently active.

export const entityNodes = pgTable(
  "entity_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    developerId: uuid("developer_id")
      .notNull()
      .references(() => developerAccounts.id, { onDelete: "cascade" }),
    memoryUserId: uuid("memory_user_id").references(() => memoryUsers.id, {
      onDelete: "cascade",
    }),
    entityType: text("entity_type").notNull(), // "person" | "org" | "tech" | "project" | "location"
    name: text("name").notNull(),
    canonicalName: text("canonical_name"), // normalized form (e.g. "stripe" for "Stripe, Inc.")
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (table) => ({
    developerUserTypeNameUnique: unique("entity_nodes_developer_user_type_name_unique").on(
      table.developerId,
      table.memoryUserId,
      table.entityType,
      table.name
    ),
    developerUserIdx: index("entity_nodes_developer_user_idx").on(
      table.developerId,
      table.memoryUserId
    ),
  })
);

export const entityEdges = pgTable(
  "entity_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromEntityId: uuid("from_entity_id")
      .notNull()
      .references(() => entityNodes.id, { onDelete: "cascade" }),
    toEntityId: uuid("to_entity_id")
      .notNull()
      .references(() => entityNodes.id, { onDelete: "cascade" }),
    relationship: text("relationship").notNull(), // "works_at" | "uses" | "knows" | "member_of" | ...
    // Valid-time axis: when the relationship held in the real world.
    validFrom: timestamp("valid_from").notNull().defaultNow(),
    validUntil: timestamp("valid_until"), // null = currently active
    // Transaction-time (knowledge-time) axis: when we learned each boundary.
    // recordedAt is immutable; validUntilRecordedAt is set together with validUntil
    // when an edge is closed (null while the edge is still believed open).
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    validUntilRecordedAt: timestamp("valid_until_recorded_at"),
    sourceChunkId: uuid("source_chunk_id").references(() => memoryChunks.id, {
      onDelete: "set null",
    }),
    confidence: doublePrecision("confidence").notNull().default(1.0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => ({
    fromIdx: index("entity_edges_from_idx").on(table.fromEntityId),
    toIdx: index("entity_edges_to_idx").on(table.toEntityId),
    recordedAtIdx: index("entity_edges_recorded_at_idx").on(table.recordedAt),
    // At most one ACTIVE edge of a given (from, to, relationship). Closed edges
    // (valid_until set) are exempt so history is preserved; only the currently
    // active edge is unique. Makes edge inserts race-safe via ON CONFLICT DO NOTHING.
    activeUnique: uniqueIndex("entity_edges_active_unique")
      .on(table.fromEntityId, table.toEntityId, table.relationship)
      .where(sql`${table.validUntil} IS NULL`),
  })
);

// ─── Attestations (append-only bi-temporal ledger primitive) ──────────────────
// An attestation is an evidence-backed claim about how the organization operates.
// Both time axes mirror entity_edges: valid-time (validFrom/validUntil) records
// when the claim held in the real world; knowledge-time (recordedAt/
// validUntilRecordedAt) records when we learned each boundary. Unlike entity_edges
// (relational claims), attestations carry propositional/role/policy claims.
// Append-only: claims are closed (validUntil set), never deleted.
//
// Trust defaults are deliberately conservative — the ledger must never invent
// certainty: confidence defaults to 0 (not 1.0), status to "candidate" (never
// auto-published), inferenceStatus to "inferred" (least trusted). validFrom is
// nullable (null = start unknown); readers floor the lower bound at recordedAt so
// the ledger never implies a truth predated its evidence.

// One piece of evidence backing an attestation — a verbatim quote located in a
// specific source chunk. chunkId is not a DB-level FK (inline JSONB); write-time
// verification (PR-2) guarantees the quote actually appears in the referenced chunk.
export interface AttestationEvidence {
  chunkId: string;
  quote: string;
  source?: string;
  sourceType?: string; // the chunk's source_type — the robust "documented vs observed" signal
  author?: string;
  eventTime?: string;
}

export const attestations = pgTable(
  "attestations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    developerId: uuid("developer_id")
      .notNull()
      .references(() => developerAccounts.id, { onDelete: "cascade" }),
    memoryUserId: uuid("memory_user_id").references(() => memoryUsers.id, {
      onDelete: "cascade",
    }), // null = workspace-level claim
    claim: text("claim").notNull(),
    // Content identity for the active-unique dedup index. Populated by the writer
    // (PR-2): identical active claims collapse, competing claims coexist.
    claimFingerprint: text("claim_fingerprint").notNull(),
    // Groups competing / superseding claims (the "question" a dispute is about).
    claimKey: text("claim_key"),
    claimType: text("claim_type").notNull().default("propositional"), // propositional | role | policy
    subjectEntityId: uuid("subject_entity_id").references(() => entityNodes.id, {
      onDelete: "set null",
    }), // optional link into the entity graph — SET NULL preserves the historical claim
    domain: text("domain"), // groups attestations into views, e.g. "incident_response"
    polarity: text("polarity").notNull().default("assertion"), // assertion | negation
    inferenceStatus: text("inference_status").notNull().default("inferred"), // stated | corroborated | inferred
    status: text("status").notNull().default("candidate"), // observed | candidate | disputed
    confidence: doublePrecision("confidence").notNull().default(0), // never defaults to certainty
    confidenceBreakdown: jsonb("confidence_breakdown")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    // Valid-time axis: when the claim held in the real world. Null validFrom =
    // start unknown (readers floor at recordedAt). Null validUntil = still true.
    validFrom: timestamp("valid_from"),
    validFromBasis: text("valid_from_basis").notNull().default("unknown"), // stated | knowledge_derived | unknown
    validFromGranularity: text("valid_from_granularity").notNull().default("unknown"),
    validUntil: timestamp("valid_until"),
    validUntilBasis: text("valid_until_basis"),
    // Knowledge-time axis (mirrors entity_edges): recordedAt is immutable;
    // validUntilRecordedAt is set together with validUntil when a claim is closed.
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    validUntilRecordedAt: timestamp("valid_until_recorded_at"),
    evidence: jsonb("evidence").$type<AttestationEvidence[]>().notNull().default([]),
    // Self-referential correction chain. The DB-level FK is created in the migration
    // (0019); left off the Drizzle column to avoid a self-reference type cycle.
    supersedes: uuid("supersedes"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    workspaceStatusIdx: index("attestations_workspace_status_idx").on(
      table.workspaceId,
      table.status
    ),
    workspaceDomainIdx: index("attestations_workspace_domain_idx").on(
      table.workspaceId,
      table.domain
    ),
    validFromIdx: index("attestations_valid_from_idx").on(table.workspaceId, table.validFrom),
    recordedAtIdx: index("attestations_recorded_at_idx").on(table.recordedAt),
    claimKeyIdx: index("attestations_claim_key_idx").on(table.workspaceId, table.claimKey),
    subjectIdx: index("attestations_subject_idx").on(table.subjectEntityId),
    // At most one ACTIVE attestation of a given (workspace, claim_fingerprint).
    // Closed claims (validUntil set) are exempt so history is preserved; only the
    // currently-active claim is unique. Makes inserts race-safe via ON CONFLICT
    // DO NOTHING. Competing claims with distinct fingerprints coexist (disputes).
    activeUnique: uniqueIndex("attestations_active_unique")
      .on(table.workspaceId, table.claimFingerprint)
      .where(sql`${table.validUntil} IS NULL`),
  })
);

export type Attestation = typeof attestations.$inferSelect;
export type NewAttestation = typeof attestations.$inferInsert;

export const synthesisJobs = pgTable("synthesis_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  status: jobStatusEnum("status").notNull().default("pending"),
  chunksProcessed: integer("chunks_processed").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Billing ──────────────────────────────────────────────────────────────────

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" })
    .unique(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: planTypeEnum("plan").notNull().default("free"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  currentPeriodEnd: timestamp("current_period_end"), // written from the SubscriptionItem (Stripe v22+ moved it off Subscription); null when an event omits it
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Usage tracking ───────────────────────────────────────────────────────────

export const usageStats = pgTable(
  "usage_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    memoryUserId: uuid("memory_user_id")
      .references(() => memoryUsers.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // "YYYY-MM"
    queriesCount: integer("queries_count").notNull().default(0),
    messagesCount: integer("messages_count").notNull().default(0),
    ingestCallsCount: integer("ingest_calls_count").notNull().default(0),
    contextCallsCount: integer("context_calls_count").notNull().default(0),
  },
  (table) => ({
    workspaceMonthUnique: unique("usage_stats_workspace_month_unique").on(
      table.workspaceId,
      table.month
    ),
  })
);

// ─── Connector tokens (OAuth integrations: Notion, Google Docs, Linear) ──────

export const connectorTokens = pgTable(
  "connector_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: connectorProviderEnum("provider").notNull(),
    accessToken: text("access_token").notNull(), // AES-256-GCM encrypted
    refreshToken: text("refresh_token"), // encrypted, nullable
    expiresAt: timestamp("expires_at"),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    workspaceProviderUnique: unique("connector_tokens_workspace_provider_unique").on(
      table.workspaceId,
      table.provider
    ),
  })
);

// ─── Dashboard auth (magic link tokens) ──────────────────────────────────────

export const dashboardTokens = pgTable("dashboard_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 of raw token
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"), // null = unused; set on first use (single-use)
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Skills (extracted enterprise procedures — governance envelope) ─────────
// Mirrors apps/api/src/lib/skill/schema.ts (SkillDefinition / SkillStep / etc).
// Three tables carry the extract → draft → human review → publish lifecycle:
//   skill_definitions — one stable row per skill identity (id survives every
//     revision); tracks which version is currently live.
//   skill_drafts      — mutable staging area for extraction output awaiting
//     human review. Never served to agents. At most one open draft (status
//     'draft' or 'in_review') per skill — see the partial unique index below.
//   skill_versions    — immutable, append-only history. A row is created only
//     when a draft is approved; published/archived rows are never edited.
// process_nodes / process_edges are a relational projection of one version's
// step graph (steps.jsonb decomposed to rows) so cross-skill graph queries
// ("every step owned by Security across all published skills") don't require
// scanning and parsing every skill_versions.steps blob.
//
// TENANT ISOLATION — constraints live in SQL, not in this file.
// Every table below carries workspace_id next to a parent ID, and the
// single-column .references() calls here only prove the parent EXISTS, not that
// it belongs to the same workspace. Migration 0024_skill_workspace_integrity
// closes that gap with composite (id, workspace_id) uniques and composite
// foreign keys, so the database rejects a draft/version/node/edge that points at
// another tenant's row.
//
// Those composite keys are deliberately NOT modelled here. skill_drafts and
// skill_versions reference each other (source_draft_id / promoted_to_version_id),
// and expressing that cycle in Drizzle needs explicit AnyPgColumn annotations
// that TypeScript resolves poorly. Modelling only the acyclic half would be worse
// than modelling none: it would read as the complete picture. Snapshot generation
// was abandoned at 0003 (see meta/) and migrations are hand-written, so nothing
// regenerates DDL from this file and the omission cannot drift into a dropped
// constraint. src/test/skill-workspace-integrity.test.ts is what holds the
// guarantee — it asserts the composite keys against a live database.

export const skillDefinitions = pgTable(
  "skill_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    // Denormalized head status — mirrors the latest skill_versions row once
    // published, or 'draft'/'archived' when no version has ever gone live.
    status: text("status").notNull().default("draft"),
    // Version string of the currently-live published row in skill_versions,
    // null until the first publish. Not a DB-level FK: skill_versions rows are
    // identified by (skill_id, version), and a plain string avoids a circular
    // FK between the two tables (skill_versions.skill_id already references back here).
    currentVersion: text("current_version"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    workspaceStatusIdx: index("skill_definitions_workspace_status_idx").on(
      table.workspaceId,
      table.status
    ),
    workspaceDomainIdx: index("skill_definitions_workspace_domain_idx").on(
      table.workspaceId,
      table.domain
    ),
  })
);

export type SkillDefinitionRow = typeof skillDefinitions.$inferSelect;
export type NewSkillDefinitionRow = typeof skillDefinitions.$inferInsert;

export const skillDrafts = pgTable(
  "skill_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skillDefinitions.id, { onDelete: "cascade" }),
    // draft: fresh extraction output, not yet looked at.
    // in_review: a reviewer has started but not decided.
    // approved: promoted into a skill_versions row (see promotedToVersionId).
    // rejected: reviewer declined; kept for audit, never promoted.
    status: text("status").notNull().default("draft"),
    steps: jsonb("steps").$type<SkillStep[]>().notNull().default([]),
    graph: jsonb("graph").$type<SkillGraph>(),
    // Chunk/document IDs the extraction worker cited. Inline JSONB rather than
    // a DB-level FK — mirrors attestations.evidence; the extraction pipeline's
    // source IDs are not guaranteed to already be persisted memory_chunks rows.
    sourceDocumentIds: jsonb("source_document_ids").$type<string[]>().notNull().default([]),
    extractedAt: timestamp("extracted_at").notNull().defaultNow(),
    confidenceScore: doublePrecision("confidence_score"),
    reviewerNotes: text("reviewer_notes"),
    reviewedBy: uuid("reviewed_by").references(() => developerAccounts.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at"),
    // Set when this draft is approved and promoted. SET NULL (not cascade) so
    // deleting the resulting version never silently deletes draft history.
    promotedToVersionId: uuid("promoted_to_version_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    skillStatusIdx: index("skill_drafts_skill_status_idx").on(table.skillId, table.status),
    workspaceStatusIdx: index("skill_drafts_workspace_status_idx").on(
      table.workspaceId,
      table.status
    ),
    // At most one OPEN draft (awaiting a decision) per skill. Approved/rejected
    // drafts are exempt so history accumulates freely; this only blocks two
    // simultaneously-pending drafts racing for the same skill.
    openDraftUnique: uniqueIndex("skill_drafts_open_unique")
      .on(table.skillId)
      .where(sql`${table.status} IN ('draft', 'in_review')`),
  })
);

export type SkillDraft = typeof skillDrafts.$inferSelect;
export type NewSkillDraft = typeof skillDrafts.$inferInsert;

export const skillVersions = pgTable(
  "skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skillDefinitions.id, { onDelete: "cascade" }),
    version: text("version").notNull(), // semver, e.g. "1.0.0"
    status: text("status").notNull().default("published"), // published | archived
    steps: jsonb("steps").$type<SkillStep[]>().notNull().default([]),
    graph: jsonb("graph").$type<SkillGraph>(),
    sourceDocumentIds: jsonb("source_document_ids").$type<string[]>().notNull().default([]),
    extractedAt: timestamp("extracted_at").notNull(),
    publishedAt: timestamp("published_at").notNull().defaultNow(),
    reviewedBy: uuid("reviewed_by").references(() => developerAccounts.id, {
      onDelete: "set null",
    }),
    confidenceScore: doublePrecision("confidence_score"),
    changeSummary: text("change_summary"),
    // Traces back to the approved draft this version was promoted from. SET
    // NULL rather than cascade: the published version is the durable artifact
    // and must survive draft-history cleanup.
    sourceDraftId: uuid("source_draft_id").references(() => skillDrafts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    skillVersionUnique: unique("skill_versions_skill_version_unique").on(
      table.skillId,
      table.version
    ),
    skillStatusIdx: index("skill_versions_skill_status_idx").on(table.skillId, table.status),
    workspaceStatusIdx: index("skill_versions_workspace_status_idx").on(
      table.workspaceId,
      table.status
    ),
  })
);

export type SkillVersionRow = typeof skillVersions.$inferSelect;
export type NewSkillVersionRow = typeof skillVersions.$inferInsert;

// ─── Process graph (relational projection of one skill_versions row) ────────

export const processNodes = pgTable(
  "process_nodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    // SkillStep.id — stable snake_case identifier, unique within its version,
    // NOT a UUID (preserved verbatim from extraction for cross-version diffing).
    stepId: text("step_id").notNull(),
    description: text("description").notNull(),
    ownerRole: text("owner_role"),
    preconditions: jsonb("preconditions").$type<SkillPredicate[]>().notNull().default([]),
    conditions: jsonb("conditions").$type<SkillCondition[]>().notNull().default([]),
    deadline: jsonb("deadline").$type<SkillDeadline>(),
    parallelGroup: text("parallel_group"),
    parallelSemantics: text("parallel_semantics"), // 'unordered' | 'required_concurrent'
    evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    versionStepUnique: unique("process_nodes_version_step_unique").on(
      table.skillVersionId,
      table.stepId
    ),
    versionIdx: index("process_nodes_version_idx").on(table.skillVersionId),
    // Cross-skill role queries: "every step Security owns across all published skills".
    workspaceRoleIdx: index("process_nodes_workspace_role_idx").on(
      table.workspaceId,
      table.ownerRole
    ),
  })
);

export type ProcessNode = typeof processNodes.$inferSelect;
export type NewProcessNode = typeof processNodes.$inferInsert;

export const processEdges = pgTable(
  "process_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    skillVersionId: uuid("skill_version_id")
      .notNull()
      .references(() => skillVersions.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => processNodes.id, { onDelete: "cascade" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => processNodes.id, { onDelete: "cascade" }),
    // Only 'precedes' today; a text column (not an enum) so a future edge type
    // (e.g. a materialized gate relation) doesn't require an ALTER TYPE.
    relation: text("relation").notNull().default("precedes"),
    evidence: jsonb("evidence").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    edgeUnique: unique("process_edges_from_to_relation_unique").on(
      table.fromNodeId,
      table.toNodeId,
      table.relation
    ),
    versionIdx: index("process_edges_version_idx").on(table.skillVersionId),
    fromIdx: index("process_edges_from_idx").on(table.fromNodeId),
    toIdx: index("process_edges_to_idx").on(table.toNodeId),
  })
);

export type ProcessEdge = typeof processEdges.$inferSelect;
export type NewProcessEdge = typeof processEdges.$inferInsert;

// ─── Identity & access (Phase 5: orgs, users, memberships, teams, sessions) ──
// The product identity layer. `developer_accounts` remains the per-workspace API
// tenant; these tables add real auth principals (`users`), the account boundary
// (`organizations`), RBAC (`memberships.role` — see lib/identity/roles.ts), and a
// self-hostable session layer (`user_sessions` + magic-link `user_auth_tokens`)
// that does NOT depend on Supabase. Role/status/edition/scope value sets are
// enforced by CHECK constraints in migration 0021 (kept as plain text columns so
// adding a value is an idempotent migration, not an ALTER TYPE).

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  // community | self_hosted | cloud | enterprise — gates edition features.
  edition: text("edition").notNull().default("cloud"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  status: text("status").notNull().default("active"), // active | suspended | deprovisioned
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// user × org × role — the RBAC join and the org-membership boundary.
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner|admin|member|billing|auditor|viewer
    status: text("status").notNull().default("active"), // active | suspended
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userOrgUnique: unique("memberships_user_org_unique").on(table.userId, table.organizationId),
    orgIdx: index("memberships_org_idx").on(table.organizationId),
    userIdx: index("memberships_user_idx").on(table.userId),
  })
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orgNameUnique: unique("teams_org_name_unique").on(table.organizationId, table.name),
  })
);

export const teamMemberships = pgTable(
  "team_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    teamMembershipUnique: unique("team_memberships_team_membership_unique").on(
      table.teamId,
      table.membershipId
    ),
  })
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"),
    tokenHash: text("token_hash").notNull().unique(), // SHA-256 of the raw invite token
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("invitations_org_idx").on(table.organizationId),
    // At most one PENDING invite per (org, email); accepted ones are exempt so
    // history accumulates. Partial unique index added in migration 0021.
  })
);

// Session-authenticated principal sessions for the /console product app (distinct
// from bearer ans_ keys). The cookie carries a random token; only its SHA-256 hash
// is stored. activeOrganizationId scopes the session to one org context.
export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at").notNull(),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("user_sessions_user_idx").on(table.userId),
  })
);

// Magic-link login tokens (mirrors developer_auth_tokens). Email-keyed so a token
// can bootstrap a brand-new user on first verify. Self-hostable (no Supabase).
export const userAuthTokens = pgTable("user_auth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Scopes on developer API keys (RBAC for the public /v1 surface). NO scope rows for
// a key = full access (back-compat: pre-scope keys keep working).
export const apiKeyScopes = pgTable(
  "api_key_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => developerApiKeys.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(), // ingest | read | admin | entities | ledger
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    keyScopeUnique: unique("api_key_scopes_key_scope_unique").on(table.apiKeyId, table.scope),
  })
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMembership = typeof teamMemberships.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
export type UserAuthToken = typeof userAuthTokens.$inferSelect;
export type ApiKeyScope = typeof apiKeyScopes.$inferSelect;

// ─── Enterprise (Phase 7: SSO, SCIM, audit, governance, redaction, licensing) ─
// Edition-gated tables that hang off `organizations`. All additive (migration
// 0022). Secrets (SSO client secret, SAML certs, SCIM tokens) are AES-256-GCM or
// HMAC at rest, reusing lib/utils/crypto.ts + lib/auth/api-auth.ts conventions.
// Value sets (protocol, actor_type, status, action) are plain text + CHECK so
// adding a value stays an idempotent migration, not an ALTER TYPE.

// One SSO connection per org (SAML or OIDC). `config` holds the non-secret IdP
// wiring (issuer, endpoints, certs, client_id); `secret` is the encrypted client
// secret (OIDC) — null for SAML. group_role_map maps an IdP group → membership role.
export const ssoConnections = pgTable("sso_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: "cascade" }),
  protocol: text("protocol").notNull(), // saml | oidc
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  secret: text("secret"), // AES-GCM(client_secret) for OIDC; null for SAML
  groupRoleMap: jsonb("group_role_map").$type<Record<string, string>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// SCIM 2.0 bearer tokens (HMAC-hashed, mirrors developer_api_keys). Presented by
// the IdP's SCIM client to provision users/groups into this org.
export const scimTokens = pgTable(
  "scim_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("SCIM"),
    tokenHash: text("token_hash").notNull().unique(),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("scim_tokens_org_idx").on(table.organizationId),
  })
);

// Append-only audit log. Never updated or hard-deleted (invariant, ENTITY_MODEL §5).
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorType: text("actor_type").notNull().default("user"), // user | system | scim | api_key
    action: text("action").notNull(), // e.g. member.invite, sso.login, apikey.create
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orgCreatedIdx: index("audit_events_org_created_idx").on(table.organizationId, table.createdAt),
  })
);

// Generic governance approval queue (skill publishes, role grants, data exports…).
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // skill_publish | role_grant | data_export | ...
    subjectRef: text("subject_ref").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orgStatusIdx: index("approval_requests_org_status_idx").on(table.organizationId, table.status),
  })
);

// Admin-configurable PII redaction rules atop the static sanitize.ts detectors.
export const redactionRules = pgTable(
  "redaction_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(), // regex source or named detector
    action: text("action").notNull().default("mask"), // mask | drop | hash
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("redaction_rules_org_idx").on(table.organizationId),
  })
);

// Signed self-host/enterprise license records (verified w/ lib/enterprise/license.ts).
export const licenses = pgTable(
  "licenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    edition: text("edition").notNull(),
    signedPayload: text("signed_payload").notNull(),
    seats: integer("seats"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("licenses_org_idx").on(table.organizationId),
  })
);

export type SsoConnection = typeof ssoConnections.$inferSelect;
export type NewSsoConnection = typeof ssoConnections.$inferInsert;
export type ScimToken = typeof scimTokens.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type ApprovalRequest = typeof approvalRequests.$inferSelect;
export type NewApprovalRequest = typeof approvalRequests.$inferInsert;
export type RedactionRule = typeof redactionRules.$inferSelect;
export type NewRedactionRule = typeof redactionRules.$inferInsert;
export type License = typeof licenses.$inferSelect;
export type NewLicense = typeof licenses.$inferInsert;

// ─── Internal operations plane (Phase 8) ──────────────────────────────────────
// The managed-cloud operator surface. All additive (migration 0023). Deliberately
// SEPARATE from customer-facing tables: `operator_audit_events` is a distinct
// audit stream from the customer `audit_events` (different actors, retention, and
// access — ADR-0006), so staff activity never dilutes customer audit visibility.
// Staff identity is env-sourced (STAFF_EMAILS) and never a customer role (ADR-0004).

// Append-only platform-operator audit. actor is a staff `users` row; target is any
// resource (org, job, connector, session…). Metadata is redacted + identifier-only:
// NEVER raw customer content, secrets, or tokens (ADR-0005/0006).
export const operatorAuditEvents = pgTable(
  "operator_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: text("actor_email").notNull(), // denormalized so the record survives user deletion
    action: text("action").notNull(), // e.g. ops.customer.view, ops.flag.set, ops.job.retry
    // The organization the action concerned, when applicable (cross-tenant lookups).
    targetOrganizationId: uuid("target_organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    targetType: text("target_type"),
    targetId: text("target_id"),
    reason: text("reason"), // operator-supplied justification (required for content/mutation actions)
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    correlationId: text("correlation_id"),
    ip: text("ip"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    actorIdx: index("operator_audit_actor_idx").on(table.actorUserId, table.createdAt),
    targetOrgIdx: index("operator_audit_target_org_idx").on(table.targetOrganizationId, table.createdAt),
  })
);

// Server-evaluated feature flags (ADR-0007). default-deny: code can only read a
// DECLARED flag (a row here), and evaluation returns `defaultValue` unless an
// explicit rule matches. Every flag carries an owner + expiry to prevent permanent
// hidden behavior. Scope: global (all orgs) or org (a single organization).
export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(), // dotted, e.g. "ops.new_search_ranker"
    description: text("description").notNull().default(""),
    scope: text("scope").notNull().default("global"), // global | org
    // Non-null only for scope='org' — the org this override applies to.
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    owner: text("owner").notNull(), // accountable staff email
    reference: text("reference"), // ticket / ADR link
    expiresAt: timestamp("expires_at"), // after this, the flag reads its default (stale-flag guard)
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // At most one row per (key, scope-target). A global flag has NULL org; a per-org
    // override is unique per (key, org). Enforced by two partial unique indexes in 0023.
    keyIdx: index("feature_flags_key_idx").on(table.key),
  })
);

// Operator announcements targeted by edition/org, with a scheduled lifecycle.
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    level: text("level").notNull().default("info"), // info | warning | critical
    // Targeting: empty audience = everyone. editions[] and organizationIds[] are OR'd.
    audience: jsonb("audience").$type<{ editions?: string[]; organizationIds?: string[] }>()
      .notNull()
      .default({}),
    status: text("status").notNull().default("draft"), // draft | scheduled | published | withdrawn
    startsAt: timestamp("starts_at"),
    endsAt: timestamp("ends_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("announcements_status_idx").on(table.status),
  })
);

export type OperatorAuditEvent = typeof operatorAuditEvents.$inferSelect;
export type NewOperatorAuditEvent = typeof operatorAuditEvents.$inferInsert;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
