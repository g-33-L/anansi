import { createHash } from "crypto";
import { redis } from "./queue.js";
import type { UserContextResponse } from "../ai/query-engine.js";

const CONTEXT_TTL_SECONDS = 60;
const KEY_PREFIX = "ctx:";

// `variant` encodes everything that changes the response for a given user:
// q plus retrieval params (alpha, threshold, filters, sessionId). Callers build
// it via a canonical JSON string; undefined = plain profile request.
function cacheKey(developerId: string, memoryUserId: string, variant: string | undefined): string {
  const qHash = variant ? createHash("sha256").update(variant).digest("hex").slice(0, 12) : "noq";
  return `${KEY_PREFIX}${developerId}:${memoryUserId}:${qHash}`;
}

export async function getCachedContext(
  developerId: string,
  memoryUserId: string,
  variant: string | undefined
): Promise<UserContextResponse | null> {
  const key = cacheKey(developerId, memoryUserId, variant);
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserContextResponse;
    } catch {
      // Corrupted entry — evict so the next request gets a fresh value
      redis.del(key).catch(() => undefined);
      return null;
    }
  } catch {
    return null;
  }
}

export async function setCachedContext(
  developerId: string,
  memoryUserId: string,
  variant: string | undefined,
  value: UserContextResponse
): Promise<void> {
  try {
    await redis.set(
      cacheKey(developerId, memoryUserId, variant),
      JSON.stringify(value),
      "EX",
      CONTEXT_TTL_SECONDS
    );
  } catch {
    // Cache write failures are non-fatal
  }
}

// ─── Workspace-level profile cache (GET /v1/context?scope=workspace) ─────────
// The team-wide synthesized profile costs an LLM call to build, so it gets a
// longer TTL than per-user context. Keyed on developerId only by design.

const WORKSPACE_PROFILE_TTL_SECONDS = 300; // 5 minutes
const WORKSPACE_KEY_PREFIX = "ctxws:";

export interface CachedWorkspaceProfile {
  static: string[];
  dynamic: string[];
}

export async function getCachedWorkspaceProfile(
  developerId: string
): Promise<CachedWorkspaceProfile | null> {
  const key = `${WORKSPACE_KEY_PREFIX}${developerId}`;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedWorkspaceProfile;
    } catch {
      redis.del(key).catch(() => undefined);
      return null;
    }
  } catch {
    return null;
  }
}

export async function setCachedWorkspaceProfile(
  developerId: string,
  value: CachedWorkspaceProfile
): Promise<void> {
  try {
    await redis.set(
      `${WORKSPACE_KEY_PREFIX}${developerId}`,
      JSON.stringify(value),
      "EX",
      WORKSPACE_PROFILE_TTL_SECONDS
    );
  } catch {
    // Cache write failures are non-fatal
  }
}

// Drops the team-wide profile so it is re-synthesized without a deleted user's
// facts. Cheap single-key delete — safe to call on every full user wipe.
export async function invalidateWorkspaceProfileCache(developerId: string): Promise<void> {
  try {
    await redis.del(`${WORKSPACE_KEY_PREFIX}${developerId}`);
  } catch {
    // Non-fatal
  }
}

export async function invalidateUserCache(memoryUserId: string): Promise<void> {
  try {
    const pattern = `${KEY_PREFIX}*:${memoryUserId}:*`;
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      if (keys.length > 0) await redis.del(...(keys as string[]));
    } while (cursor !== "0");
  } catch {
    // Non-fatal
  }
}
