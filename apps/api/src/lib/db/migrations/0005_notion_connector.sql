-- Add notion_page to source_type enum
DO $$ BEGIN
 ALTER TYPE "public"."source_type" ADD VALUE 'notion_page';
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Connector tokens: encrypted OAuth tokens per provider per workspace
CREATE TABLE IF NOT EXISTS "connector_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connector_tokens_workspace_provider_unique" UNIQUE("workspace_id","provider")
);
--> statement-breakpoint
ALTER TABLE "connector_tokens" ADD CONSTRAINT "connector_tokens_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_tokens_workspace_id_idx" ON "connector_tokens" ("workspace_id");
