/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import { workspaces, channels, subscriptions } from "../lib/db/schema.js";
import { verifyInstallToken, decrypt, signCookieValue, readSignedCookieValue } from "../lib/utils/crypto.js";
import { TOKENS_CSS, BASE_CSS, THEME_TOGGLE_CSS, THEME_TOGGLE_HTML, THEME_SCRIPT, withDoctype } from "../lib/ui/theme.js";
import { backfillQueue } from "../lib/infra/queue.js";
import { checkLimit } from "../lib/billing/usage.js";
import { getLimits } from "../lib/billing/plans.js";
import type { PlanName } from "../lib/billing/plans.js";

export const onboardingRoutes = new Hono();

const COOKIE_NAME = "onboarding_ws";
const COOKIE_TTL = 60 * 60; // 1 hour — enough to complete onboarding

// GET /onboarding?workspace=<id>&install_token=<token>
// Shows the channel picker after OAuth install.
// Auth: short-lived install_token from OAuth callback, or existing onboarding_ws cookie.
onboardingRoutes.get("/", async (c) => {
  const workspaceId = c.req.query("workspace");
  if (!workspaceId) return c.text("Missing workspace param", 400);

  // Accept an existing signed session cookie (e.g. page refresh) or a fresh install token
  const cookieId = readSignedCookieValue(getCookie(c, COOKIE_NAME));
  const installToken = c.req.query("install_token");

  if (cookieId === workspaceId) {
    // Already have a valid signed session — continue
  } else if (installToken) {
    const verified = verifyInstallToken(installToken);
    if (verified !== workspaceId) {
      return c.text("Install link expired or invalid. Please re-install the Slack app.", 401);
    }
    setCookie(c, COOKIE_NAME, signCookieValue(workspaceId), {
      httpOnly: true,
      sameSite: "Lax",
      maxAge: COOKIE_TTL,
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  } else {
    return c.text("Unauthorized. Please install the Slack app to access this page.", 401);
  }

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
  });
  if (!workspace) return c.text("Workspace not found", 404);

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.workspaceId, workspaceId),
  });
  const plan = (sub?.plan ?? "free") as PlanName;
  const channelLimit = getLimits(plan).maxChannels;

  if (!workspace.slackBotToken) return c.json({ error: "Not a Slack workspace" }, 400);
  const slackToken = decrypt(workspace.slackBotToken);

  const slackRes = await fetch(
    "https://slack.com/api/conversations.list?types=public_channel&limit=200&exclude_archived=true",
    { headers: { Authorization: `Bearer ${slackToken}` } }
  );
  const slackData = (await slackRes.json()) as {
    ok: boolean;
    channels?: Array<{ id: string; name: string; num_members: number }>;
    error?: string;
  };

  if (!slackData.ok) {
    console.error("[onboarding] conversations.list failed:", slackData.error);
    return c.text("Could not fetch Slack channels", 500);
  }

  const slackChannels = (slackData.channels ?? []).sort(
    (a, b) => b.num_members - a.num_members
  );

  const limitNote =
    channelLimit === Infinity
      ? "You can index all channels."
      : `Your Free plan supports up to ${channelLimit} channels.`;

  const errorParam = c.req.query("error");
  const errorMsg = errorParam === "no_channels" ? "Please select at least one channel." : null;

  return c.html(withDoctype(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Anansi — Choose channels to index</title>
        <style>{`
          ${TOKENS_CSS}
          ${BASE_CSS}
          ${THEME_TOGGLE_CSS}
          body{min-height:100vh;padding:clamp(28px,7vw,80px) 16px}
          .onboarding-shell{width:min(100%,680px);margin:0 auto}
          .step{font-family:var(--font-mono);font-size:.66rem;font-weight:650;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:18px}
          h1{font-family:var(--font-display);font-size:clamp(2rem,5vw,3rem);font-weight:600;line-height:1.04;letter-spacing:-.045em;margin-bottom:10px}
          .sub{max-width:610px;color:var(--text-secondary);margin-bottom:26px;font-size:.93rem;line-height:1.65}
          .channels{border:1px solid var(--border);background:var(--surface);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);max-height:420px;overflow-y:auto}
          .channel{display:flex;align-items:center;gap:12px;padding:13px 16px;border-bottom:1px solid var(--border);transition:background .15s}
          .channel:hover{background:var(--surface-2)}
          .channel:last-child{border-bottom:none}
          .channel label{cursor:pointer;flex:1;font-size:.91rem;color:var(--text);font-weight:520}
          .channel .members{font-family:var(--font-mono);font-size:.69rem;color:var(--text-muted);margin-left:5px}
          .channel input[type=checkbox]{width:16px;height:16px;accent-color:var(--brand)}
          .limit-note{font-size:.78rem;color:var(--text-secondary);margin:12px 0 18px;background:var(--brand-soft);border-left:2px solid var(--brand);padding:9px 12px}
          .none-msg{padding:32px 20px;text-align:center;color:var(--text-muted)}
          .submit{margin-top:20px;width:100%;padding:13px 28px;font-size:.88rem}
          .theme-toggle{position:fixed;top:18px;right:18px;z-index:1}
          @media(max-width:480px){.channel{padding:12px}.channel .members{display:block;margin:3px 0 0}.sub{font-size:.88rem}}
        `}</style>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div dangerouslySetInnerHTML={{ __html: THEME_TOGGLE_HTML }} />
        <main class="onboarding-shell">
          <div class="step">Source setup · 01</div>
          <h1>Choose channels to index</h1>
          <p class="sub">Anansi will read and index the selected channels. You can change this later with <code>/memory channels</code>.</p>
          {errorMsg && <p class="alert alert-err" role="alert">{errorMsg}</p>}
          <p class="limit-note">{limitNote}</p>

          <form method="post" action="/onboarding/channels">
            <input type="hidden" name="workspace_id" value={workspaceId} />
            {slackChannels.length === 0 ? (
              <div class="channels"><p class="none-msg">No public channels found.</p></div>
            ) : (
              <fieldset class="channels" style="border:1px solid var(--border)">
                <legend class="sr-only">Channels to index</legend>
                {slackChannels.map((ch) => (
                  <div class="channel">
                    <input
                      type="checkbox"
                      id={ch.id}
                      name="channels"
                      value={`${ch.id}:${ch.name}`}
                    />
                    <label for={ch.id}>
                      #{ch.name}
                      <span class="members">{ch.num_members} members</span>
                    </label>
                  </div>
                ))}
              </fieldset>
            )}
            <button type="submit" class="btn btn-primary submit">Start indexing →</button>
          </form>
        </main>

        {channelLimit !== Infinity && (
          // hono/jsx HTML-escapes text children (`=>` becomes `=&gt;`), so inline
          // scripts must go through dangerouslySetInnerHTML to stay valid JS.
          <script dangerouslySetInnerHTML={{ __html: `
            const checks = document.querySelectorAll('input[name="channels"]');
            const max = ${channelLimit};
            checks.forEach(cb => cb.addEventListener('change', () => {
              const checked = document.querySelectorAll('input[name="channels"]:checked');
              if (checked.length >= max) {
                checks.forEach(c => { if (!c.checked) c.disabled = true; });
              } else {
                checks.forEach(c => c.disabled = false);
              }
            }));
          ` }} />
        )}
      </body>
    </html>
  ));
});

// POST /onboarding/channels
// Saves selected channels and triggers backfill.
// Auth: onboarding_ws session cookie set during GET.
onboardingRoutes.post("/channels", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const workspaceId = body["workspace_id"] as string;
  if (!workspaceId) return c.text("Missing workspace_id", 400);

  // Verify signed session cookie matches the submitted workspace
  const cookieId = readSignedCookieValue(getCookie(c, COOKIE_NAME));
  if (cookieId !== workspaceId) {
    return c.text("Unauthorized. Your session has expired — please re-install the Slack app.", 401);
  }

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
  });
  if (!workspace) return c.text("Workspace not found", 404);

  // Each checkbox value is "channelId:channelName" — no second Slack API call needed
  const rawValues = (
    Array.isArray(body["channels"]) ? body["channels"] : [body["channels"]]
  ).filter(Boolean) as string[];

  if (rawValues.length === 0) {
    return c.redirect(`/onboarding?workspace=${workspaceId}&error=no_channels`, 302);
  }

  const parsed = rawValues.map((v) => {
    const colon = v.indexOf(":");
    return { id: v.slice(0, colon), name: v.slice(colon + 1) };
  });

  // Enforce channel limit
  const limitCheck = await checkLimit(workspaceId, "channels");
  const cap = limitCheck.limit === Infinity ? parsed.length : limitCheck.limit;
  const toActivate = parsed.slice(0, cap);

  for (const { id: slackChannelId, name } of toActivate) {
    await db
      .insert(channels)
      .values({ workspaceId, slackChannelId, name, isActive: true, backfillStatus: "pending" })
      .onConflictDoUpdate({
        target: [channels.workspaceId, channels.slackChannelId],
        set: { isActive: true, backfillStatus: "pending", name },
      });
  }

  await backfillQueue.add(
    "backfill",
    { workspaceId },
    { jobId: `backfill-${workspaceId}` }
  );

  return c.html(withDoctype(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Anansi — Indexing started!</title>
        <style>{`
          ${TOKENS_CSS}
          ${BASE_CSS}
          ${THEME_TOGGLE_CSS}
          body{min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center}
          .complete{width:min(100%,520px);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:42px 28px}
          .mark{display:grid;place-items:center;width:42px;height:42px;margin:0 auto 18px;border-radius:50%;border:1px solid var(--ok-border);background:var(--ok-soft);color:var(--ok);font-family:var(--font-mono)}
          h1{font-family:var(--font-display);font-size:2.2rem;font-weight:600;line-height:1.05;letter-spacing:-.045em;margin-bottom:12px}
          .pill{display:inline-block;background:var(--ok-soft);color:var(--ok);border:1px solid var(--ok-border);padding:4px 8px;border-radius:var(--radius-sm);font-family:var(--font-mono);font-size:.7rem;margin:3px}
          .theme-toggle{position:fixed;top:18px;right:18px;z-index:1}
        `}</style>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div dangerouslySetInnerHTML={{ __html: THEME_TOGGLE_HTML }} />
        <main class="complete">
          <div class="mark" aria-hidden="true">✓</div>
          <div class="eyebrow" style="margin-bottom:10px">Source setup complete</div>
          <h1>Indexing started</h1>
          <p>Anansi is now reading these channels:</p>
          <p>{toActivate.map(({ id, name }) => <span class="pill">#{name || id}</span>)}</p>
          {parsed.length > toActivate.length && (
            <p class="alert alert-warn" role="status" style="margin-top:16px;text-align:left">
              Your plan supports {cap} channel{cap === 1 ? "" : "s"}, so {parsed.length - toActivate.length} of your
              selections weren't activated. Upgrade to index more channels.
            </p>
          )}
          <p style="margin-top:24px;color:var(--text-muted)">Backfill takes a few minutes. Once done, head to Slack and try <code>/ask what did we decide about…</code></p>
        </main>
      </body>
    </html>
  ));
});
