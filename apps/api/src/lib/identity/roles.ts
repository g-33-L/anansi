/*
 * RBAC contract for the identity layer (Phase 5). Canonical, orchestrator-owned:
 * roles and the permission matrix are a product-wide decision. Enforced by the
 * /console middleware (requirePermission) and mirrored to API-key scopes on /v1.
 *
 * Roles map to memberships.role (CHECK-constrained in migration 0021). Permissions
 * are coarse `resource:action` strings. Keep this the single source of truth — do
 * not hard-code role checks in route handlers; call roleHasPermission().
 */

export const ROLES = ["owner", "admin", "member", "billing", "auditor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "org:read",
  "org:update",
  "org:delete",
  "member:read",
  "member:invite",
  "member:update", // change a member's role / suspend
  "member:remove",
  "team:read",
  "team:write",
  "workspace:read",
  "workspace:write",
  "apikey:read",
  "apikey:write",
  "billing:read",
  "billing:manage",
  "memory:read",
  "memory:write",
  "audit:read",
  // Enterprise (Phase 7) — edition-gated capabilities.
  "audit:export",
  "sso:read",
  "sso:write",
  "scim:manage",
  "governance:read",
  "governance:decide",
  "redaction:read",
  "redaction:write",
  "license:read",
  "license:write",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

// Least-privilege matrix. owner = everything; admin = everything except the two
// destructive/financial capabilities reserved to owner + billing.
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL,
  admin: ALL.filter((p) => p !== "org:delete" && p !== "billing:manage"),
  billing: [
    "org:read",
    "member:read",
    "workspace:read",
    "billing:read",
    "billing:manage",
    "license:read",
  ],
  // Read-only compliance role: sees everything, can export audit, changes nothing.
  auditor: [
    "org:read",
    "member:read",
    "team:read",
    "workspace:read",
    "memory:read",
    "apikey:read",
    "billing:read",
    "audit:read",
    "audit:export",
    "sso:read",
    "governance:read",
    "redaction:read",
    "license:read",
  ],
  member: [
    "org:read",
    "member:read",
    "team:read",
    "workspace:read",
    "workspace:write",
    "memory:read",
    "memory:write",
    "apikey:read",
    "apikey:write",
  ],
  viewer: ["org:read", "member:read", "team:read", "workspace:read", "memory:read"],
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Roles that may administer other members (invite/update/remove). */
export function canManageMembers(role: Role): boolean {
  return roleHasPermission(role, "member:invite");
}
