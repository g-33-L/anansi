-- Extend source_type enum
DO $$ BEGIN
 ALTER TYPE "public"."source_type" ADD VALUE 'api_text';
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TYPE "public"."source_type" ADD VALUE 'meeting_transcript';
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Developer accounts (1:1 with Slack workspaces for MVP)
CREATE TABLE IF NOT EXISTS "developer_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "developer_accounts_workspace_id_unique" UNIQUE("workspace_id"),
	CONSTRAINT "developer_accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint

-- Hashed API keys per developer
CREATE TABLE IF NOT EXISTS "developer_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"developer_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "developer_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint

-- End-users of developer LLM apps (personal memory)
CREATE TABLE IF NOT EXISTS "memory_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"developer_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_users_developer_external_id_unique" UNIQUE("developer_id","external_id")
);
--> statement-breakpoint

-- Foreign keys for new tables
DO $$ BEGIN
 ALTER TABLE "developer_accounts" ADD CONSTRAINT "developer_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "developer_api_keys" ADD CONSTRAINT "developer_api_keys_developer_id_developer_accounts_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."developer_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_users" ADD CONSTRAINT "memory_users_developer_id_developer_accounts_id_fk" FOREIGN KEY ("developer_id") REFERENCES "public"."developer_accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Extend memory_chunks: make channel_id nullable, add memory_user_id
-- Lock timeout of 10s prevents ACCESS EXCLUSIVE lock from queuing all traffic if the table is busy
SET lock_timeout = '10s';
ALTER TABLE "memory_chunks" ALTER COLUMN "channel_id" DROP NOT NULL;
SET lock_timeout = DEFAULT;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_chunks" ADD COLUMN "memory_user_id" uuid;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memory_chunks" ADD CONSTRAINT "memory_chunks_memory_user_id_memory_users_id_fk" FOREIGN KEY ("memory_user_id") REFERENCES "public"."memory_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Extend static_documents: make workspace_id nullable, add memory_user_id
SET lock_timeout = '10s';
ALTER TABLE "static_documents" ALTER COLUMN "workspace_id" DROP NOT NULL;
SET lock_timeout = DEFAULT;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "static_documents" ADD COLUMN "memory_user_id" uuid;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "static_documents" ADD CONSTRAINT "static_documents_memory_user_id_unique" UNIQUE("memory_user_id");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- XOR: exactly one of workspace_id / memory_user_id must be set
DO $$ BEGIN
 ALTER TABLE "static_documents" ADD CONSTRAINT "static_documents_scope_xor" CHECK (
   (workspace_id IS NOT NULL) <> (memory_user_id IS NOT NULL)
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "static_documents" ADD CONSTRAINT "static_documents_memory_user_id_memory_users_id_fk" FOREIGN KEY ("memory_user_id") REFERENCES "public"."memory_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Extend usage_stats: add memory_user_id, ingest_calls_count, context_calls_count
DO $$ BEGIN
 ALTER TABLE "usage_stats" ADD COLUMN "memory_user_id" uuid;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_stats" ADD COLUMN "ingest_calls_count" integer DEFAULT 0 NOT NULL;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_stats" ADD COLUMN "context_calls_count" integer DEFAULT 0 NOT NULL;
EXCEPTION
 WHEN duplicate_column THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_stats" ADD CONSTRAINT "usage_stats_memory_user_id_memory_users_id_fk" FOREIGN KEY ("memory_user_id") REFERENCES "public"."memory_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Indexes for new FK columns (run CONCURRENTLY to avoid blocking reads on large tables)
CREATE INDEX IF NOT EXISTS "memory_chunks_memory_user_id_idx" ON "memory_chunks" ("memory_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_stats_memory_user_id_idx" ON "usage_stats" ("memory_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "developer_api_keys_developer_id_idx" ON "developer_api_keys" ("developer_id");
