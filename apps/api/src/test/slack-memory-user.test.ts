import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, developerAccounts, memoryUsers, memoryChunks, staticDocuments, entityNodes } from "../lib/db/schema.js";
import { cleanDatabase } from "./setup.js";
import {
  getWorkspaceDeveloperId,
  resolveSlackMemoryUserId,
  findSlackMemoryUser,
  setSlackUserOptOut,
  _clearSlackMemoryUserCaches,
} from "../lib/integrations/slack-memory-user.js";

// ─── Slack ⇄ per-user memory bridge ───────────────────────────────────────────
// Provisions the developer account + memory_users that let Slack messages flow
// into the same per-user synthesis / entity-graph machinery as the developer API.

let workspaceId: string;

beforeEach(async () => {
  await cleanDatabase();
  _clearSlackMemoryUserCaches();
  const [ws] = await db
    .insert(workspaces)
    .values({ slackTeamId: "TBRIDGE", slackBotToken: "enc", slackTeamName: "Bridge Team" })
    .returning({ id: workspaces.id });
  workspaceId = ws.id;
});

afterAll(closePool);

describe("getWorkspaceDeveloperId", () => {
  it("provisions a developer account for a Slack workspace, idempotently", async () => {
    const id1 = await getWorkspaceDeveloperId(workspaceId, "Bridge Team");
    const id2 = await getWorkspaceDeveloperId(workspaceId, "Bridge Team");
    expect(id1).toBe(id2);

    const rows = await db.select().from(developerAccounts).where(eq(developerAccounts.workspaceId, workspaceId));
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(`slack:${workspaceId}@workspaces.anansi`);
    expect(rows[0].name).toBe("Bridge Team");
  });

  it("does not create a duplicate when the cache is cold but the row exists", async () => {
    const id1 = await getWorkspaceDeveloperId(workspaceId, "Bridge Team");
    _clearSlackMemoryUserCaches(); // simulate a fresh worker process
    const id2 = await getWorkspaceDeveloperId(workspaceId, "Bridge Team");
    expect(id2).toBe(id1);
    const rows = await db.select().from(developerAccounts).where(eq(developerAccounts.workspaceId, workspaceId));
    expect(rows).toHaveLength(1);
  });
});

describe("resolveSlackMemoryUserId", () => {
  it("maps a Slack user to a memory_user keyed by their Slack id", async () => {
    const memId = await resolveSlackMemoryUserId(workspaceId, "U123", "Bridge Team");
    expect(memId).toBeTruthy();

    const developerId = await getWorkspaceDeveloperId(workspaceId);
    const rows = await db
      .select()
      .from(memoryUsers)
      .where(and(eq(memoryUsers.developerId, developerId), eq(memoryUsers.externalId, "U123")));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(memId);
  });

  it("is idempotent and stable across a cold cache (no duplicate users)", async () => {
    const a = await resolveSlackMemoryUserId(workspaceId, "U123", "Bridge Team");
    _clearSlackMemoryUserCaches();
    const b = await resolveSlackMemoryUserId(workspaceId, "U123", "Bridge Team");
    expect(b).toBe(a);

    const developerId = await getWorkspaceDeveloperId(workspaceId);
    const rows = await db
      .select()
      .from(memoryUsers)
      .where(and(eq(memoryUsers.developerId, developerId), eq(memoryUsers.externalId, "U123")));
    expect(rows).toHaveLength(1);
  });

  it("distinct Slack users get distinct memory users", async () => {
    const a = await resolveSlackMemoryUserId(workspaceId, "U111", "Bridge Team");
    const b = await resolveSlackMemoryUserId(workspaceId, "U222", "Bridge Team");
    expect(a).not.toBe(b);
  });

  it("returns null for missing or unknown authors", async () => {
    expect(await resolveSlackMemoryUserId(workspaceId, undefined, "Bridge Team")).toBeNull();
    expect(await resolveSlackMemoryUserId(workspaceId, "unknown", "Bridge Team")).toBeNull();
  });

  it("scopes the same Slack user id separately per workspace", async () => {
    const [ws2] = await db
      .insert(workspaces)
      .values({ slackTeamId: "TBRIDGE2", slackBotToken: "enc", slackTeamName: "Other Team" })
      .returning({ id: workspaces.id });

    const inA = await resolveSlackMemoryUserId(workspaceId, "U123", "Bridge Team");
    const inB = await resolveSlackMemoryUserId(ws2.id, "U123", "Other Team");
    expect(inA).not.toBe(inB);
  });
});

describe("privacy opt-out", () => {
  it("opting out purges personal memory but keeps chunks in the team profile", async () => {
    const memId = (await resolveSlackMemoryUserId(workspaceId, "U777", "Bridge Team"))!;
    // Seed personal artifacts: a chunk, a personal profile, an entity node.
    await db.insert(memoryChunks).values({
      workspaceId, memoryUserId: memId, sourceType: "message", sourceId: "msg:C1:1.0",
      content: "hello team", metadata: { author: "Al", authorId: "U777", timestamp: "1.0", channelName: "general" },
    });
    await db.insert(staticDocuments).values({ memoryUserId: memId, staticFacts: ["likes TS"], dynamicContext: [] });
    const developerId = await getWorkspaceDeveloperId(workspaceId);
    await db.insert(entityNodes).values({ developerId, memoryUserId: memId, entityType: "person", name: "Al" });

    await setSlackUserOptOut(workspaceId, "U777", true);

    // Personal profile + entity graph gone
    expect(await db.select().from(staticDocuments).where(eq(staticDocuments.memoryUserId, memId))).toHaveLength(0);
    expect(await db.select().from(entityNodes).where(eq(entityNodes.memoryUserId, memId))).toHaveLength(0);

    // Chunk stays in the workspace (team) memory, detached from the person
    const chunks = await db.select().from(memoryChunks).where(eq(memoryChunks.workspaceId, workspaceId));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].memoryUserId).toBeNull();
    expect(chunks[0].userSynthesized).toBe(true);
  });

  it("after opt-out, attribution returns null (even on a cold cache)", async () => {
    await resolveSlackMemoryUserId(workspaceId, "U888", "Bridge Team");
    await setSlackUserOptOut(workspaceId, "U888", true);
    _clearSlackMemoryUserCaches();
    expect(await resolveSlackMemoryUserId(workspaceId, "U888", "Bridge Team")).toBeNull();
    const mu = await findSlackMemoryUser(workspaceId, "U888");
    expect(mu?.optedOut).toBe(true);
  });

  it("remember-me re-enables attribution", async () => {
    const id = await resolveSlackMemoryUserId(workspaceId, "U999", "Bridge Team");
    await setSlackUserOptOut(workspaceId, "U999", true);
    _clearSlackMemoryUserCaches();
    expect(await resolveSlackMemoryUserId(workspaceId, "U999", "Bridge Team")).toBeNull();

    await setSlackUserOptOut(workspaceId, "U999", false);
    _clearSlackMemoryUserCaches();
    expect(await resolveSlackMemoryUserId(workspaceId, "U999", "Bridge Team")).toBe(id);
  });

  it("opt-out before first message blocks attribution for an unseen user", async () => {
    await setSlackUserOptOut(workspaceId, "Unew", true);
    expect(await resolveSlackMemoryUserId(workspaceId, "Unew", "Bridge Team")).toBeNull();
  });
});
