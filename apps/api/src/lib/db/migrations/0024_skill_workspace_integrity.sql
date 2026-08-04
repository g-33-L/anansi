-- Keep every skill lifecycle record in the workspace of its parent. Individual
-- UUID foreign keys are insufficient: they allow a valid parent from another
-- workspace to be linked accidentally, corrupting workspace-scoped queries.

ALTER TABLE "skill_definitions"
  ADD CONSTRAINT "skill_definitions_id_workspace_unique" UNIQUE ("id", "workspace_id");
--> statement-breakpoint

ALTER TABLE "skill_drafts"
  ADD CONSTRAINT "skill_drafts_id_skill_workspace_unique" UNIQUE ("id", "skill_id", "workspace_id"),
  ADD CONSTRAINT "skill_drafts_skill_workspace_fk"
    FOREIGN KEY ("skill_id", "workspace_id")
    REFERENCES "skill_definitions" ("id", "workspace_id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "skill_versions"
  ADD CONSTRAINT "skill_versions_id_workspace_unique" UNIQUE ("id", "workspace_id"),
  ADD CONSTRAINT "skill_versions_id_skill_workspace_unique" UNIQUE ("id", "skill_id", "workspace_id"),
  ADD CONSTRAINT "skill_versions_skill_workspace_fk"
    FOREIGN KEY ("skill_id", "workspace_id")
    REFERENCES "skill_definitions" ("id", "workspace_id") ON DELETE CASCADE,
  ADD CONSTRAINT "skill_versions_source_draft_skill_workspace_fk"
    FOREIGN KEY ("source_draft_id", "skill_id", "workspace_id")
    REFERENCES "skill_drafts" ("id", "skill_id", "workspace_id") ON DELETE SET NULL ("source_draft_id");
--> statement-breakpoint

ALTER TABLE "skill_drafts"
  ADD CONSTRAINT "skill_drafts_promoted_version_skill_workspace_fk"
    FOREIGN KEY ("promoted_to_version_id", "skill_id", "workspace_id")
    REFERENCES "skill_versions" ("id", "skill_id", "workspace_id") ON DELETE SET NULL ("promoted_to_version_id");
--> statement-breakpoint

ALTER TABLE "process_nodes"
  ADD CONSTRAINT "process_nodes_id_version_workspace_unique" UNIQUE ("id", "skill_version_id", "workspace_id"),
  ADD CONSTRAINT "process_nodes_version_workspace_fk"
    FOREIGN KEY ("skill_version_id", "workspace_id")
    REFERENCES "skill_versions" ("id", "workspace_id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "process_edges"
  ADD CONSTRAINT "process_edges_version_workspace_fk"
    FOREIGN KEY ("skill_version_id", "workspace_id")
    REFERENCES "skill_versions" ("id", "workspace_id") ON DELETE CASCADE,
  ADD CONSTRAINT "process_edges_from_node_version_workspace_fk"
    FOREIGN KEY ("from_node_id", "skill_version_id", "workspace_id")
    REFERENCES "process_nodes" ("id", "skill_version_id", "workspace_id") ON DELETE CASCADE,
  ADD CONSTRAINT "process_edges_to_node_version_workspace_fk"
    FOREIGN KEY ("to_node_id", "skill_version_id", "workspace_id")
    REFERENCES "process_nodes" ("id", "skill_version_id", "workspace_id") ON DELETE CASCADE;
