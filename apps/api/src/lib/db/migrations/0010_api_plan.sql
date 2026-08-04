-- Add 'api' value to plan_type enum for developer API billing tier
DO $$ BEGIN
  ALTER TYPE "public"."plan_type" ADD VALUE 'api';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
