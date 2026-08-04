-- Skill lifecycle: extract -> draft -> human review -> publish.
--
-- skill_definitions is the stable identity row (id survives every revision);
-- it tracks which version is currently live via current_version, a plain
-- string rather than a DB-level FK to skill_versions (skill_versions.skill_id
-- already references back to skill_definitions, so a forward FK here would be
-- circular).
--
-- skill_drafts is the mutable staging area for extraction output awaiting
-- human review. Never served to agents. At most one OPEN draft (status
-- 'draft' or 'in_review') per skill is enforced by a partial unique index —
-- approved/rejected drafts are exempt so history accumulates freely.
--
-- skill_versions is immutable and append-only: a row is created only when a
-- draft is approved; published/archived rows are never edited in place.
--
-- process_nodes / process_edges are a relational projection of one
-- skill_versions row's step graph (its steps/graph JSONB decomposed to rows)
-- so cross-skill graph queries ("every step Security owns across all
-- published skills") don't require scanning and parsing every JSONB blob.

CREATE TABLE IF NOT EXISTS "skill_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "domain" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'draft',
  "current_version" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "skill_definitions_status_check" CHECK ("status" IN ('draft', 'review', 'published', 'archived'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_definitions_workspace_status_idx" ON "skill_definitions" ("workspace_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_definitions_workspace_domain_idx" ON "skill_definitions" ("workspace_id", "domain");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "skill_id" uuid NOT NULL REFERENCES "skill_definitions"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'draft',
  "steps" jsonb NOT NULL DEFAULT '[]',
  "graph" jsonb,
  "source_document_ids" jsonb NOT NULL DEFAULT '[]',
  "extracted_at" timestamp NOT NULL DEFAULT now(),
  "confidence_score" double precision,
  "reviewer_notes" text,
  "reviewed_by" uuid REFERENCES "developer_accounts"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp,
  -- Set once this draft is approved and promoted; FK to skill_versions is
  -- added after that table exists (see ALTER below) to avoid a forward
  -- reference in this CREATE TABLE.
  "promoted_to_version_id" uuid,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "skill_drafts_status_check" CHECK ("status" IN ('draft', 'in_review', 'approved', 'rejected')),
  CONSTRAINT "skill_drafts_confidence_range_check" CHECK ("confidence_score" IS NULL OR ("confidence_score" >= 0 AND "confidence_score" <= 1))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_drafts_skill_status_idx" ON "skill_drafts" ("skill_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_drafts_workspace_status_idx" ON "skill_drafts" ("workspace_id", "status");
--> statement-breakpoint
-- At most one OPEN draft (awaiting a decision) per skill. Approved/rejected
-- drafts are exempt so history accumulates freely; this only blocks two
-- simultaneously-pending drafts racing for the same skill.
CREATE UNIQUE INDEX IF NOT EXISTS "skill_drafts_open_unique"
  ON "skill_drafts" ("skill_id")
  WHERE "status" IN ('draft', 'in_review');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "skill_id" uuid NOT NULL REFERENCES "skill_definitions"("id") ON DELETE CASCADE,
  "version" text NOT NULL,
  "status" text NOT NULL DEFAULT 'published',
  "steps" jsonb NOT NULL DEFAULT '[]',
  "graph" jsonb,
  "source_document_ids" jsonb NOT NULL DEFAULT '[]',
  "extracted_at" timestamp NOT NULL,
  "published_at" timestamp NOT NULL DEFAULT now(),
  "reviewed_by" uuid REFERENCES "developer_accounts"("id") ON DELETE SET NULL,
  "confidence_score" double precision,
  "change_summary" text,
  -- Traces back to the approved draft this version was promoted from. SET
  -- NULL rather than CASCADE: the published version is the durable artifact
  -- and must survive draft-history cleanup.
  "source_draft_id" uuid REFERENCES "skill_drafts"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "skill_versions_skill_version_unique" UNIQUE ("skill_id", "version"),
  CONSTRAINT "skill_versions_status_check" CHECK ("status" IN ('published', 'archived')),
  CONSTRAINT "skill_versions_confidence_range_check" CHECK ("confidence_score" IS NULL OR ("confidence_score" >= 0 AND "confidence_score" <= 1))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_versions_skill_status_idx" ON "skill_versions" ("skill_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_versions_workspace_status_idx" ON "skill_versions" ("workspace_id", "status");
--> statement-breakpoint

ALTER TABLE "skill_drafts" ADD CONSTRAINT "skill_drafts_promoted_to_version_id_skill_versions_id_fk"
  FOREIGN KEY ("promoted_to_version_id") REFERENCES "skill_versions"("id") ON DELETE SET NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "process_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "skill_version_id" uuid NOT NULL REFERENCES "skill_versions"("id") ON DELETE CASCADE,
  -- SkillStep.id: stable snake_case identifier from extraction, unique within
  -- its version, NOT a UUID (preserved verbatim for cross-version diffing).
  "step_id" text NOT NULL,
  "description" text NOT NULL,
  "owner_role" text,
  "preconditions" jsonb NOT NULL DEFAULT '[]',
  "conditions" jsonb NOT NULL DEFAULT '[]',
  "deadline" jsonb,
  "parallel_group" text,
  "parallel_semantics" text,
  "evidence" jsonb NOT NULL DEFAULT '[]',
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "process_nodes_version_step_unique" UNIQUE ("skill_version_id", "step_id"),
  CONSTRAINT "process_nodes_parallel_semantics_check" CHECK ("parallel_semantics" IS NULL OR "parallel_semantics" IN ('unordered', 'required_concurrent'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "process_nodes_version_idx" ON "process_nodes" ("skill_version_id");
--> statement-breakpoint
-- Cross-skill role queries: "every step Security owns across all published skills".
CREATE INDEX IF NOT EXISTS "process_nodes_workspace_role_idx" ON "process_nodes" ("workspace_id", "owner_role");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "process_edges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "skill_version_id" uuid NOT NULL REFERENCES "skill_versions"("id") ON DELETE CASCADE,
  "from_node_id" uuid NOT NULL REFERENCES "process_nodes"("id") ON DELETE CASCADE,
  "to_node_id" uuid NOT NULL REFERENCES "process_nodes"("id") ON DELETE CASCADE,
  -- Only 'precedes' today; a text column (not an enum) so a future edge type
  -- (e.g. a materialized gate relation) doesn't require an ALTER TYPE.
  "relation" text NOT NULL DEFAULT 'precedes',
  "evidence" jsonb NOT NULL DEFAULT '[]',
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "process_edges_from_to_relation_unique" UNIQUE ("from_node_id", "to_node_id", "relation")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "process_edges_version_idx" ON "process_edges" ("skill_version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "process_edges_from_idx" ON "process_edges" ("from_node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "process_edges_to_idx" ON "process_edges" ("to_node_id");
