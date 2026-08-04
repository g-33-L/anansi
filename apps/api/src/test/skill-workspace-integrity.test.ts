/*
 * Tenant isolation for the skill lifecycle tables (migration 0024).
 *
 * Every lifecycle table carries its own `workspace_id` alongside a parent ID.
 * Single-column foreign keys validate the parent EXISTS but not that it belongs
 * to the same workspace, so a bug in the extraction/promotion path could link a
 * draft to another tenant's skill and silently corrupt workspace-scoped reads.
 *
 * Migration 0024 adds composite (id, workspace_id) uniques and composite foreign
 * keys so the database — not the application — rejects those links. These tests
 * assert the database does the rejecting: they issue the write directly, with no
 * application code in the path.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db, closePool } from "../lib/db/index.js";
import { cleanDatabase } from "./setup.js";

const WS_A = "11111111-1111-1111-1111-111111111111";
const WS_B = "22222222-2222-2222-2222-222222222222";
const SKILL_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const SKILL_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const VERSION_A = "aaaaaaaa-0000-0000-0000-0000000000f1";
const NODE_1 = "dddddddd-0000-0000-0000-000000000002";
const NODE_2 = "dddddddd-0000-0000-0000-000000000003";

/*
 * Postgres raises 23503 (foreign_key_violation) when a composite FK is unmet.
 * Drizzle wraps driver errors, so the pg error sits on `.cause`.
 *
 * Asserting the code alone would be too weak — these tables still carry their
 * original single-column FKs, which also raise 23503. So the violated
 * constraint must also be one of migration 0024's composite keys, every one of
 * which is suffixed `_workspace_fk`. The pre-existing single-column keys end in
 * `_workspace_id_fkey` / `_id_fk` and cannot match.
 *
 * The suffix is matched rather than an exact name on purpose: a row can breach
 * more than one composite key at once (a mis-tagged edge violates both the
 * version and the from-node key), and which one Postgres reports depends on FK
 * trigger creation order. That order is an implementation detail no test should
 * depend on — pinning an exact name makes this suite fail if a later migration
 * merely recreates a constraint.
 */
const COMPOSITE_FK = /_workspace_fk$/;

async function expectCompositeForeignKeyViolation(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    cause: { code: "23503", constraint: expect.stringMatching(COMPOSITE_FK) },
  });
}

describe("skill lifecycle — cross-workspace references are rejected by the database", () => {
  beforeEach(async () => {
    await cleanDatabase();

    // Two tenants. A owns a skill, one published version, and two process nodes.
    await db.execute(sql`INSERT INTO workspaces (id) VALUES (${WS_A}::uuid), (${WS_B}::uuid)`);
    await db.execute(sql`
      INSERT INTO skill_definitions (id, workspace_id, domain, title) VALUES
        (${SKILL_A}::uuid, ${WS_A}::uuid, 'ops', 'A skill'),
        (${SKILL_B}::uuid, ${WS_B}::uuid, 'ops', 'B skill')`);
    await db.execute(sql`
      INSERT INTO skill_versions (id, workspace_id, skill_id, version, extracted_at)
      VALUES (${VERSION_A}::uuid, ${WS_A}::uuid, ${SKILL_A}::uuid, '1.0.0', now())`);
    await db.execute(sql`
      INSERT INTO process_nodes (id, workspace_id, skill_version_id, step_id, description) VALUES
        (${NODE_1}::uuid, ${WS_A}::uuid, ${VERSION_A}::uuid, 's1', 'step one'),
        (${NODE_2}::uuid, ${WS_A}::uuid, ${VERSION_A}::uuid, 's2', 'step two')`);
  });

  afterAll(async () => {
    await closePool();
  });

  // ── Rejected: the parent lives in another workspace ────────────────────────

  it("rejects a draft in workspace B attached to workspace A's skill", async () => {
    await expectCompositeForeignKeyViolation(
      db.execute(sql`
        INSERT INTO skill_drafts (workspace_id, skill_id)
        VALUES (${WS_B}::uuid, ${SKILL_A}::uuid)`)
    );
  });

  it("rejects a version in workspace B attached to workspace A's skill", async () => {
    await expectCompositeForeignKeyViolation(
      db.execute(sql`
        INSERT INTO skill_versions (workspace_id, skill_id, version, extracted_at)
        VALUES (${WS_B}::uuid, ${SKILL_A}::uuid, '9.9.9', now())`)
    );
  });

  it("rejects a version promoted from a draft belonging to another workspace", async () => {
    const draftB = "cccccccc-0000-0000-0000-00000000000d";
    await db.execute(sql`
      INSERT INTO skill_drafts (id, workspace_id, skill_id)
      VALUES (${draftB}::uuid, ${WS_B}::uuid, ${SKILL_B}::uuid)`);

    await expectCompositeForeignKeyViolation(
      db.execute(sql`
        INSERT INTO skill_versions (workspace_id, skill_id, version, extracted_at, source_draft_id)
        VALUES (${WS_A}::uuid, ${SKILL_A}::uuid, '2.0.0', now(), ${draftB}::uuid)`)
    );
  });

  it("rejects a process node in workspace B attached to workspace A's version", async () => {
    await expectCompositeForeignKeyViolation(
      db.execute(sql`
        INSERT INTO process_nodes (workspace_id, skill_version_id, step_id, description)
        VALUES (${WS_B}::uuid, ${VERSION_A}::uuid, 'sx', 'x')`)
    );
  });

  it("rejects a process edge tagged to a workspace that does not own its nodes", async () => {
    await expectCompositeForeignKeyViolation(
      db.execute(sql`
        INSERT INTO process_edges (workspace_id, skill_version_id, from_node_id, to_node_id)
        VALUES (${WS_B}::uuid, ${VERSION_A}::uuid, ${NODE_1}::uuid, ${NODE_2}::uuid)`)
    );
  });

  // ── Accepted: the guard must not block legitimate same-workspace work ───────

  it("accepts a draft, edge, and promotion entirely within one workspace", async () => {
    const draftA = "dddddddd-0000-0000-0000-000000000001";

    await db.execute(sql`
      INSERT INTO skill_drafts (id, workspace_id, skill_id)
      VALUES (${draftA}::uuid, ${WS_A}::uuid, ${SKILL_A}::uuid)`);

    await db.execute(sql`
      INSERT INTO process_edges (workspace_id, skill_version_id, from_node_id, to_node_id)
      VALUES (${WS_A}::uuid, ${VERSION_A}::uuid, ${NODE_1}::uuid, ${NODE_2}::uuid)`);

    await db.execute(sql`
      UPDATE skill_drafts SET promoted_to_version_id = ${VERSION_A}::uuid
      WHERE id = ${draftA}::uuid`);

    const promoted = await db.execute(sql`
      SELECT promoted_to_version_id FROM skill_drafts WHERE id = ${draftA}::uuid`);
    expect(promoted.rows[0]?.promoted_to_version_id).toBe(VERSION_A);
  });

  // ── Cascade behaviour survives the composite rewrite ───────────────────────

  it("cascades version deletion to its process graph without orphaning rows", async () => {
    await db.execute(sql`
      INSERT INTO process_edges (workspace_id, skill_version_id, from_node_id, to_node_id)
      VALUES (${WS_A}::uuid, ${VERSION_A}::uuid, ${NODE_1}::uuid, ${NODE_2}::uuid)`);

    await db.execute(sql`DELETE FROM skill_versions WHERE id = ${VERSION_A}::uuid`);

    const nodes = await db.execute(sql`SELECT count(*)::int AS n FROM process_nodes`);
    const edges = await db.execute(sql`SELECT count(*)::int AS n FROM process_edges`);
    expect(nodes.rows[0]?.n).toBe(0);
    expect(edges.rows[0]?.n).toBe(0);
  });

  it("nulls the back-reference instead of deleting history when a version is removed", async () => {
    const draftA = "dddddddd-0000-0000-0000-000000000004";
    await db.execute(sql`
      INSERT INTO skill_drafts (id, workspace_id, skill_id, promoted_to_version_id)
      VALUES (${draftA}::uuid, ${WS_A}::uuid, ${SKILL_A}::uuid, ${VERSION_A}::uuid)`);

    await db.execute(sql`DELETE FROM skill_versions WHERE id = ${VERSION_A}::uuid`);

    const rows = await db.execute(sql`
      SELECT promoted_to_version_id FROM skill_drafts WHERE id = ${draftA}::uuid`);
    expect(rows.rows).toHaveLength(1); // draft survived
    expect(rows.rows[0]?.promoted_to_version_id).toBeNull();
  });
});
