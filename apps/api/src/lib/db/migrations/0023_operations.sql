-- Phase 8 — Internal operations plane.
--
-- All additive. The managed-cloud operator surface. Deliberately separate from
-- customer tables (ADR-0004/0005/0006/0007):
--   operator_audit_events   staff-action audit, distinct stream from audit_events
--   feature_flags           server-evaluated, default-deny, owner + expiry required
--   announcements           operator announcements, edition/org targeted, scheduled
--
-- Value sets are text + CHECK (add-a-value = idempotent migration, per 0021/0022).

CREATE TABLE IF NOT EXISTS "operator_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_email" text NOT NULL,
  "action" text NOT NULL,
  "target_organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "target_type" text,
  "target_id" text,
  "reason" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "correlation_id" text,
  "ip" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_audit_actor_idx" ON "operator_audit_events" ("actor_user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "operator_audit_target_org_idx" ON "operator_audit_events" ("target_organization_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "feature_flags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "scope" text NOT NULL DEFAULT 'global',
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT false,
  "owner" text NOT NULL,
  "reference" text,
  "expires_at" timestamp,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "feature_flags_scope_check" CHECK ("scope" IN ('global', 'org')),
  -- An org-scoped flag must name an org; a global flag must not.
  CONSTRAINT "feature_flags_scope_org_check" CHECK (
    ("scope" = 'org' AND "organization_id" IS NOT NULL) OR
    ("scope" = 'global' AND "organization_id" IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_flags_key_idx" ON "feature_flags" ("key");
--> statement-breakpoint
-- At most one global row per key, and at most one override per (key, org).
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_global_key_unique"
  ON "feature_flags" ("key") WHERE "scope" = 'global';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_org_key_unique"
  ON "feature_flags" ("key", "organization_id") WHERE "scope" = 'org';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "announcements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" text NOT NULL,
  "body" text NOT NULL,
  "level" text NOT NULL DEFAULT 'info',
  "audience" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "starts_at" timestamp,
  "ends_at" timestamp,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "announcements_level_check" CHECK ("level" IN ('info', 'warning', 'critical')),
  CONSTRAINT "announcements_status_check" CHECK ("status" IN ('draft', 'scheduled', 'published', 'withdrawn'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_status_idx" ON "announcements" ("status");
