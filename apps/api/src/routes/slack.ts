import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import crypto from "crypto";
import { eq, count, sql, and } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import { workspaces, memoryChunks, staticDocuments, channels, subscriptions } from "../lib/db/schema.js";
import { ingestionQueue, backfillQueue } from "../lib/infra/queue.js";
import { encrypt, decrypt, signState, timingSafeEqual, generateInstallToken } from "../lib/utils/crypto.js";
import { postMessage, postToResponseUrl } from "../lib/integrations/slack-api.js";
import { queryWorkspace, queryUser, type QueryResponse } from "../lib/ai/query-engine.js";
import { incrementQueryIfUnderLimit } from "../lib/billing/usage.js";
import { generateDashboardToken } from "../lib/auth/dashboard-auth.js";
import { findSlackMemoryUser, setSlackUserOptOut } from "../lib/integrations/slack-memory-user.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlackRawEvent {
  type: string;
  subtype?: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  files?: Array<{ id: string; name: string; mimetype: string; url_private: string }>;
  [key: string]: unknown;
}

type SlackPayload =
  | { type: "url_verification"; challenge: string }
  | {
      type: "event_callback";
      team_id: string;
      event: SlackRawEvent;
    };

type Variables = {
  rawBody: string;
  payload: SlackPayload;
};

// ─── Scopes ───────────────────────────────────────────────────────────────────

const SLACK_SCOPES = [
  "channels:history",
  "channels:read",
  "files:read",
  "app_mentions:read",
  "chat:write",
  "commands",
].join(",");

// ─── Signature validation ─────────────────────────────────────────────────────

function isValidSlackHmac(
  rawBody: string,
  signature: string | null | undefined,
  timestamp: string | null | undefined
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  // Fail closed: empty or missing secret rejects every request rather than
  // accepting them with an HMAC computed over an empty key.
  if (!secret) return false;
  if (!signature || !timestamp) return false;
  const tsNum = parseInt(timestamp, 10);
  if (isNaN(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
  const computed =
    "v0=" +
    crypto
      .createHmac("sha256", secret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex");
  return timingSafeEqual(signature, computed);
}

const verifySlackSignature: MiddlewareHandler<{ Variables: Variables }> = async (
  c,
  next
) => {
  const rawBody = await c.req.text();

  if (!isValidSlackHmac(rawBody, c.req.header("x-slack-signature"), c.req.header("x-slack-request-timestamp"))) {
    return c.text("Unauthorized", 401);
  }

  c.set("rawBody", rawBody);
  let parsed: SlackPayload;
  try {
    parsed = JSON.parse(rawBody) as SlackPayload;
  } catch {
    return c.text("Invalid JSON body", 400);
  }
  c.set("payload", parsed);
  await next();
}

// ─── Router ───────────────────────────────────────────────────────────────────

const slack = new Hono<{ Variables: Variables }>();

// POST /slack/events — Slack Events API
slack.post(
  "/events",
  bodyLimit({ maxSize: 1_048_576, onError: (c) => c.text("Payload too large", 413) }),
  verifySlackSignature,
  async (c) => {
  const payload = c.get("payload");

  // url_verification must respond synchronously — before any queue push (T2)
  if (payload.type === "url_verification") {
    return c.json({ challenge: payload.challenge });
  }

  if (payload.type !== "event_callback") {
    return c.json({ ok: true });
  }

  // Look up the internal workspace ID from the Slack team ID
  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.slackTeamId, payload.team_id),
    columns: { id: true, slackBotToken: true },
  });

  if (!workspace) {
    // App may have been uninstalled; drop silently
    return c.json({ ok: true });
  }

  // app_mention — answer the question in-thread; don't ingest as memory
  if (payload.event.type === "app_mention") {
    // Pre-check limit synchronously so the fire-and-forget doesn't need DB access
    handleMention(workspace.id, workspace.slackBotToken!, payload.event).catch(
      (err) => console.error("[mention] Failed:", err)
    );
    return c.json({ ok: true });
  }

  // Push to BullMQ ingestion queue (T9: Redis-down fallback — log and return 200)
  try {
    await ingestionQueue.add("ingest", {
      workspaceId: workspace.id,
      teamId: payload.team_id,
      event: payload.event,
    });
  } catch (err) {
    console.error("[queue] Failed to enqueue Slack event, dropping:", err);
  }

  return c.json({ ok: true });
  }
);

// GET /slack/oauth/start — Begin Slack OAuth (generates CSRF state)
slack.get("/oauth/start", (c) => {
  if (!process.env.SLACK_CLIENT_ID || !process.env.APP_URL) {
    return c.text("OAuth not configured", 500);
  }

  const state = crypto.randomUUID();
  const sig = signState(state);
  // Cookie stores state.hmac — verified on callback
  setCookie(c, "oauth_state", `${state}.${sig}`, {
    httpOnly: true,
    // Lax (not Strict) is required: Slack's redirect is a cross-site top-level navigation
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", process.env.SLACK_CLIENT_ID);
  url.searchParams.set("scope", SLACK_SCOPES);
  url.searchParams.set(
    "redirect_uri",
    new URL("/slack/oauth/callback", process.env.APP_URL).toString()
  );
  url.searchParams.set("state", state);

  return c.redirect(url.toString());
});

// GET /slack/oauth/callback — Exchange code, save workspace
slack.get("/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const errorParam = c.req.query("error");

  if (errorParam) {
    return c.text(`Slack OAuth error: ${errorParam}`, 400);
  }
  if (!code || !state) {
    return c.text("Missing code or state", 400);
  }

  // CSRF check: verify state matches signed cookie
  const cookieValue = getCookie(c, "oauth_state");
  if (!cookieValue) {
    return c.text("Missing OAuth state cookie", 400);
  }

  const dotIndex = cookieValue.lastIndexOf(".");
  if (dotIndex === -1) {
    return c.text("Invalid OAuth state cookie", 400);
  }

  const cookieState = cookieValue.slice(0, dotIndex);
  const cookieSig = cookieValue.slice(dotIndex + 1);
  const expectedSig = signState(cookieState);

  if (!timingSafeEqual(expectedSig, cookieSig) || cookieState !== state) {
    return c.text("State mismatch — possible CSRF attack", 400);
  }

  // Exchange authorization code for bot token
  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(10_000),
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: `${process.env.APP_URL}/slack/oauth/callback`,
    }),
  });

  const tokenData = (await tokenRes.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    team?: { id: string; name: string };
  };

  if (!tokenData.ok || !tokenData.access_token || !tokenData.team) {
    console.error("[oauth] Slack token exchange failed:", tokenData.error);
    return c.text(`OAuth failed: ${tokenData.error ?? "unknown"}`, 400);
  }

  // Encrypt bot token before storing (AES-256-GCM, decrypt via lib/crypto.ts)
  const encryptedToken = encrypt(tokenData.access_token);

  const [savedWorkspace] = await db
    .insert(workspaces)
    .values({
      slackTeamId: tokenData.team.id,
      slackBotToken: encryptedToken,
      slackTeamName: tokenData.team.name,
    })
    .onConflictDoUpdate({
      target: workspaces.slackTeamId,
      set: {
        slackBotToken: encryptedToken,
        slackTeamName: tokenData.team.name,
      },
    })
    .returning({ id: workspaces.id });

  // Create a free-tier subscription record for the new workspace (idempotent on re-install)
  await db
    .insert(subscriptions)
    .values({ workspaceId: savedWorkspace.id, plan: "free" })
    .onConflictDoNothing();

  // Redirect to onboarding channel picker — install token authorises the session
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const installToken = generateInstallToken(savedWorkspace.id);
  return c.redirect(
    `${appUrl}/onboarding?workspace=${savedWorkspace.id}&install_token=${installToken}`,
    302
  );
});

// ─── Bot helpers ─────────────────────────────────────────────────────────────

const MAX_ANSWER_SOURCES = 3;

function formatAnswer(result: QueryResponse, workspaceId?: string): string {
  const lines = [result.answer];
  if (result.sources.length > 0) {
    lines.push("\n*Sources:*");
    const seen = new Set<string>();
    for (const s of result.sources.slice(0, MAX_ANSWER_SOURCES)) {
      // Skip sources with raw user IDs (U...) — not yet resolved
      const authorIsId = /^U[A-Z0-9]{6,}$/.test(s.author);
      if (authorIsId) continue;

      const date = s.timestamp
        ? new Date(Number(s.timestamp) * 1000).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })
        : null;

      // Deduplicate by author + channel + date
      const key = `${s.author}|${s.channel}|${date}`;
      if (seen.has(key)) continue;
      seen.add(key);

      lines.push(`• ${s.author}, #${s.channel}${date ? ` (${date})` : ""}`);
    }
  }

  // Link to the synthesized memory view, highlighting cited facts/context
  if (workspaceId && (result.citedSf.length > 0 || result.citedDc.length > 0)) {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const params = new URLSearchParams({ workspace: workspaceId });
    if (result.citedSf.length > 0) params.set("sf", result.citedSf.join(","));
    if (result.citedDc.length > 0) params.set("dc", result.citedDc.join(","));
    lines.push(`\n<${appUrl}/memory/view?${params}|📖 View in synthesized memory>`);
  }

  return lines.join("\n");
}

async function handleMention(
  workspaceId: string,
  encryptedToken: string,
  event: SlackRawEvent,
): Promise<void> {
  const token = decrypt(encryptedToken);
  const question = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!question) return;

  const channel = event.channel!;
  const threadTs = event.thread_ts ?? event.ts!;

  const limitCheck = await incrementQueryIfUnderLimit(workspaceId);
  if (!limitCheck.allowed) {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const replyText = `⚠️ Your workspace has reached its monthly query limit (${limitCheck.current}/${limitCheck.limit}).\n\nUpgrade to Pro for 500 queries/month: ${appUrl}/billing/checkout?workspace=${workspaceId}`;
    await postMessage({ token, channel, text: replyText, thread_ts: threadTs });
    return;
  }

  let replyText: string;
  try {
    const result = await queryWorkspace(workspaceId, question);
    replyText = formatAnswer(result, workspaceId);
  } catch (err) {
    console.error("[mention] queryWorkspace failed:", err);
    replyText = "Sorry, I couldn't process your question right now.";
  }

  await postMessage({ token, channel, text: replyText, thread_ts: threadTs });
}

async function handleSlashAsk(
  workspaceId: string,
  question: string,
  responseUrl: string,
  responseType: "in_channel" | "ephemeral"
): Promise<void> {
  const limitCheck = await incrementQueryIfUnderLimit(workspaceId);
  if (!limitCheck.allowed) {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const text = `⚠️ Your workspace has reached its monthly query limit (${limitCheck.current}/${limitCheck.limit}).\n\nUpgrade to Pro for 500 queries/month: ${appUrl}/billing/checkout?workspace=${workspaceId}`;
    await postToResponseUrl(responseUrl, { response_type: "ephemeral", text, replace_original: true });
    return;
  }

  let text: string;
  try {
    const result = await queryWorkspace(workspaceId, question);
    text = formatAnswer(result, workspaceId);
  } catch (err) {
    console.error("[slash-ask] queryWorkspace failed:", err);
    text = "Sorry, I couldn't process your question right now.";
  }
  await postToResponseUrl(responseUrl, { response_type: responseType, text, replace_original: true });
}

async function buildMemoryStatus(workspaceId: string): Promise<string> {
  const [stats, staticDoc, channelRows, sub] = await Promise.all([
    db
      .select({
        total: count(),
        unsynthesized: sql<number>`count(*) filter (where ${memoryChunks.synthesized} = false)`,
      })
      .from(memoryChunks)
      .where(eq(memoryChunks.workspaceId, workspaceId)),
    db.query.staticDocuments.findFirst({
      where: eq(staticDocuments.workspaceId, workspaceId),
    }),
    db
      .select({ name: channels.name, backfillStatus: channels.backfillStatus })
      .from(channels)
      .where(eq(channels.workspaceId, workspaceId))
      .orderBy(channels.name),
    db.query.subscriptions.findFirst({
      where: eq(subscriptions.workspaceId, workspaceId),
      columns: { plan: true, status: true },
    }),
  ]);

  const { total, unsynthesized } = stats[0] ?? { total: 0, unsynthesized: 0 };
  const planLabel = sub?.plan === "pro" ? "Pro ⭐" : sub?.plan === "enterprise" ? "Enterprise" : "Free";

  const lines: string[] = ["*Memory Status*\n"];
  lines.push(`• Plan: ${planLabel}`);
  lines.push(`• Total chunks: ${total.toLocaleString()}`);
  lines.push(`• Pending synthesis: ${unsynthesized}`);

  if (staticDoc) {
    const lastSynced = staticDoc.lastSynthesizedAt
      ? `<!date^${Math.floor(staticDoc.lastSynthesizedAt.getTime() / 1000)}^{date_pretty} at {time}|${staticDoc.lastSynthesizedAt.toISOString()}>`
      : "never";
    lines.push(`• Last synthesized: ${lastSynced}`);
    lines.push(`• Static facts: ${staticDoc.staticFacts.length}/30`);
    lines.push(`• Dynamic context: ${staticDoc.dynamicContext.length}/15`);
  } else {
    lines.push("• Not yet synthesized");
  }

  if (channelRows.length > 0) {
    const statusEmoji: Record<string, string> = {
      complete: "✅",
      running: "🔄",
      pending: "⏳",
      failed: "❌",
    };
    const failedChannels: string[] = [];
    lines.push("\n*Channels:*");
    for (const ch of channelRows) {
      lines.push(`${statusEmoji[ch.backfillStatus] ?? "•"} #${ch.name} — ${ch.backfillStatus}`);
      if (ch.backfillStatus === "failed") failedChannels.push(ch.name);
    }
    if (failedChannels.length > 0) {
      lines.push(`\n_❓ Failed channels: invite me first — type \`/invite @Anansi\` in #${failedChannels.join(", #")} then run \`/memory retry\`_`);
    }
  }

  return lines.join("\n");
}

// ─── Per-person memory (Slack-native) ────────────────────────────────────────

// Pull a Slack user id out of a slash-command arg. Slack sends mentions as
// "<@U12345|name>" (or "<@U12345>") when "Escape …" is on. Returns null otherwise.
function parseSlackMention(text: string): string | null {
  const m = text.match(/<@([A-Z0-9]+)(?:\|[^>]*)?>/);
  return m ? m[1] : null;
}

function fmtPeriod(validFrom?: string | null, validUntil?: string | null): string {
  if (validFrom && validUntil) return `${validFrom} – ${validUntil}`;
  if (validFrom) return `since ${validFrom}`;
  if (validUntil) return `until ${validUntil}`;
  return "";
}

const PROFILE_MAX_FACTS = 8;
const PROFILE_MAX_DYNAMIC = 5;
const PROFILE_MAX_TEMPORAL = 6;
const PROFILE_MAX_RELATIONSHIPS = 6;

// Render a person's synthesized profile as Slack mrkdwn. `subject` is "Your" or a
// display name. Returns null when there's no profile to show yet.
async function buildPersonProfile(
  workspaceId: string,
  memoryUserId: string,
  subject: string
): Promise<string | null> {
  const profile = await queryUser(workspaceId, memoryUserId);
  const hasAnything =
    profile.static.length || profile.dynamic.length || profile.temporal.length || profile.entities.length;
  if (!hasAnything) return null;

  const lines: string[] = [`*${subject} memory*`];

  if (profile.static.length) {
    lines.push("\n*Known facts*");
    for (const f of profile.static.slice(0, PROFILE_MAX_FACTS)) lines.push(`• ${f}`);
  }
  if (profile.dynamic.length) {
    lines.push("\n*Currently*");
    for (const d of profile.dynamic.slice(0, PROFILE_MAX_DYNAMIC)) lines.push(`• ${d}`);
  }
  if (profile.temporal.length) {
    // current facts first, then most recent past
    const sorted = [...profile.temporal].sort((a, b) => Number(b.current) - Number(a.current));
    lines.push("\n*Timeline*");
    for (const t of sorted.slice(0, PROFILE_MAX_TEMPORAL)) {
      const period = fmtPeriod(t.validFrom, t.validUntil);
      lines.push(`• ${t.fact}${period ? ` _(${period})_` : ""}${t.current ? " ✓" : ""}`);
    }
  }
  // Current relationships across the user's entities (works_at, uses, knows, …)
  const rels = profile.entities
    .flatMap((e) => e.relationships.filter((r) => r.current).map((r) => `${e.name} ${r.relationship.replace(/_/g, " ")} ${r.target.name}`))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, PROFILE_MAX_RELATIONSHIPS);
  if (rels.length) {
    lines.push("\n*Connections*");
    for (const r of rels) lines.push(`• ${r}`);
  }

  return lines.join("\n");
}

// ─── POST /slack/commands — slash command dispatcher ─────────────────────────

slack.post(
  "/commands",
  bodyLimit({ maxSize: 32_000, onError: (c) => c.text("Payload too large", 413) }),
  async (c) => {
    const rawBody = await c.req.text();

    if (!isValidSlackHmac(rawBody, c.req.header("x-slack-signature"), c.req.header("x-slack-request-timestamp"))) {
      return c.text("Unauthorized", 401);
    }

    const params = new URLSearchParams(rawBody);
    const command = params.get("command") ?? "";
    const text = (params.get("text") ?? "").trim();
    const teamId = params.get("team_id") ?? "";
    const responseUrl = params.get("response_url") ?? "";

    // Defense-in-depth: Slack only sends hooks.slack.com URLs; reject anything else
    if (responseUrl && !responseUrl.startsWith("https://hooks.slack.com/")) {
      console.error("[commands] Unexpected response_url domain, rejecting:", responseUrl);
      return c.text("Bad Request", 400);
    }

    const workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.slackTeamId, teamId),
      columns: { id: true, slackBotToken: true },
    });

    if (!workspace) {
      return c.json({
        response_type: "ephemeral",
        text: "This workspace isn't connected to Anansi. Visit the app to connect.",
      });
    }

    if (command === "/ask") {
      if (!text) {
        return c.json({ response_type: "ephemeral", text: "Usage: `/ask <your question>` (visible to all) or `/ask quietly <your question>` (only you)." });
      }
      if (!responseUrl) {
        return c.json({ response_type: "ephemeral", text: "Unable to respond — no response URL provided." });
      }

      // "quietly" prefix → ephemeral; everything else → in_channel
      let question = text;
      let responseType: "in_channel" | "ephemeral" = "in_channel";
      if (/^quietly\s+/i.test(text)) {
        question = text.replace(/^quietly\s+/i, "").trim();
        responseType = "ephemeral";
      }

      handleSlashAsk(workspace.id, question, responseUrl, responseType).catch((err) =>
        console.error("[slash-ask] Failed:", err)
      );
      return c.json({ response_type: responseType, text: "_Thinking…_" });
    }

    if (command === "/memory") {
      const sub = (text.split(/\s+/)[0] ?? "").toLowerCase();
      const requesterId = params.get("user_id") ?? "";

      // Per-person memory: `/memory me`, `/memory about @user`
      if (sub === "me" || sub === "about") {
        const targetId = (sub === "about" ? parseSlackMention(text) : null) ?? requesterId;
        if (!targetId) {
          return c.json({ response_type: "ephemeral", text: "Couldn't determine whose memory to show. Try `/memory me`." });
        }
        const isSelf = targetId === requesterId;
        const noneText = isSelf
          ? "Anansi hasn't built your personal memory yet — keep chatting in connected channels and I'll learn."
          : `No personal memory for <@${targetId}> yet.`;

        const memUser = await findSlackMemoryUser(workspace.id, targetId);
        if (!memUser) return c.json({ response_type: "ephemeral", text: noneText });
        if (memUser.optedOut) {
          return c.json({ response_type: "ephemeral", text: isSelf
            ? "You've opted out of personal memory. Re-enable with `/memory remember-me`."
            : `<@${targetId}> has opted out of personal memory.` });
        }
        const profileText = await buildPersonProfile(workspace.id, memUser.id, isSelf ? "Your" : `<@${targetId}>'s`);
        return c.json({ response_type: "ephemeral", text: profileText ?? noneText });
      }

      // Privacy: opt the requesting user out of / back into personal memory.
      if (sub === "forget-me") {
        if (!requesterId) return c.json({ response_type: "ephemeral", text: "⚠️ Couldn't identify you. Please try again." });
        await setSlackUserOptOut(workspace.id, requesterId, true);
        return c.json({ response_type: "ephemeral", text: "🔒 Done — I deleted your personal profile and won't build one from your messages. They still count toward the team's memory. Re-enable anytime with `/memory remember-me`." });
      }
      if (sub === "remember-me") {
        if (!requesterId) return c.json({ response_type: "ephemeral", text: "⚠️ Couldn't identify you. Please try again." });
        await setSlackUserOptOut(workspace.id, requesterId, false);
        return c.json({ response_type: "ephemeral", text: "✅ Personal memory re-enabled — I'll build your profile from new messages." });
      }

      if (sub === "purge") {
        // Only workspace admins/owners may purge memory
        const purgeUserId = params.get("user_id") ?? "";
        if (!workspace.slackBotToken || !purgeUserId) {
          return c.json({ response_type: "ephemeral", text: "⚠️ Unable to verify permissions. Please try again." });
        }
        const purgeToken = decrypt(workspace.slackBotToken);
        const infoRes = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(purgeUserId)}`, {
          headers: { Authorization: `Bearer ${purgeToken}` },
        });
        const info = await infoRes.json() as { ok: boolean; user?: { is_admin?: boolean; is_owner?: boolean } };
        if (!info.ok || (!info.user?.is_admin && !info.user?.is_owner)) {
          return c.json({ response_type: "ephemeral", text: "⚠️ Only workspace admins can purge memory." });
        }

        const rest = text.replace(/^purge\s*/i, "").trim();
        const parts = rest.split(/\s+/);

        // Check if targeting a specific channel: /memory purge #channel [confirm]
        if (parts[0]?.startsWith("#")) {
          const channelName = parts[0].slice(1).toLowerCase();
          const confirming = parts[1]?.toLowerCase() === "confirm";

          const channelRow = await db.query.channels.findFirst({
            where: and(eq(channels.workspaceId, workspace.id), eq(channels.name, channelName)),
            columns: { id: true, name: true },
          });

          if (!channelRow) {
            return c.json({ response_type: "ephemeral", text: `⚠️ Channel *#${channelName}* is not indexed. Check channel names with \`/memory\`.` });
          }

          if (!confirming) {
            const [{ value: chunkCount }] = await db
              .select({ value: count() })
              .from(memoryChunks)
              .where(and(eq(memoryChunks.workspaceId, workspace.id), eq(memoryChunks.channelId, channelRow.id)));
            return c.json({
              response_type: "ephemeral",
              text: `⚠️ This will permanently delete *${chunkCount.toLocaleString()} chunks* from *#${channelName}*.\n\nTo confirm: \`/memory purge #${channelName} confirm\``,
            });
          }

          await db
            .delete(memoryChunks)
            .where(and(eq(memoryChunks.workspaceId, workspace.id), eq(memoryChunks.channelId, channelRow.id)));
          console.log(`[purge] Workspace ${workspace.id} purged channel ${channelName}`);
          return c.json({ response_type: "ephemeral", text: `🗑️ All indexed memory for *#${channelName}* has been deleted.` });
        }

        // /memory purge [confirm] — workspace-wide purge
        if (parts[0]?.toLowerCase() !== "confirm") {
          const [{ value: chunkCount }] = await db
            .select({ value: count() })
            .from(memoryChunks)
            .where(eq(memoryChunks.workspaceId, workspace.id));
          return c.json({
            response_type: "ephemeral",
            text: `⚠️ This will permanently delete *all ${chunkCount.toLocaleString()} indexed chunks* and the synthesized memory document for this workspace. This cannot be undone.\n\nTo confirm: \`/memory purge confirm\``,
          });
        }

        await Promise.all([
          db.delete(memoryChunks).where(eq(memoryChunks.workspaceId, workspace.id)),
          db.delete(staticDocuments).where(eq(staticDocuments.workspaceId, workspace.id)),
        ]);
        console.log(`[purge] Workspace ${workspace.id} purged all memory`);
        return c.json({ response_type: "ephemeral", text: "🗑️ All indexed memory and synthesized knowledge for this workspace has been deleted." });
      }

      if (sub === "retry") {
        await backfillQueue.add(
          "backfill",
          { workspaceId: workspace.id },
          { jobId: `backfill-${workspace.id}-${Date.now()}` }
        );
        return c.json({ response_type: "ephemeral", text: "♻️ Retrying backfill for failed channels…" });
      }

      if (sub === "dashboard") {
        // Send a magic link to the requesting user via DM
        const userId = params.get("user_id") ?? "";
        const wsRow = await db.query.workspaces.findFirst({
          where: eq(workspaces.id, workspace.id),
        });
        if (wsRow && userId) {
          const token = await generateDashboardToken(workspace.id);
          const appUrl = process.env.APP_URL ?? "http://localhost:3000";
          const link = `${appUrl}/dashboard?token=${token}`;
          if (!wsRow.slackBotToken) return;
          const botToken = decrypt(wsRow.slackBotToken);
          postMessage({
            token: botToken,
            channel: userId,
            text: `🔗 Here's your dashboard link (expires in 30 minutes):\n${link}`,
          }).catch((err) => console.error("[memory dashboard] DM failed:", err));
        }
        return c.json({ response_type: "ephemeral", text: "📬 I just sent you a dashboard link via DM." });
      }

      const statusText = await buildMemoryStatus(workspace.id);
      return c.json({
        response_type: "ephemeral",
        text: `${statusText}\n\n_Tip: \`/memory me\` shows your personal memory · \`/memory about @user\` shows theirs · \`/memory forget-me\` opts out._`,
      });
    }

    return c.json({ response_type: "ephemeral", text: "Unknown command. Try `/ask <question>`, `/memory`, `/memory me`, `/memory about @user`, `/memory forget-me`, `/memory dashboard`, or `/memory purge`." });
  }
);

export default slack;
