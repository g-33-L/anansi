-- Add gdoc and linear_issue to source_type enum
DO $$ BEGIN
 ALTER TYPE "public"."source_type" ADD VALUE 'gdoc';
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TYPE "public"."source_type" ADD VALUE 'linear_issue';
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
