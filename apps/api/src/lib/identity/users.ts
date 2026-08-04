/*
 * User repo — the auth principals of the product (distinct from `memory_users`,
 * which are the subjects memory is *about*).
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, type User } from "../db/schema.js";

function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.email, normalizeEmail(email)) });
}

export async function findUserById(id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

/** Race-safe find-or-create by email. */
export async function findOrCreateUserByEmail(email: string, name?: string | null): Promise<User> {
  const normalized = normalizeEmail(email);
  const existing = await findUserByEmail(normalized);
  if (existing) return existing;
  await db.insert(users).values({ email: normalized, name: name ?? null }).onConflictDoNothing();
  const created = await findUserByEmail(normalized);
  if (!created) throw new Error("findOrCreateUserByEmail: user missing after insert");
  return created;
}

export async function updateProfile(
  userId: string,
  patch: { name?: string; avatarUrl?: string }
): Promise<User | undefined> {
  const set: Partial<Pick<User, "name" | "avatarUrl">> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;
  if (Object.keys(set).length === 0) return findUserById(userId);
  const [row] = await db.update(users).set(set).where(eq(users.id, userId)).returning();
  return row;
}

export async function touchLastLogin(userId: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}
