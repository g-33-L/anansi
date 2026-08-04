import crypto from "crypto";
import { eq, and, lt, isNull, gt } from "drizzle-orm";
import { db } from "../db/index.js";
import { dashboardTokens } from "../db/schema.js";

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function generateDashboardToken(workspaceId: string): Promise<string> {
  // Purge expired tokens for this workspace first
  await db
    .delete(dashboardTokens)
    .where(
      and(
        eq(dashboardTokens.workspaceId, workspaceId),
        lt(dashboardTokens.expiresAt, new Date())
      )
    );

  const raw = crypto.randomBytes(32).toString("hex");
  const hash = hashToken(raw);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db.insert(dashboardTokens).values({ workspaceId, tokenHash: hash, expiresAt });

  return raw;
}

export async function validateDashboardToken(
  raw: string
): Promise<string | null> {
  const hash = hashToken(raw);

  // Atomic single-use consumption — SELECT+UPDATE would have a TOCTOU race
  const [row] = await db
    .update(dashboardTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(dashboardTokens.tokenHash, hash),
        isNull(dashboardTokens.usedAt),
        gt(dashboardTokens.expiresAt, new Date()),
      )
    )
    .returning({ workspaceId: dashboardTokens.workspaceId });

  return row?.workspaceId ?? null;
}
