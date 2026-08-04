-- Add "scale" plan tier (replaces flat $49 "api" tier with Free / Pro / Scale structure).
-- Existing "api" enum value retained for backwards compatibility with any subscriptions
-- already issued; code treats "api" as legacy and routes new signups to "pro" or "scale".
ALTER TYPE "plan_type" ADD VALUE IF NOT EXISTS 'scale';
