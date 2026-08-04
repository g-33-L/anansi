/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

/*
 * SCIM 2.0 provisioning logic (Phase 7). Maps the SCIM resource model onto the
 * identity schema, scoped to ONE org (resolved from the SCIM token):
 *   User  ↔ users + memberships   (deprovision = suspend the membership, not the
 *                                   global user, who may belong to other orgs)
 *   Group ↔ teams
 *
 * Handlers return { status, body } so the route stays a thin HTTP adapter. Bodies
 * follow the SCIM schemas; errors use urn:...:Error.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { memberships, users, type Membership, type User } from "../../db/schema.js";
import { findOrCreateUserByEmail } from "../../identity/users.js";
import { getMembership, addMember, listMembers } from "../../identity/memberships.js";
import { listTeams, createTeam } from "../../identity/teams.js";

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

export interface ScimResult {
  status: number;
  body: unknown;
}

const err = (status: number, detail: string): ScimResult => ({
  status,
  body: { schemas: [ERROR_SCHEMA], status: String(status), detail },
});

// Accepts the projected user shape from listMembers (no createdAt/lastLoginAt) as
// well as a full User row — SCIM only needs id/email/name/status here.
type ScimUserFields = Pick<User, "id" | "email" | "name">;

function userResource(user: ScimUserFields, membership: Membership) {
  return {
    schemas: [USER_SCHEMA],
    id: user.id,
    userName: user.email,
    name: { formatted: user.name ?? user.email },
    emails: [{ value: user.email, primary: true }],
    active: membership.status === "active",
    meta: { resourceType: "User", location: `/scim/v2/Users/${user.id}` },
  };
}

// SCIM filters we support: `userName eq "x"` / `emails.value eq "x"`. Anything
// else is ignored (returns the full list), which is spec-compliant for unknown filters.
function parseEqFilter(filter: string | undefined): string | null {
  if (!filter) return null;
  const m = filter.match(/(?:userName|emails\.value)\s+eq\s+"([^"]+)"/i);
  return m ? m[1].toLowerCase() : null;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function scimListUsers(orgId: string, filter?: string): Promise<ScimResult> {
  const wanted = parseEqFilter(filter);
  const rows = await listMembers(orgId);
  const matched = wanted ? rows.filter((r) => r.user.email.toLowerCase() === wanted) : rows;
  return {
    status: 200,
    body: {
      schemas: [LIST_SCHEMA],
      totalResults: matched.length,
      startIndex: 1,
      itemsPerPage: matched.length,
      Resources: matched.map((r) => userResource(r.user, r.membership)),
    },
  };
}

export async function scimGetUser(orgId: string, userId: string): Promise<ScimResult> {
  const membership = await getMembership(userId, orgId);
  if (!membership) return err(404, "user not found in organization");
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return err(404, "user not found");
  return { status: 200, body: userResource(user, membership) };
}

interface ScimUserBody {
  userName?: string;
  emails?: { value?: string; primary?: boolean }[];
  name?: { formatted?: string; givenName?: string; familyName?: string };
  active?: boolean;
}

function emailFrom(body: ScimUserBody): string | null {
  if (typeof body.userName === "string" && body.userName.includes("@")) return body.userName.toLowerCase();
  const primary = body.emails?.find((e) => e.primary) ?? body.emails?.[0];
  return primary?.value ? primary.value.toLowerCase() : null;
}

export async function scimCreateUser(orgId: string, body: ScimUserBody): Promise<ScimResult> {
  const email = emailFrom(body);
  if (!email) return err(400, "userName or a primary email is required");
  const name = body.name?.formatted ?? null;
  const user = await findOrCreateUserByEmail(email, name);

  const existing = await getMembership(user.id, orgId);
  if (existing) {
    // Idempotent: SCIM create on an existing member returns the current resource.
    return { status: 200, body: userResource(user, existing) };
  }
  const membership = await addMember({ userId: user.id, organizationId: orgId, role: "viewer" });
  return { status: 201, body: userResource(user, membership) };
}

async function setMembershipActive(orgId: string, userId: string, active: boolean): Promise<Membership | null> {
  const [row] = await db
    .update(memberships)
    .set({ status: active ? "active" : "suspended" })
    .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, orgId)))
    .returning();
  return row ?? null;
}

// Supports PATCH (active toggle) and PUT (replace). We only act on `active` — role
// stays under org control, never dictated by the IdP replace payload.
export async function scimPatchUser(
  orgId: string,
  userId: string,
  body: { Operations?: { op?: string; path?: string; value?: unknown }[]; active?: boolean }
): Promise<ScimResult> {
  let active: boolean | undefined = typeof body.active === "boolean" ? body.active : undefined;
  for (const op of body.Operations ?? []) {
    if ((op.path === "active" || !op.path) && typeof op.value === "object" && op.value) {
      const v = (op.value as { active?: boolean }).active;
      if (typeof v === "boolean") active = v;
    }
    if (op.path === "active" && typeof op.value === "boolean") active = op.value;
  }
  if (active === undefined) return scimGetUser(orgId, userId);
  const membership = await setMembershipActive(orgId, userId, active);
  if (!membership) return err(404, "user not found in organization");
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return err(404, "user not found");
  return { status: 200, body: userResource(user, membership) };
}

export async function scimDeleteUser(orgId: string, userId: string): Promise<ScimResult> {
  // Deprovision = suspend the org membership (not a global user delete).
  const membership = await setMembershipActive(orgId, userId, false);
  if (!membership) return err(404, "user not found in organization");
  return { status: 204, body: null };
}

// ── Groups (→ teams) ────────────────────────────────────────────────────────

export async function scimListGroups(orgId: string): Promise<ScimResult> {
  const teams = await listTeams(orgId);
  return {
    status: 200,
    body: {
      schemas: [LIST_SCHEMA],
      totalResults: teams.length,
      startIndex: 1,
      itemsPerPage: teams.length,
      Resources: teams.map((t) => ({
        schemas: [GROUP_SCHEMA],
        id: t.id,
        displayName: t.name,
        meta: { resourceType: "Group", location: `/scim/v2/Groups/${t.id}` },
      })),
    },
  };
}

export async function scimCreateGroup(
  orgId: string,
  body: { displayName?: string }
): Promise<ScimResult> {
  const name = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!name) return err(400, "displayName is required");
  const team = await createTeam(orgId, name);
  return {
    status: 201,
    body: { schemas: [GROUP_SCHEMA], id: team.id, displayName: team.name, meta: { resourceType: "Group" } },
  };
}
