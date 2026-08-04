-- Append-only attestation primitive. An attestation is a bi-temporal, evidence-
-- backed claim about how the organization operates. Both time axes mirror
-- entity_edges exactly — valid-time (valid_from/valid_until) records when the
-- claim held in the real world; knowledge-time (recorded_at/valid_until_recorded_at)
-- records when we learned each boundary. Unlike entity_edges (relational claims),
-- attestations carry propositional/role/policy claims. Append-only: claims are
-- closed (valid_until set), never deleted.
--
-- Trust invariants encoded as defaults/constraints — the ledger must never invent
-- certainty: confidence defaults to 0 (not 1.0), status to 'candidate' (never
-- auto-published), inference_status to 'inferred' (least trusted). valid_from is
-- nullable (null = start unknown); readers floor the lower bound at recorded_at so
-- the ledger never implies a truth predated its evidence. This migration only
-- creates the primitive — nothing is populated by extraction yet (that is PR-2).

CREATE TABLE IF NOT EXISTS "attestations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "developer_id" uuid NOT NULL REFERENCES "developer_accounts"("id") ON DELETE CASCADE,
  "memory_user_id" uuid REFERENCES "memory_users"("id") ON DELETE CASCADE,
  "claim" text NOT NULL,
  "claim_fingerprint" text NOT NULL,
  "claim_key" text,
  "claim_type" text NOT NULL DEFAULT 'propositional',
  "subject_entity_id" uuid REFERENCES "entity_nodes"("id") ON DELETE SET NULL,
  "domain" text,
  "polarity" text NOT NULL DEFAULT 'assertion',
  "inference_status" text NOT NULL DEFAULT 'inferred',
  "status" text NOT NULL DEFAULT 'candidate',
  "confidence" double precision NOT NULL DEFAULT 0,
  "confidence_breakdown" jsonb NOT NULL DEFAULT '{}',
  "valid_from" timestamp,
  "valid_from_basis" text NOT NULL DEFAULT 'unknown',
  "valid_from_granularity" text NOT NULL DEFAULT 'unknown',
  "valid_until" timestamp,
  "valid_until_basis" text,
  "recorded_at" timestamp NOT NULL DEFAULT now(),
  "valid_until_recorded_at" timestamp,
  "evidence" jsonb NOT NULL DEFAULT '[]',
  "supersedes" uuid REFERENCES "attestations"("id") ON DELETE SET NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "attestations_status_check" CHECK ("status" IN ('observed', 'candidate', 'disputed')),
  CONSTRAINT "attestations_inference_status_check" CHECK ("inference_status" IN ('stated', 'corroborated', 'inferred')),
  CONSTRAINT "attestations_polarity_check" CHECK ("polarity" IN ('assertion', 'negation')),
  CONSTRAINT "attestations_valid_from_basis_check" CHECK ("valid_from_basis" IN ('stated', 'knowledge_derived', 'unknown')),
  CONSTRAINT "attestations_claim_type_check" CHECK ("claim_type" IN ('propositional', 'role', 'policy')),
  CONSTRAINT "attestations_confidence_range_check" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attestations_workspace_status_idx" ON "attestations" ("workspace_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attestations_workspace_domain_idx" ON "attestations" ("workspace_id", "domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attestations_valid_from_idx" ON "attestations" ("workspace_id", "valid_from");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attestations_recorded_at_idx" ON "attestations" ("recorded_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attestations_claim_key_idx" ON "attestations" ("workspace_id", "claim_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attestations_subject_idx" ON "attestations" ("subject_entity_id");
--> statement-breakpoint
-- At most one ACTIVE attestation per (workspace_id, claim_fingerprint). Closed
-- claims (valid_until set) are exempt so the bi-temporal history is preserved;
-- only the currently-active claim is unique. Makes inserts race-safe via
-- ON CONFLICT DO NOTHING. Competing claims with distinct fingerprints coexist
-- (the storage substrate for a 'disputed' group).
CREATE UNIQUE INDEX IF NOT EXISTS "attestations_active_unique"
  ON "attestations" ("workspace_id", "claim_fingerprint")
  WHERE "valid_until" IS NULL;
