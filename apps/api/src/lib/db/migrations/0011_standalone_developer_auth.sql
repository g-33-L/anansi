-- Standalone developer auth — decouple developer_accounts from Slack workspaces.
-- Developers can now sign up with email only; a workspace is auto-provisioned.
-- Magic-link tokens stored hashed (sha256); one-time use with 15-min expiry.

-- Allow developer accounts to have no Slack workspace (API-only customers)
ALTER TABLE "developer_accounts"
  ALTER COLUMN "workspace_id" DROP NOT NULL;

-- Allow API-only workspaces to have no Slack credentials
ALTER TABLE "workspaces"
  ALTER COLUMN "slack_team_id" DROP NOT NULL,
  ALTER COLUMN "slack_bot_token" DROP NOT NULL,
  ALTER COLUMN "slack_team_name" DROP NOT NULL;

-- Magic-link auth tokens for developer portal login
CREATE TABLE IF NOT EXISTS "developer_auth_tokens" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "developer_id" uuid NOT NULL REFERENCES "developer_accounts"("id") ON DELETE CASCADE,
  "token_hash"   text NOT NULL UNIQUE,
  "expires_at"   timestamp NOT NULL,
  "used_at"      timestamp,
  "created_at"   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS developer_auth_tokens_developer_idx
  ON "developer_auth_tokens"("developer_id");
