import { describe, it, expect } from "vitest";
import {
  ROLES,
  PERMISSIONS,
  permissionsForRole,
  roleHasPermission,
  isRole,
  canManageMembers,
} from "../lib/identity/roles.js";

// Pure RBAC-matrix tests (no DB). The repo/route tests that exercise the identity
// tables require DATABASE_URL (Postgres) and run in CI.
describe("identity/roles — RBAC matrix", () => {
  it("owner holds every permission", () => {
    for (const p of PERMISSIONS) expect(roleHasPermission("owner", p)).toBe(true);
  });

  it("admin holds everything except org:delete and billing:manage", () => {
    expect(roleHasPermission("admin", "org:delete")).toBe(false);
    expect(roleHasPermission("admin", "billing:manage")).toBe(false);
    expect(roleHasPermission("admin", "member:invite")).toBe(true);
    expect(roleHasPermission("admin", "team:write")).toBe(true);
  });

  it("member can write memory + own keys but cannot manage members", () => {
    expect(roleHasPermission("member", "memory:write")).toBe(true);
    expect(roleHasPermission("member", "apikey:write")).toBe(true);
    expect(roleHasPermission("member", "member:invite")).toBe(false);
    expect(roleHasPermission("member", "org:update")).toBe(false);
  });

  it("viewer is strictly read-only", () => {
    expect(roleHasPermission("viewer", "workspace:read")).toBe(true);
    expect(roleHasPermission("viewer", "memory:read")).toBe(true);
    expect(roleHasPermission("viewer", "workspace:write")).toBe(false);
    expect(roleHasPermission("viewer", "memory:write")).toBe(false);
  });

  it("billing manages billing but not members or workspaces", () => {
    expect(roleHasPermission("billing", "billing:manage")).toBe(true);
    expect(roleHasPermission("billing", "member:invite")).toBe(false);
    expect(roleHasPermission("billing", "workspace:write")).toBe(false);
  });

  it("auditor reads the audit log but writes nothing", () => {
    expect(roleHasPermission("auditor", "audit:read")).toBe(true);
    expect(roleHasPermission("auditor", "memory:read")).toBe(true);
    expect(roleHasPermission("auditor", "workspace:write")).toBe(false);
    expect(roleHasPermission("auditor", "member:invite")).toBe(false);
  });

  it("canManageMembers is exactly the owner/admin set", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("member")).toBe(false);
    expect(canManageMembers("viewer")).toBe(false);
    expect(canManageMembers("billing")).toBe(false);
    expect(canManageMembers("auditor")).toBe(false);
  });

  it("isRole guards membership.role values", () => {
    expect(isRole("owner")).toBe(true);
    expect(isRole("viewer")).toBe(true);
    expect(isRole("superadmin")).toBe(false);
    expect(isRole("")).toBe(false);
  });

  it("every role grants only permissions declared in PERMISSIONS", () => {
    for (const role of ROLES) {
      for (const p of permissionsForRole(role)) {
        expect(PERMISSIONS).toContain(p);
      }
    }
  });
});
