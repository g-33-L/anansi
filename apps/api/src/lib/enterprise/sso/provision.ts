/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

/*
 * JIT (just-in-time) provisioning for SSO logins (Phase 7). Given a verified
 * identity from the IdP, ensure a `users` row and an active `memberships` row in
 * the target org, then mint a /console session. The IdP's group claims are mapped
 * to a membership role via the connection's group_role_map (default: viewer).
 */
import { findOrCreateUserByEmail, touchLastLogin } from "../../identity/users.js";
import { getMembership, addMember } from "../../identity/memberships.js";
import { createSession } from "../../identity/session.js";
import { isRole, type Role } from "../../identity/roles.js";

export interface SsoIdentity {
  email: string;
  name?: string | null;
  groups?: string[];
}

/** Resolve an IdP group set → membership role via the org's map (first match wins). */
export function roleFromGroups(
  groups: string[] | undefined,
  groupRoleMap: Record<string, string>
): Role {
  for (const g of groups ?? []) {
    const mapped = groupRoleMap[g];
    if (mapped && isRole(mapped)) return mapped;
  }
  return "viewer"; // least privilege default
}

export interface ProvisionResult {
  userId: string;
  rawSession: string;
}

/**
 * Provision (or update) the user + membership for an SSO login and open a session
 * scoped to the org. Existing members keep their current role — SSO never silently
 * downgrades an admin; group→role mapping only applies when first adding a member.
 */
export async function provisionSsoLogin(input: {
  organizationId: string;
  identity: SsoIdentity;
  groupRoleMap: Record<string, string>;
}): Promise<ProvisionResult> {
  const email = input.identity.email.trim().toLowerCase();
  const user = await findOrCreateUserByEmail(email, input.identity.name ?? null);

  const existing = await getMembership(user.id, input.organizationId);
  if (!existing) {
    const role = roleFromGroups(input.identity.groups, input.groupRoleMap);
    await addMember({ userId: user.id, organizationId: input.organizationId, role });
  }

  await touchLastLogin(user.id);
  const rawSession = await createSession(user.id, input.organizationId);
  return { userId: user.id, rawSession };
}
