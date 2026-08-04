import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { eq, and } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../lib/db/index.js";
import { connectorTokens, workspaces } from "../lib/db/schema.js";
import { encrypt, decrypt, signState, readSignedCookieValue } from "../lib/utils/crypto.js";
import { notionSyncQueue, googleDocsSyncQueue, synthesisQueue, type NotionSyncJobData, type GoogleDocsSyncJobData } from "../lib/infra/queue.js";
import { verifyLinearSignature, getLinearWebhookSecret, processLinearEvent, type LinearWebhookEvent } from "../workers/connectors/linear.js";
import { embedAndInsert } from "../lib/ai/ingest-core.js";
import { checkRateLimit } from "../lib/infra/rate-limit.js";
import { chunkBySourceType } from "../lib/ai/chunker.js";
import { sanitizeText } from "../lib/utils/sanitize.js";
import { getPlanForWorkspace, gateFeature } from "../lib/billing/feature-gate.js";
import type { PlanFeatures } from "../lib/billing/plans.js";

// Reject connector OAuth/setup when the workspace's plan doesn't include
// the requested provider. Web flows redirect to a portal upgrade page;
// API/JSON callers receive a 402 JSON body.
async function gateConnectorOrRedirect(
  c: Context,
  workspaceId: string,
  feature: keyof PlanFeatures,
  label: string
): Promise<Response | null> {
  const plan = await getPlanForWorkspace(workspaceId);
  const gate = gateFeature(plan, feature, label);
  if (!gate) return null;
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("application/json")) {
    return c.json(gate, 402);
  }
  return c.redirect(`/portal?upgrade=${encodeURIComponent(feature)}`, 302);
}

export const connectorRoutes = new Hono();

// ─── Shared helpers ───────────────────────────────────────────────────────────

type AuthOk = { workspaceId: string };
type AuthErr = { error: string; status: 400 | 401 };

async function checkConnectorAuth(c: Context): Promise<AuthOk | AuthErr> {
  // Try Slack dashboard session first (signed cookie — verify before trusting)
  const dashCookie = readSignedCookieValue(getCookie(c, "dash_ws"));
  if (dashCookie) {
    const ws = await db.query.workspaces.findFirst({
      where: eq(workspaces.id, dashCookie),
      columns: { id: true },
    });
    if (ws) return { workspaceId: dashCookie };
  }

  return { error: "Unauthorized", status: 401 };
}

// After OAuth completes, redirect to portal if workspace has no Slack bot; dashboard otherwise.
async function getReturnBase(workspaceId: string): Promise<string> {
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { slackBotToken: true },
  });
  return ws?.slackBotToken ? "/dashboard" : "/portal";
}

function getRedirectUri(provider: string): string {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return `${appUrl}/connectors/${provider}/callback`;
}

function buildOAuthState(workspaceId: string): string {
  const nonce = randomBytes(16).toString("hex");
  const payload = `${workspaceId}:${nonce}`;
  const sig = signState(payload);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

// Returns workspaceId from a valid OAuth state, throws on tamper or malform.
// Uses timingSafeEqual to prevent timing-oracle attacks on the HMAC.
function verifyOAuthState(state: string): string {
  const decoded = Buffer.from(state, "base64url").toString("utf8");
  const parts = decoded.split(":");
  if (parts.length !== 3) throw new Error("Malformed state");
  const [wsId, nonce, receivedSig] = parts;
  const expectedSig = signState(`${wsId}:${nonce}`);
  const a = Buffer.from(receivedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("State signature mismatch");
  return wsId;
}

// ─── Notion OAuth ─────────────────────────────────────────────────────────────

connectorRoutes.get("/notion/connect", async (c) => {
  const auth = await checkConnectorAuth(c);
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { workspaceId } = auth;

  const gated = await gateConnectorOrRedirect(c, workspaceId, "notionConnector", "Notion connector");
  if (gated) return gated;

  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) return c.json({ error: "Notion integration not configured" }, 503);

  const url = new URL("https://api.notion.com/v1/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getRedirectUri("notion"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("state", buildOAuthState(workspaceId));

  return c.redirect(url.toString(), 302);
});

connectorRoutes.get("/notion/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    console.error("[notion] OAuth error:", error);
    return c.redirect("/portal?error=notion_denied", 302);
  }
  if (!code || !state) return c.json({ error: "Missing code or state" }, 400);

  let workspaceId: string;
  try {
    workspaceId = verifyOAuthState(state);
  } catch (err) {
    console.error("[notion] State verification failed:", err);
    return c.json({ error: "Invalid state" }, 400);
  }

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const clientId = process.env.NOTION_CLIENT_ID!;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  if (!clientSecret) return c.json({ error: "Notion integration not configured" }, 503);

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokenRes = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: getRedirectUri("notion") }),
  });

  if (!tokenRes.ok) {
    const errJson = await tokenRes.json().catch(() => null) as { error?: string } | null;
    console.error("[notion] Token exchange failed:", tokenRes.status, errJson?.error);
    const base = await getReturnBase(workspaceId);
    return c.redirect(`${base}?error=notion_token_failed`, 302);
  }

  const tokenData = await tokenRes.json() as { access_token: string; bot_id: string; workspace_name: string };
  const encryptedToken = encrypt(tokenData.access_token);

  const [tokenRow] = await db
    .insert(connectorTokens)
    .values({ workspaceId, provider: "notion", accessToken: encryptedToken })
    .onConflictDoUpdate({
      target: [connectorTokens.workspaceId, connectorTokens.provider],
      set: { accessToken: encryptedToken, lastSyncedAt: null },
    })
    .returning({ id: connectorTokens.id });

  const syncJob: NotionSyncJobData = { workspaceId, tokenId: tokenRow.id };
  await notionSyncQueue.add("notion-sync", syncJob as never, {
    jobId: `notion-initial-${workspaceId}`,
  });

  console.log(`[notion] Connected workspace ${workspaceId}, queued initial sync`);
  const notionBase = await getReturnBase(workspaceId);
  return c.redirect(`${notionBase}?connected=notion`, 302);
});

connectorRoutes.post("/notion/disconnect", async (c) => {
  const auth = await checkConnectorAuth(c);
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { workspaceId } = auth;

  await db.delete(connectorTokens).where(
    and(eq(connectorTokens.workspaceId, workspaceId), eq(connectorTokens.provider, "notion"))
  );

  const base = await getReturnBase(workspaceId);
  return c.redirect(`${base}?disconnected=notion`, 302);
});

// ─── Google Docs OAuth ────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

connectorRoutes.get("/google-docs/connect", async (c) => {
  const auth = await checkConnectorAuth(c);
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { workspaceId } = auth;

  const gated = await gateConnectorOrRedirect(c, workspaceId, "googleDocsConnector", "Google Docs connector");
  if (gated) return gated;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return c.json({ error: "Google integration not configured" }, 503);

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getRedirectUri("google-docs"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", buildOAuthState(workspaceId));

  return c.redirect(url.toString(), 302);
});

connectorRoutes.get("/google-docs/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    console.error("[google-docs] OAuth error:", error);
    return c.redirect("/portal?error=gdocs_denied", 302);
  }
  if (!code || !state) return c.json({ error: "Missing code or state" }, 400);

  let workspaceId: string;
  try {
    workspaceId = verifyOAuthState(state);
  } catch (err) {
    console.error("[google-docs] State verification failed:", err);
    return c.json({ error: "Invalid state" }, 400);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientSecret) return c.json({ error: "Google integration not configured" }, 503);

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: getRedirectUri("google-docs"),
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const errJson = await tokenRes.json().catch(() => null) as { error?: string } | null;
    console.error("[google-docs] Token exchange failed:", tokenRes.status, errJson?.error);
    const base = await getReturnBase(workspaceId);
    return c.redirect(`${base}?error=gdocs_token_failed`, 302);
  }

  const tokenData = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!tokenData.refresh_token) {
    console.error("[google-docs] No refresh_token received");
    const base = await getReturnBase(workspaceId);
    return c.redirect(`${base}?error=gdocs_no_refresh_token`, 302);
  }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  const [tokenRow] = await db
    .insert(connectorTokens)
    .values({
      workspaceId,
      provider: "google_docs",
      accessToken: encrypt(tokenData.access_token),
      refreshToken: encrypt(tokenData.refresh_token),
      expiresAt,
    })
    .onConflictDoUpdate({
      target: [connectorTokens.workspaceId, connectorTokens.provider],
      set: {
        accessToken: encrypt(tokenData.access_token),
        refreshToken: encrypt(tokenData.refresh_token),
        expiresAt,
        lastSyncedAt: null,
      },
    })
    .returning({ id: connectorTokens.id });

  const syncJob: GoogleDocsSyncJobData = { workspaceId, tokenId: tokenRow.id };
  await googleDocsSyncQueue.add("google-docs-sync", syncJob as never, {
    jobId: `gdocs-initial-${workspaceId}`,
  });

  console.log(`[google-docs] Connected workspace ${workspaceId}, queued initial sync`);
  const gdocsBase = await getReturnBase(workspaceId);
  return c.redirect(`${gdocsBase}?connected=google_docs`, 302);
});

connectorRoutes.post("/google-docs/disconnect", async (c) => {
  const auth = await checkConnectorAuth(c);
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { workspaceId } = auth;

  await db.delete(connectorTokens).where(
    and(eq(connectorTokens.workspaceId, workspaceId), eq(connectorTokens.provider, "google_docs"))
  );

  const base = await getReturnBase(workspaceId);
  return c.redirect(`${base}?disconnected=google_docs`, 302);
});

// ─── Linear Webhook ───────────────────────────────────────────────────────────

connectorRoutes.post("/linear/setup", async (c) => {
  const auth = await checkConnectorAuth(c);
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { workspaceId } = auth;

  const gated = await gateConnectorOrRedirect(c, workspaceId, "linearConnector", "Linear connector");
  if (gated) return gated;

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { id: true },
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  const existing = await db.query.connectorTokens.findFirst({
    where: and(eq(connectorTokens.workspaceId, workspaceId), eq(connectorTokens.provider, "linear")),
    columns: { accessToken: true },
  });

  const rawSecret = existing ? decrypt(existing.accessToken) : randomBytes(32).toString("hex");

  if (!existing) {
    await db.insert(connectorTokens).values({
      workspaceId,
      provider: "linear",
      accessToken: encrypt(rawSecret),
    });
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const webhookUrl = `${appUrl}/connectors/linear/webhook?workspace=${workspaceId}`;

  // Credentials returned directly in HTML — never put secrets in redirect URLs, logs, or browser history
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Linear Webhook — Anansi</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#111}
    .warning{background:#fff8e1;border:1px solid #f0c030;border-radius:6px;padding:12px 16px;font-size:.9rem;margin:16px 0}
    .card{background:#f6f6f6;border:1px solid #ddd;border-radius:8px;padding:20px;margin:12px 0}
    .label{font-size:.75rem;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
    .value{font-family:monospace;background:#fff;border:1px solid #ccc;border-radius:4px;padding:8px 12px;word-break:break-all;user-select:all}
    a{color:#0066cc}
  </style>
</head>
<body>
  <h2>Linear Webhook Credentials</h2>
  <div class="warning">&#9888;&#65039; Save the signing secret now — this page will not show it again.</div>
  <div class="card">
    <div class="label">Webhook URL</div>
    <div class="value">${webhookUrl}</div>
  </div>
  <div class="card">
    <div class="label">Signing Secret</div>
    <div class="value">${rawSecret}</div>
  </div>
  <p style="color:#555;font-size:.9rem">Paste both values into your Linear workspace webhook settings.</p>
  <p><a href="/dashboard">&larr; Back to dashboard</a></p>
</body>
</html>`);
});

connectorRoutes.post("/linear/disconnect", async (c) => {
  const auth = await checkConnectorAuth(c);
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { workspaceId } = auth;

  await db.delete(connectorTokens).where(
    and(eq(connectorTokens.workspaceId, workspaceId), eq(connectorTokens.provider, "linear"))
  );

  const linearBase = await getReturnBase(workspaceId);
  return c.redirect(`${linearBase}?disconnected=linear`, 302);
});

connectorRoutes.post("/linear/webhook", async (c) => {
  const workspaceId = c.req.query("workspace");
  if (!workspaceId) return c.json({ error: "Missing workspace" }, 400);

  const rl = await checkRateLimit(`linear-webhook:${workspaceId}`, 120);
  if (!rl) return c.json({ error: "Rate limit exceeded" }, 429, { "Retry-After": "60" });

  const rawBody = await c.req.text();
  const signature = c.req.header("linear-signature");
  if (!signature) return c.json({ error: "Missing signature" }, 400);

  const secret = await getLinearWebhookSecret(workspaceId);
  if (!secret) return c.json({ error: "Linear not configured for this workspace" }, 404);

  if (!verifyLinearSignature(rawBody, signature, secret)) {
    console.error("[linear] Webhook signature verification failed for workspace", workspaceId);
    return c.json({ error: "Invalid signature" }, 401);
  }

  let event: LinearWebhookEvent;
  try {
    event = JSON.parse(rawBody) as LinearWebhookEvent;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  processLinearEvent(workspaceId, event).catch((err) =>
    console.error("[linear] Event processing failed:", err)
  );

  return c.json({ ok: true });
});

// ─── Meeting Transcript Webhook ───────────────────────────────────────────────

// Setup: generates a shared secret for validating inbound transcript webhooks.
connectorRoutes.post("/transcript/setup", async (c) => {
  const auth = await checkConnectorAuth(c);
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { workspaceId } = auth;

  const gated = await gateConnectorOrRedirect(c, workspaceId, "transcriptWebhook", "Meeting transcript webhook");
  if (gated) return gated;

  const existing = await db.query.connectorTokens.findFirst({
    where: and(
      eq(connectorTokens.workspaceId, workspaceId),
      eq(connectorTokens.provider, "transcript_webhook")
    ),
    columns: { accessToken: true },
  });

  const rawSecret = existing ? decrypt(existing.accessToken) : randomBytes(32).toString("hex");

  if (!existing) {
    await db.insert(connectorTokens).values({
      workspaceId,
      provider: "transcript_webhook",
      accessToken: encrypt(rawSecret),
    });
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const webhookUrl = `${appUrl}/connectors/transcript?workspace=${workspaceId}`;

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Transcript Webhook — Anansi</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#111}
    .warning{background:#fff8e1;border:1px solid #f0c030;border-radius:6px;padding:12px 16px;font-size:.9rem;margin:16px 0}
    .card{background:#f6f6f6;border:1px solid #ddd;border-radius:8px;padding:20px;margin:12px 0}
    .label{font-size:.75rem;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
    .value{font-family:monospace;background:#fff;border:1px solid #ccc;border-radius:4px;padding:8px 12px;word-break:break-all;user-select:all}
    a{color:#0066cc}
  </style>
</head>
<body>
  <h2>Transcript Webhook Credentials</h2>
  <div class="warning">&#9888;&#65039; Save the secret now — this page will not show it again.</div>
  <div class="card">
    <div class="label">Webhook URL</div>
    <div class="value">${webhookUrl}</div>
  </div>
  <div class="card">
    <div class="label">X-Anansi-Secret header value</div>
    <div class="value">${rawSecret}</div>
  </div>
  <p style="color:#555;font-size:.9rem">Configure your meeting tool (Fireflies, Otter, Grain, Fathom) to POST transcripts here with the secret in the <code>X-Anansi-Secret</code> header.</p>
  <p><a href="/dashboard">&larr; Back to dashboard</a></p>
</body>
</html>`);
});

// Receives a meeting transcript. Validates X-Anansi-Secret, then ingests async.
connectorRoutes.post("/transcript", async (c) => {
  const workspaceId = c.req.query("workspace");
  if (!workspaceId) return c.json({ error: "Missing workspace" }, 400);

  const rl = await checkRateLimit(`transcript:${workspaceId}`, 60);
  if (!rl) return c.json({ error: "Rate limit exceeded" }, 429, { "Retry-After": "60" });

  const incomingSecret = c.req.header("x-anansi-secret");
  if (!incomingSecret) return c.json({ error: "Missing X-Anansi-Secret header" }, 401);

  const tokenRow = await db.query.connectorTokens.findFirst({
    where: and(
      eq(connectorTokens.workspaceId, workspaceId),
      eq(connectorTokens.provider, "transcript_webhook")
    ),
    columns: { accessToken: true },
  });
  if (!tokenRow) return c.json({ error: "Transcript webhook not configured" }, 404);

  const storedSecret = decrypt(tokenRow.accessToken);
  const a = Buffer.from(incomingSecret);
  const b = Buffer.from(storedSecret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    console.error("[transcript] Invalid secret for workspace", workspaceId);
    return c.json({ error: "Invalid secret" }, 401);
  }

  let body: { content?: unknown; metadata?: Record<string, unknown> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { content, metadata = {} } = body;
  if (!content || typeof content !== "string") return c.json({ error: "content required" }, 400);
  if (Buffer.byteLength(content) > 500 * 1024) return c.json({ error: "Content exceeds 500 KB" }, 413);

  const title = typeof metadata.title === "string" ? metadata.title : undefined;
  const timestamp = typeof metadata.timestamp === "string" ? metadata.timestamp : new Date().toISOString();
  const ingestId = randomUUID();
  const sourceId = `transcript:${workspaceId}:${ingestId}`;

  // Ingest fire-and-forget so the meeting tool gets a fast response
  (async () => {
    const { text } = sanitizeText(content);
    if (!text.trim()) return;
    const chunks = chunkBySourceType(text, "meeting_transcript");
    await embedAndInsert(
      chunks.map((chunk, idx) => ({
        workspaceId,
        sourceType: "meeting_transcript" as const,
        sourceId: chunks.length > 1 ? `${sourceId}:${idx}` : sourceId,
        content: chunk,
        metadata: {
          author: typeof metadata.speaker === "string" ? metadata.speaker : "transcript",
          authorId: "transcript",
          timestamp,
          channelName: "transcript",
          ...(title ? { title } : {}),
        },
      }))
    );
    console.log(`[transcript] Workspace ${workspaceId}: ingested ${chunks.length} chunks`);
    await synthesisQueue.add("synthesize", { workspaceId }, { jobId: `synthesis-${workspaceId}` });
  })().catch((err) => console.error("[transcript] Ingestion failed:", err));

  return c.json({ ok: true, sourceId: ingestId });
});

connectorRoutes.post("/transcript/disconnect", async (c) => {
  const auth = await checkConnectorAuth(c);
  if ("error" in auth) return c.json({ error: auth.error }, auth.status);
  const { workspaceId } = auth;

  await db.delete(connectorTokens).where(
    and(eq(connectorTokens.workspaceId, workspaceId), eq(connectorTokens.provider, "transcript_webhook"))
  );

  const transcriptBase = await getReturnBase(workspaceId);
  return c.redirect(`${transcriptBase}?disconnected=transcript`, 302);
});
