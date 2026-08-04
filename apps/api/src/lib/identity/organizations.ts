/*
 * Organization repo — the account boundary. Creating an org always bootstraps an
 * owner membership so an org is never ownerless.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { organizations, memberships, type Organization } from "../db/schema.js";
import type { Role } from "./roles.js";

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "org";
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 1;
  // Bounded probe; org creation is rare so the extra reads are fine.
  while (await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

export async function createOrganization(input: {
  name: string;
  ownerUserId: string;
  edition?: string;
}): Promise<Organization> {
  const slug = await uniqueSlug(slugify(input.name));
  const [org] = await db
    .insert(organizations)
    .values({ name: input.name, slug, edition: input.edition ?? "cloud" })
    .returning();
  await db
    .insert(memberships)
    .values({ userId: input.ownerUserId, organizationId: org.id, role: "owner" })
    .onConflictDoNothing();
  return org;
}

export async function getOrganization(id: string): Promise<Organization | undefined> {
  return db.query.organizations.findFirst({ where: eq(organizations.id, id) });
}

export interface OrganizationWithRole extends Organization {
  role: Role;
}

/** Orgs the user is an active member of, with their role in each. */
export async function listOrganizationsForUser(userId: string): Promise<OrganizationWithRole[]> {
  const rows = await db
    .select({ org: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
    .orderBy(asc(organizations.name));
  return rows.map((r) => ({ ...r.org, role: r.role as Role }));
}

export async function updateOrganization(
  id: string,
  patch: { name?: string }
): Promise<Organization | undefined> {
  if (patch.name === undefined) return getOrganization(id);
  const [row] = await db
    .update(organizations)
    .set({ name: patch.name, updatedAt: new Date() })
    .where(eq(organizations.id, id))
    .returning();
  return row;
}
