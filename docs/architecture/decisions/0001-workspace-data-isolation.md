# ADR-0001: Workspace Data Isolation Strategy

**Date:** 2026-06-18  
**Status:** Accepted

## Context

Anansi is a multi-tenant SaaS. Each developer workspace must be fully isolated from others — a bug in any query must not leak one customer's memories to another.

## Decision

Isolation is enforced at the **application layer** only. Every database query explicitly scopes by `workspaceId` or `developerId` in its `WHERE` clause. No query reaches the DB without a workspace-scoped predicate.

Row-Level Security (RLS) is enabled on `memory_chunks` as a defense-in-depth NULL guard: `USING (workspace_id IS NOT NULL)`. This prevents rows without a workspace from appearing, but it does **not** enforce tenant isolation. A future migration to session-variable RLS (`SET LOCAL app.current_workspace_id`) would require refactoring all query paths and is tracked separately.

### Amendment (2026-08-04) — referential integrity on the skill lifecycle tables

The decision above governs **reads**. It says nothing about *writes* that link two
rows together, and those turn out to be a distinct failure mode: a query correctly
scoped by `workspace_id` still returns corrupt results if the row it joins to was
written pointing at another tenant's parent.

`skill_definitions`, `skill_drafts`, `skill_versions`, `process_nodes`, and
`process_edges` each carry `workspace_id` beside a parent ID. Their original
single-column foreign keys prove only that the parent *exists*. Migration
`0024_skill_workspace_integrity` adds composite `(id, workspace_id)` unique
constraints and composite foreign keys so the database rejects a child row whose
parent belongs to a different workspace.

This is a **narrow** amendment, and it is worth being precise about its limits:

- It covers the skill lifecycle tables only. Everywhere else, isolation remains
  application-layer as described above.
- It constrains writes, not reads. It does not stop an unscoped `SELECT` from
  returning another tenant's rows.
- It is not the session-variable RLS rejected below; that alternative is still
  unimplemented and still tracked separately.

Enforced by `apps/api/src/test/skill-workspace-integrity.test.ts`, which asserts
the constraints against a live database with no application code in the path.

## Consequences

**Accepted risks:**
- A missing `WHERE workspace_id = ?` in any new query would silently return cross-tenant data. Code review must verify scoping on every new query.
- The RLS policy provides no protection against a bug in query construction.
- Outside the skill lifecycle tables, nothing at the database layer prevents a
  write from linking rows across two workspaces.

**Mitigations:**
- All DB access goes through Drizzle ORM — raw SQL is limited to post-migration scripts and query-engine vector searches, both of which include explicit workspace filters.
- The production DB user must not be a PostgreSQL superuser (superusers bypass RLS).
- Integration tests exercise workspace scoping in `v1.test.ts` and `integration.test.ts`.

## Alternatives Considered

**Session-variable RLS:** `SET LOCAL app.current_workspace_id = ?` before each query, policy checks `workspace_id = current_setting(...)::uuid`. Provides DB-level enforcement but requires every query path to set the session variable, significant refactor risk.

**Schema-per-tenant:** Each workspace gets its own PostgreSQL schema. Complete isolation but operationally complex — migrations, connection pooling, and vector indexes become per-tenant.
