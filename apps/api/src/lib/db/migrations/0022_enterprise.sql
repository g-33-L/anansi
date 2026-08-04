-- Phase 7 — Enterprise (edition-gated) layer.
--
-- All additive; hangs off organizations. No engine table altered.
--   sso_connections     one SAML/OIDC connection per org (secrets AES-GCM)
--   scim_tokens         SCIM 2.0 bearer tokens (HMAC-hashed, like developer_api_keys)
--   audit_events        append-only compliance log (never updated/deleted)
--   approval_requests   generic governance queue (skill publish, role grant, export)
--   redaction_rules     admin PII controls atop static sanitize.ts
--   licenses            signed self-host/enterprise edition validation
--
-- Value sets (protocol/actor_type/status/action) are plain text + CHECK so adding
-- a value later is an idempotent migration, not an ALTER TYPE (matches 0021).

CREATE TABLE IF NOT EXISTS "sso_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "protocol" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "secret" text,
  "group_role_map" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "sso_connections_organization_id_unique" UNIQUE ("organization_id"),
  CONSTRAINT "sso_connections_protocol_check" CHECK ("protocol" IN ('saml', 'oidc'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "scim_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL DEFAULT 'SCIM',
  "token_hash" text NOT NULL,
  "last_used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "scim_tokens_token_hash_unique" UNIQUE ("token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scim_tokens_org_idx" ON "scim_tokens" ("organization_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "actor_type" text NOT NULL DEFAULT 'user',
  "action" text NOT NULL,
  "target_type" text,
  "target_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "audit_events_actor_type_check" CHECK ("actor_type" IN ('user', 'system', 'scim', 'api_key'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_events_org_created_idx" ON "audit_events" ("organization_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "approval_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "subject_ref" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "decided_at" timestamp,
  "notes" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "approval_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_org_status_idx" ON "approval_requests" ("organization_id", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "redaction_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "pattern" text NOT NULL,
  "action" text NOT NULL DEFAULT 'mask',
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "redaction_rules_action_check" CHECK ("action" IN ('mask', 'drop', 'hash'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "redaction_rules_org_idx" ON "redaction_rules" ("organization_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "licenses" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "edition" text NOT NULL,
  "signed_payload" text NOT NULL,
  "seats" integer,
  "expires_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "licenses_org_idx" ON "licenses" ("organization_id");
