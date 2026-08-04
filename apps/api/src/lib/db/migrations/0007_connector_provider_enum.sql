-- Convert connector_tokens.provider from untyped text to connector_provider enum.
-- This migration can run on an empty table in dev; in prod run during a maintenance window.
DO $$ BEGIN
  CREATE TYPE "public"."connector_provider" AS ENUM('notion', 'google_docs', 'linear');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
SET lock_timeout = '10s';
ALTER TABLE "connector_tokens"
  ALTER COLUMN "provider" TYPE "public"."connector_provider"
  USING "provider"::"public"."connector_provider";
SET lock_timeout = DEFAULT;
