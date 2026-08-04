-- Privacy opt-out for Slack-native per-person memory. When a user opts out
-- (`/memory forget-me`), their personal profile + entity graph is purged and their
-- chunks are detached from per-user memory (memory_user_id set NULL) while staying
-- in the team profile. This flag stops future messages from being re-attributed.
ALTER TABLE "memory_users"
  ADD COLUMN IF NOT EXISTS "opted_out" boolean NOT NULL DEFAULT false;
