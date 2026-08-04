-- Add transcript_webhook provider to connector_provider enum
DO $$ BEGIN
  ALTER TYPE "public"."connector_provider" ADD VALUE 'transcript_webhook';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- Add outbound webhook URL to developer_accounts
DO $$ BEGIN
  ALTER TABLE "developer_accounts" ADD COLUMN "webhook_url" text;
EXCEPTION
  WHEN duplicate_column THEN null;
END $$;
