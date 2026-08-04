import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import crypto from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { createApp } from "../app.js";
import { db, closePool } from "../lib/db/index.js";
import { workspaces, channels, memoryChunks } from "../lib/db/schema.js";
import { cleanDatabase } from "./setup.js";
import { encrypt } from "../lib/utils/crypto.js";
import { queryWorkspace } from "../lib/ai/query-engine.js";
import { postMessage, postToResponseUrl } from "../lib/integrations/slack-api.js";

vi.mock("../lib/ai/query-engine.js", () => ({ queryWorkspace: vi.fn() }));
vi.mock("../lib/integrations/slack-api.js", () => ({
  postMessage: vi.fn().mockResolvedValue(undefined),
  postToResponseUrl: vi.fn().mockResolvedValue(undefined),
}));
// Prevent real DB writes from fire-and-forget usage tracking, which races with
// cleanDatabase()'s TRUNCATE workspaces CASCADE and causes deadlocks in tests.
// Path must match slack.ts's import ("../lib/billing/usage.js") — when this was
// stale ("../lib/usage.js") the real DB-hitting incrementQueryIfUnderLimit ran in
// the background and didn't resolve within the test's single setImmediate tick,
// so postMessage/postToResponseUrl appeared never to be called.
vi.mock("../lib/billing/usage.js", () => ({
  incrementQueryIfUnderLimit: vi.fn().mockResolvedValue({ allowed: true, current: 0, limit: 50, plan: "free" }),
  incrementMessages: vi.fn().mockResolvedValue(undefined),
  checkAndIncrementApiCall: vi.fn().mockResolvedValue({ allowed: true }),
  getUsageSummary: vi.fn().mockResolvedValue({
    plan: "free",
    month: "2026-06",
    queries: { used: 0, limit: 50 },
    messages: { used: 0, limit: 1000 },
    channels: { used: 0, limit: 2 },
  }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;

function slackSignature(timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`;
  return "v0=" + crypto.createHmac("sha256", SIGNING_SECRET).update(base).digest("hex");
}

async function postSlackEvent(body: string, options: { badSig?: boolean } = {}) {
  const app = createApp();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sig = options.badSig ? "v0=badhash" : slackSignature(timestamp, body);

  return app.fetch(
    new Request("http://localhost/slack/events", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-slack-signature": sig,
        "x-slack-request-timestamp": timestamp,
      },
    })
  );
}

async function postSlackCommand(
  params: Record<string, string>,
  options: { badSig?: boolean; oldTimestamp?: boolean } = {}
) {
  const app = createApp();
  const body = new URLSearchParams(params).toString();
  const timestamp = options.oldTimestamp
    ? Math.floor(Date.now() / 1000 - 400).toString()
    : Math.floor(Date.now() / 1000).toString();
  const sig = options.badSig ? "v0=badhash" : slackSignature(timestamp, body);

  return app.fetch(
    new Request("http://localhost/slack/commands", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-signature": sig,
        "x-slack-request-timestamp": timestamp,
      },
    })
  );
}

afterAll(closePool);

// ─── Slack Events API ─────────────────────────────────────────────────────────

describe("Slack Events API", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanDatabase();
  });

  // ── test:1 ─────────────────────────────────────────────────────────────────

  it("rejects requests with an invalid Slack signature", async () => {
    const body = JSON.stringify({ type: "event_callback", team_id: "T123", event: { type: "message" } });
    const res = await postSlackEvent(body, { badSig: true });
    expect(res.status).toBe(401);
  });

  // ── test:2 ─────────────────────────────────────────────────────────────────

  it("responds to url_verification with the challenge value", async () => {
    const challenge = "3eZbrw1aBm2rZgRNFdxV2595E9CY3gmdALWMmHkvFXO7tYXAYM8P";
    const body = JSON.stringify({ type: "url_verification", challenge });
    const res = await postSlackEvent(body);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { challenge: string };
    expect(json.challenge).toBe(challenge);
  });

  // ── test:3 ─────────────────────────────────────────────────────────────────

  it("memory chunks are isolated between workspaces", async () => {
    const [wsA] = await db
      .insert(workspaces)
      .values({ slackTeamId: "TA", slackBotToken: "enc-a", slackTeamName: "Team A" })
      .returning({ id: workspaces.id });
    const [wsB] = await db
      .insert(workspaces)
      .values({ slackTeamId: "TB", slackBotToken: "enc-b", slackTeamName: "Team B" })
      .returning({ id: workspaces.id });

    const [chA] = await db
      .insert(channels)
      .values({ workspaceId: wsA.id, slackChannelId: "CA1", name: "general" })
      .returning({ id: channels.id });
    const [chB] = await db
      .insert(channels)
      .values({ workspaceId: wsB.id, slackChannelId: "CB1", name: "general" })
      .returning({ id: channels.id });

    await db.insert(memoryChunks).values([
      {
        workspaceId: wsA.id,
        channelId: chA.id,
        sourceType: "message",
        sourceId: "msg:CA1:001",
        content: "Team A decision: use PostgreSQL",
        metadata: { author: "alice", authorId: "UA1", timestamp: "1000.0", channelName: "general" },
      },
      {
        workspaceId: wsB.id,
        channelId: chB.id,
        sourceType: "message",
        sourceId: "msg:CB1:001",
        content: "Team B decision: use MongoDB",
        metadata: { author: "bob", authorId: "UB1", timestamp: "2000.0", channelName: "general" },
      },
    ]);

    const result = await db
      .select({ id: memoryChunks.id, workspaceId: memoryChunks.workspaceId })
      .from(memoryChunks)
      .where(eq(memoryChunks.workspaceId, wsA.id));

    expect(result).toHaveLength(1);
    expect(result[0].workspaceId).toBe(wsA.id);
    expect(result.some((r) => r.workspaceId === wsB.id)).toBe(false);
  });

  // ── test:4 ─────────────────────────────────────────────────────────────────

  it("deduplicates identical Slack events — ON CONFLICT DO NOTHING", async () => {
    const [ws] = await db
      .insert(workspaces)
      .values({ slackTeamId: "TDEDUP", slackBotToken: "enc-x", slackTeamName: "Dedup Team" })
      .returning({ id: workspaces.id });

    const [ch] = await db
      .insert(channels)
      .values({ workspaceId: ws.id, slackChannelId: "CD1", name: "general" })
      .returning({ id: channels.id });

    const sourceId = "msg:CD1:1700000000.000100";
    const base = {
      workspaceId: ws.id,
      channelId: ch.id,
      sourceType: "message" as const,
      sourceId,
      metadata: { author: "alice", authorId: "UA1", timestamp: "1700000000.000100", channelName: "general" },
    };

    await db.insert(memoryChunks).values({ ...base, content: "first insert" }).onConflictDoNothing();
    await db.insert(memoryChunks).values({ ...base, content: "duplicate insert" }).onConflictDoNothing();

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(memoryChunks)
      .where(
        and(
          eq(memoryChunks.workspaceId, ws.id),
          eq(memoryChunks.sourceId, sourceId)
        )
      );

    expect(count).toBe(1);
  });
});

// ─── Slack /commands endpoint ─────────────────────────────────────────────────

describe("Slack /commands endpoint", () => {
  let teamId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanDatabase();
    teamId = "TCMD";
    await db
      .insert(workspaces)
      .values({ slackTeamId: teamId, slackBotToken: "enc-cmd", slackTeamName: "CMD Team" });
  });

  // ── test:5 ─────────────────────────────────────────────────────────────────

  it("rejects /commands with an invalid signature", async () => {
    const res = await postSlackCommand(
      { command: "/ask", text: "hello", team_id: teamId, response_url: "https://hooks.slack.com/x" },
      { badSig: true }
    );
    expect(res.status).toBe(401);
  });

  // ── test:6 ─────────────────────────────────────────────────────────────────

  it("rejects /commands with a timestamp older than 5 minutes", async () => {
    const res = await postSlackCommand(
      { command: "/ask", text: "hello", team_id: teamId, response_url: "https://hooks.slack.com/x" },
      { oldTimestamp: true }
    );
    expect(res.status).toBe(401);
  });

  // ── test:7 ─────────────────────────────────────────────────────────────────

  it("returns not-connected message for an unregistered workspace", async () => {
    const res = await postSlackCommand({
      command: "/ask",
      text: "hello",
      team_id: "TUNKNOWN",
      response_url: "https://hooks.slack.com/x",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { response_type: string; text: string };
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).toMatch(/isn't connected/i);
  });

  // ── test:8 ─────────────────────────────────────────────────────────────────

  it("/ask with no text returns usage hint", async () => {
    const res = await postSlackCommand({
      command: "/ask",
      text: "",
      team_id: teamId,
      response_url: "https://hooks.slack.com/x",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { text: string };
    expect(json.text).toMatch(/usage/i);
  });

  // ── test:9 ─────────────────────────────────────────────────────────────────

  it("/ask returns Thinking immediately and eventually calls postToResponseUrl", async () => {
    vi.mocked(queryWorkspace).mockResolvedValue({ answer: "Use Postgres", sources: [], citedSf: [], citedDc: [] });

    const res = await postSlackCommand({
      command: "/ask",
      text: "what database do we use?",
      team_id: teamId,
      response_url: "https://hooks.slack.com/commands/T123/456/abc",
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { text: string };
    expect(json.text).toBe("_Thinking…_");

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(vi.mocked(postToResponseUrl)).toHaveBeenCalledWith(
      "https://hooks.slack.com/commands/T123/456/abc",
      expect.objectContaining({ text: expect.stringContaining("Use Postgres") })
    );
  });

  // ── test:10 ────────────────────────────────────────────────────────────────

  it("/ask with a response_url outside hooks.slack.com is rejected with 400", async () => {
    const res = await postSlackCommand({
      command: "/ask",
      text: "hello",
      team_id: teamId,
      response_url: "https://evil.example.com/steal",
    });
    expect(res.status).toBe(400);
  });

  // ── test:11 ────────────────────────────────────────────────────────────────

  it("/ask with an empty response_url returns an error message", async () => {
    const res = await postSlackCommand({
      command: "/ask",
      text: "hello",
      team_id: teamId,
      response_url: "",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { text: string };
    expect(json.text).toMatch(/no response url/i);
  });

  // ── test:12 ────────────────────────────────────────────────────────────────

  it("/memory returns formatted memory status", async () => {
    const res = await postSlackCommand({
      command: "/memory",
      text: "",
      team_id: teamId,
      response_url: "",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { response_type: string; text: string };
    expect(json.response_type).toBe("ephemeral");
    expect(json.text).toMatch(/Memory Status/);
  });

  // ── test:13 ────────────────────────────────────────────────────────────────

  it("unknown command returns generic message and does not echo raw input", async () => {
    const res = await postSlackCommand({
      command: "/unknown-xyz",
      text: "",
      team_id: teamId,
      response_url: "",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { text: string };
    expect(json.text).not.toContain("/unknown-xyz");
    expect(json.text).toMatch(/unknown command/i);
  });
});

// ─── app_mention handler ──────────────────────────────────────────────────────

describe("Slack app_mention handler", () => {
  let teamId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    await cleanDatabase();
    teamId = "TMENT";
    await db.insert(workspaces).values({
      slackTeamId: teamId,
      slackBotToken: encrypt("xoxb-test-token"),
      slackTeamName: "Mention Team",
    });
  });

  function makeAppMentionEvent(body: object) {
    const payload = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sig = slackSignature(timestamp, payload);
    return createApp().fetch(
      new Request("http://localhost/slack/events", {
        method: "POST",
        body: payload,
        headers: {
          "content-type": "application/json",
          "x-slack-signature": sig,
          "x-slack-request-timestamp": timestamp,
        },
      })
    );
  }

  // ── test:14 ────────────────────────────────────────────────────────────────

  it("sends an answer in the same thread when mentioned with a question", async () => {
    vi.mocked(queryWorkspace).mockResolvedValue({
      answer: "We use PostgreSQL",
      sources: [{ channel: "general", author: "alice", timestamp: "1000", excerpt: "use Postgres" }],
      citedSf: [],
      citedDc: [],
    });

    const res = await makeAppMentionEvent({
      type: "event_callback",
      team_id: teamId,
      event: {
        type: "app_mention",
        text: "<@UBOT> what database do we use?",
        channel: "C123",
        ts: "1700000000.000200",
        thread_ts: "1700000000.000100",
      },
    });

    expect(res.status).toBe(200);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        thread_ts: "1700000000.000100",
        text: expect.stringContaining("We use PostgreSQL"),
      })
    );
  });

  // ── test:15 ────────────────────────────────────────────────────────────────

  it("does not call postMessage when the mention has no question text", async () => {
    const res = await makeAppMentionEvent({
      type: "event_callback",
      team_id: teamId,
      event: {
        type: "app_mention",
        text: "<@UBOT>",
        channel: "C123",
        ts: "1700000001.000000",
      },
    });

    expect(res.status).toBe(200);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(vi.mocked(postMessage)).not.toHaveBeenCalled();
  });

  // ── test:16 ────────────────────────────────────────────────────────────────

  it("sends a fallback error message when queryWorkspace throws", async () => {
    vi.mocked(queryWorkspace).mockRejectedValue(new Error("LLM unavailable"));

    const res = await makeAppMentionEvent({
      type: "event_callback",
      team_id: teamId,
      event: {
        type: "app_mention",
        text: "<@UBOT> what is our strategy?",
        channel: "C456",
        ts: "1700000002.000000",
      },
    });

    expect(res.status).toBe(200);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(vi.mocked(postMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C456",
        text: expect.stringContaining("couldn't process"),
      })
    );
  });
});
