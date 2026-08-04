/*
 * User sessions for the /console product app — server-side, hashed-cookie sessions
 * (distinct from bearer ans_ API keys). Mirrors the dashboard-auth token pattern:
 * a random token is issued to the client; only its SHA-256 hash is stored.
 */
import crypto from "crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { userSessions, users, type User, type UserSession } from "../db/schema.js";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function hashSessionToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/** Issues a session and returns the RAW token (store only its hash). */
export async function createSession(
  userId: string,
  activeOrganizationId: string | null
): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(userSessions).values({
    userId,
    tokenHash: hashSessionToken(raw),
    activeOrganizationId,
    expiresAt,
  });
  return raw;
}

export interface ValidatedSession {
  user: User;
  session: UserSession;
}

/** Validates a raw session token → active user + session, or null. */
export async function validateSession(
  raw: string | null | undefined
): Promise<ValidatedSession | null> {
  if (!raw) return null;
  const [session] = await db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.tokenHash, hashSessionToken(raw)), gt(userSessions.expiresAt, new Date())))
    .limit(1);
  if (!session) return null;

  const user = await db.query.users.findFirst({ where: eq(users.id, session.userId) });
  if (!user || user.status !== "active") return null;

  // Non-blocking activity touch.
  db.update(userSessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(userSessions.id, session.id))
    .catch((err) => console.error("[session] lastSeenAt touch failed:", (err as Error).message));

  return { user, session };
}

export async function revokeSession(raw: string): Promise<void> {
  await db.delete(userSessions).where(eq(userSessions.tokenHash, hashSessionToken(raw)));
}

export async function setActiveOrganization(sessionId: string, organizationId: string): Promise<void> {
  await db.update(userSessions).set({ activeOrganizationId: organizationId }).where(eq(userSessions.id, sessionId));
}
