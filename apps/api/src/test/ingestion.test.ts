import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { db, closePool } from "../lib/db/index.js";
import {
  developerAccounts,
  memoryChunks,
  memoryUsers,
  workspaces,
} from "../lib/db/schema.js";
import { cleanDatabase } from "./setup.js";
import { maybeTriggerSynthesis, maybeTriggerUserSynthesis } from "../workers/ingestion.js";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// vi.mock factories are hoisted above variable declarations, so we cannot
// reference a const defined in this file from inside a factory. Use vi.fn()
// inline and access the reference via the mocked import after the fact.
vi.mock("../lib/infra/queue.js", () => ({
  redis: {},
  synthesisQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));
// Avoid Slack API calls and crypto setup during module load.
vi.mock("../lib/utils/crypto.js", () => ({ decrypt: vi.fn((x: string) => x) }));
vi.mock("../lib/integrations/slack-client.js", () => ({ downloadSlackFile: vi.fn() }));
vi.mock("../lib/integrations/slack-memory-user.js", () => ({
  resolveSlackMemoryUserId: vi.fn().mockResolvedValue(null),
}));

import { synthesisQueue } from "../lib/infra/queue.js";
const queueAdd = synthesisQueue.add as any;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SYNTHESIS_THRESHOLD = parseInt(process.env.SYNTHESIS_THRESHOLD ?? "25", 10);
const USER_SYNTHESIS_THRESHOLD = parseInt(process.env.USER_SYNTHESIS_THRESHOLD ?? "10", 10);

let workspaceId: string;
let memoryUserId: string;

beforeEach(async () => {
  await cleanDatabase();
  queueAdd.mockClear();

  const [ws] = await db.insert(workspaces).values({}).returning({ id: workspaces.id });
  workspaceId = ws.id;
  const [dev] = await db
    .insert(developerAccounts)
    .values({ workspaceId, name: "Test Dev", email: "ingest@test.com" })
    .returning({ id: developerAccounts.id });
  const [user] = await db
    .insert(memoryUsers)
    .values({ developerId: dev.id, externalId: "ingest_user" })
    .returning({ id: memoryUsers.id });
  memoryUserId = user.id;
});

afterAll(closePool);

async function seedChunks(
  count: number,
  opts: {
    synthesized?: boolean;
    memoryUserId?: string | null;
    userSynthesized?: boolean;
  } = {}
) {
  const values = Array.from({ length: count }, (_, i) => ({
    workspaceId,
    sourceType: "message" as const,
    sourceId: `msg:C1:${i}:${Math.random()}`,
    content: `message ${i}`,
    metadata: { author: "Alice", authorId: "U1", timestamp: `${i}.0`, channelName: "general" },
    ...opts,
  }));
  await db.insert(memoryChunks).values(values);
}

// ─── Team synthesis trigger ───────────────────────────────────────────────────

describe("maybeTriggerSynthesis", () => {
  it("does not enqueue below the threshold", async () => {
    await seedChunks(SYNTHESIS_THRESHOLD - 1);
    await maybeTriggerSynthesis(workspaceId);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("enqueues a synthesize job exactly at the threshold", async () => {
    await seedChunks(SYNTHESIS_THRESHOLD);
    await maybeTriggerSynthesis(workspaceId);
    expect(queueAdd).toHaveBeenCalledOnce();
    expect(queueAdd).toHaveBeenCalledWith(
      "synthesize",
      { workspaceId },
      { jobId: `synthesis-${workspaceId}` }
    );
  });

  it("counts Slack chunks (memoryUserId set) toward the threshold", async () => {
    // One short of threshold using plain chunks, then one Slack chunk tips it over.
    await seedChunks(SYNTHESIS_THRESHOLD - 1);
    await seedChunks(1, { memoryUserId });
    await maybeTriggerSynthesis(workspaceId);
    expect(queueAdd).toHaveBeenCalledOnce();
  });

  it("does not count already-synthesized chunks", async () => {
    await seedChunks(SYNTHESIS_THRESHOLD, { synthesized: true });
    await maybeTriggerSynthesis(workspaceId);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("counts only unsynthesized chunks when a mix exists", async () => {
    await seedChunks(SYNTHESIS_THRESHOLD - 1, { synthesized: true }); // already done
    await seedChunks(SYNTHESIS_THRESHOLD - 1);                         // pending, but still below threshold
    await maybeTriggerSynthesis(workspaceId);
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

// ─── Per-user synthesis trigger ───────────────────────────────────────────────

describe("maybeTriggerUserSynthesis", () => {
  it("does not enqueue below the user threshold", async () => {
    await seedChunks(USER_SYNTHESIS_THRESHOLD - 1, { memoryUserId, userSynthesized: false });
    await maybeTriggerUserSynthesis(workspaceId, memoryUserId);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("enqueues a synthesize-user job exactly at the user threshold", async () => {
    await seedChunks(USER_SYNTHESIS_THRESHOLD, { memoryUserId, userSynthesized: false });
    await maybeTriggerUserSynthesis(workspaceId, memoryUserId);
    expect(queueAdd).toHaveBeenCalledOnce();
    expect(queueAdd).toHaveBeenCalledWith(
      "synthesize-user",
      { memoryUserId, workspaceId },
      { jobId: `synthesis-user-${memoryUserId}` }
    );
  });

  it("does not count already-user-synthesized chunks", async () => {
    await seedChunks(USER_SYNTHESIS_THRESHOLD, { memoryUserId, userSynthesized: true });
    await maybeTriggerUserSynthesis(workspaceId, memoryUserId);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("only counts chunks attributed to the specific user, not other users' chunks", async () => {
    const [dev2] = await db
      .insert(developerAccounts)
      .values({ name: "Dev2", email: "dev2@test.com" }) // API-only — no workspaceId
      .returning({ id: developerAccounts.id });
    const [otherUser] = await db
      .insert(memoryUsers)
      .values({ developerId: dev2.id, externalId: "other_user" })
      .returning({ id: memoryUsers.id });

    // Other user has enough chunks — target user does not.
    await seedChunks(USER_SYNTHESIS_THRESHOLD, { memoryUserId: otherUser.id, userSynthesized: false });
    await seedChunks(USER_SYNTHESIS_THRESHOLD - 1, { memoryUserId, userSynthesized: false });

    await maybeTriggerUserSynthesis(workspaceId, memoryUserId);
    expect(queueAdd).not.toHaveBeenCalled();
  });
});
