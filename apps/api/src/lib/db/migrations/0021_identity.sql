-- Phase 5 — Identity & access layer.
--
-- Adds the product identity model ABOVE the existing engine, all additive:
--   organizations         the account boundary (edition-gated)
--   users                 real auth principals (email), distinct from memory_users
--   memberships           user x org x role (RBAC join; one row per user per org)
--   teams / team_memberships   sub-groups within an org
--   invitations           pending email invites (hashed token)
--   user_sessions         server-side sessions for the /console app (hashed cookie)
--   user_auth_tokens      magic-link login (self-hostable; no Supabase dependency)
--   api_key_scopes        optional scopes on developer_api_keys (absent = full access)
--
-- workspaces gains organization_id (nullable) so the engine's tenant tables roll
-- up to an org. The engine still isolates by workspace_id — orgs sit above it.
-- Role/status/edition/scope are plain text + CHECK (adding a value later is an
-- idempotent migration, not an ALTER TYPE). Backfill at the bottom bootstraps one
-- org + owner user per existing developer_account and re-parents its workspace.

CREATE TABLE IF NOT EXISTS "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "edition" text NOT NULL DEFAULT 'cloud',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "organizations_slug_unique" UNIQUE ("slug"),
  CONSTRAINT "organizations_edition_check" CHECK ("edition" IN ('community', 'self_hosted', 'cloud', 'enterprise'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "name" text,
  "avatar_url" text,
  "status" text NOT NULL DEFAULT 'active',
  "last_login_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "users_email_unique" UNIQUE ("email"),
  CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'suspended', 'deprovisioned'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "role" text NOT NULL DEFAULT 'member',
  "status" text NOT NULL DEFAULT 'active',
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "memberships_user_org_unique" UNIQUE ("user_id", "organization_id"),
  CONSTRAINT "memberships_role_check" CHECK ("role" IN ('owner', 'admin', 'member', 'billing', 'auditor', 'viewer')),
  CONSTRAINT "memberships_status_check" CHECK ("status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_org_idx" ON "memberships" ("organization_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_user_idx" ON "memberships" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "teams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "teams_org_name_unique" UNIQUE ("organization_id", "name")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "team_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "team_id" uuid NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "membership_id" uuid NOT NULL REFERENCES "memberships"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "team_memberships_team_membership_unique" UNIQUE ("team_id", "membership_id")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "token_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "accepted_at" timestamp,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "invitations_token_hash_unique" UNIQUE ("token_hash"),
  CONSTRAINT "invitations_role_check" CHECK ("role" IN ('owner', 'admin', 'member', 'billing', 'auditor', 'viewer'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitations_org_idx" ON "invitations" ("organization_id");
--> statement-breakpoint
-- At most one PENDING invite per (org, lower(email)); accepted invites are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS "invitations_org_email_pending_unique"
  ON "invitations" ("organization_id", lower("email"))
  WHERE "accepted_at" IS NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "active_organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "expires_at" timestamp NOT NULL,
  "last_seen_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "user_sessions_token_hash_unique" UNIQUE ("token_hash")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_sessions_user_idx" ON "user_sessions" ("user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_auth_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "user_auth_tokens_token_hash_unique" UNIQUE ("token_hash")
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "api_key_scopes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "api_key_id" uuid NOT NULL REFERENCES "developer_api_keys"("id") ON DELETE CASCADE,
  "scope" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "api_key_scopes_key_scope_unique" UNIQUE ("api_key_id", "scope"),
  CONSTRAINT "api_key_scopes_scope_check" CHECK ("scope" IN ('ingest', 'read', 'admin', 'entities', 'ledger'))
);
--> statement-breakpoint

-- Re-parent workspaces under organizations (nullable; backfilled below).
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_organization_idx" ON "workspaces" ("organization_id");
--> statement-breakpoint

-- ── Backfill ────────────────────────────────────────────────────────────────
-- One organization + owner user + owner membership per existing developer_account,
-- then re-parent that developer's workspace. developer_accounts.email is unique, so
-- exactly one user per account. Runs once (drizzle tracks applied migrations).
DO $$
DECLARE
  r RECORD;
  v_org uuid;
  v_user uuid;
BEGIN
  FOR r IN
    SELECT da.id AS dev_id, lower(da.email) AS email, da.name AS name, da.workspace_id AS ws_id
    FROM developer_accounts da
  LOOP
    INSERT INTO organizations (name, slug, edition)
    VALUES (
      COALESCE(NULLIF(btrim(r.name), ''), split_part(r.email, '@', 1)),
      regexp_replace(lower(split_part(r.email, '@', 1)), '[^a-z0-9]+', '-', 'g') || '-' || substr(r.dev_id::text, 1, 8),
      'cloud'
    )
    RETURNING id INTO v_org;

    INSERT INTO users (email, name)
    VALUES (r.email, r.name)
    ON CONFLICT (email) DO UPDATE SET name = COALESCE(users.name, EXCLUDED.name)
    RETURNING id INTO v_user;

    INSERT INTO memberships (user_id, organization_id, role)
    VALUES (v_user, v_org, 'owner')
    ON CONFLICT (user_id, organization_id) DO NOTHING;

    IF r.ws_id IS NOT NULL THEN
      UPDATE workspaces SET organization_id = v_org
      WHERE id = r.ws_id AND organization_id IS NULL;
    END IF;
  END LOOP;
END $$;
