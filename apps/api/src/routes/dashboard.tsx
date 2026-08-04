/** @jsxImportSource hono/jsx */

/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { eq, count, and } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "../lib/db/index.js";
import { workspaces, channels, subscriptions, memoryChunks, staticDocuments, backfillStatusEnum, developerAccounts, developerApiKeys } from "../lib/db/schema.js";
import { validateDashboardToken } from "../lib/auth/dashboard-auth.js";
import { signCookieValue, readSignedCookieValue } from "../lib/utils/crypto.js";
import { getUsageSummary } from "../lib/billing/usage.js";
import { formatLimit } from "../lib/billing/plans.js";
import { hashApiKey } from "../lib/auth/api-auth.js";
import { checkRateLimit } from "../lib/infra/rate-limit.js";
import type { PlanName } from "../lib/billing/plans.js";
import {
  TOKENS_CSS,
  BASE_CSS,
  THEME_TOGGLE_CSS,
  THEME_SCRIPT,
  THEME_TOGGLE_HTML,
  COPY_SCRIPT,
  withDoctype,
} from "../lib/ui/theme.js";

type DashVars = {
  workspaceId: string;
  workspace: typeof workspaces.$inferSelect;
};

export const dashboardRoutes = new Hono<{ Variables: DashVars }>();

const COOKIE_NAME = "dash_ws";
const COOKIE_TTL = 60 * 60 * 8; // 8 hours

// ─── Auth middleware ──────────────────────────────────────────────────────────

async function requireAuth(c: Context<{ Variables: DashVars }>, next: () => Promise<void>) {
  const token = c.req.query("token");

  if (token) {
    // Slack's link-unfurling bot GETs every URL posted in DMs — return a preview
    // page without consuming the token so the actual user click still works.
    const ua = c.req.header("user-agent") ?? "";
    if (ua.toLowerCase().includes("slackbot") || ua.toLowerCase().includes("slack-imgproxy")) {
      return c.html(withDoctype(
        <html>
          <head>
            <title>Anansi Dashboard</title>
            <meta property="og:title" content="Anansi Dashboard" />
            <meta property="og:description" content="Open your Anansi workspace dashboard." />
          </head>
          <body>Click the link in Slack to open your dashboard.</body>
        </html>
      ));
    }

    // Rate-limit token consumption: 20 attempts per minute per IP.
    // Tokens are 32 random bytes (2^256 space) so brute force is impossible,
    // but throttling caps any scanning attempt early.
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    if (!await checkRateLimit(`dashboard:token:${ip}`, 20)) {
      return c.html(expiredPage(), 429);
    }

    // Real user click — consume the token
    const workspaceId = await validateDashboardToken(token);
    if (workspaceId) {
      setCookie(c, COOKIE_NAME, signCookieValue(workspaceId), {
        httpOnly: true,
        sameSite: "Lax",
        maxAge: COOKIE_TTL,
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
      return c.redirect("/dashboard", 302);
    }
    return c.html(expiredPage(), 401);
  }

  const workspaceId = readSignedCookieValue(getCookie(c, COOKIE_NAME));
  if (!workspaceId) return c.html(loginPage(), 401);

  // Verify workspace still exists
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
  });
  if (!ws) {
    return c.html(loginPage(), 401);
  }

  c.set("workspaceId", workspaceId);
  c.set("workspace", ws);
  await next();
}

// ─── Pages ────────────────────────────────────────────────────────────────────

dashboardRoutes.get("/", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const workspace = c.get("workspace") as typeof workspaces.$inferSelect;

  const devAccount = await db.query.developerAccounts.findFirst({
    where: eq(developerAccounts.workspaceId, workspaceId),
  });

  const [usage, sub, channelRows, [{ value: totalChunks }], apiKeys] = await Promise.all([
    getUsageSummary(workspaceId),
    db.query.subscriptions.findFirst({ where: eq(subscriptions.workspaceId, workspaceId) }),
    db.query.channels.findMany({ where: eq(channels.workspaceId, workspaceId) }),
    db.select({ value: count() }).from(memoryChunks).where(eq(memoryChunks.workspaceId, workspaceId)),
    devAccount
      ? db.query.developerApiKeys.findMany({ where: eq(developerApiKeys.developerId, devAccount.id) })
      : Promise.resolve([]),
  ]);

  const plan = (sub?.plan ?? "free") as PlanName;

  const statusColors: Record<typeof backfillStatusEnum.enumValues[number], string> = {
    complete: "#166534",
    running: "#92400e",
    pending: "#1e40af",
    failed: "#991b1b",
  };

  const planBadgeClass =
    plan === "pro" ? "badge-ok" : plan === "enterprise" ? "badge-warn" : "badge-neutral";

  return c.html(withDoctype(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Anansi Dashboard — {workspace.slackTeamName ?? ""}</title>
        <style>{`
          ${TOKENS_CSS}
          ${BASE_CSS}
          ${THEME_TOGGLE_CSS}
          body{max-width:1060px;margin:0 auto;padding:clamp(24px,5vw,64px) 20px 88px}
          .workspace-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:26px;margin-bottom:26px;border-bottom:1px solid var(--border)}
          h1{font-family:var(--font-display);font-size:clamp(2.1rem,4vw,3.35rem);font-weight:600;line-height:1;letter-spacing:-.05em;margin:6px 0 8px}
          .team{color:var(--text-muted);font-family:var(--font-mono);font-size:.69rem;letter-spacing:.03em}
          .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:22px}
          .card{position:relative;padding:18px;margin-bottom:0;overflow:hidden}
          .card:before{content:"";position:absolute;top:0;left:0;width:32px;height:2px;background:var(--brand)}
          .card h3{font-family:var(--font-mono);font-size:.65rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.08em;margin:0 0 9px;font-weight:650}
          .card .big{font-family:var(--font-display);font-size:2rem;font-weight:600;line-height:1;margin:0;letter-spacing:-.045em}
          .card .sub{font-family:var(--font-mono);font-size:.68rem;color:var(--text-muted);margin-top:7px}
          .plan-badge{margin-left:10px;vertical-align:middle}
          .channels{overflow-x:auto}
          .channels table,table.data{width:100%;border-collapse:collapse;font-size:.86rem}
          .channels th,table.data th{text-align:left;font-family:var(--font-mono);font-size:.65rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);font-weight:600;border-bottom:1px solid var(--border);padding:7px 0}
          .channels td,table.data td{padding:12px 0;border-bottom:1px solid var(--border);vertical-align:middle;color:var(--text-secondary)}
          table.data{margin-bottom:16px}
          table.data td:first-child{color:var(--text)}
          .status{display:inline-block;padding:3px 6px;border-radius:var(--radius-sm);font-family:var(--font-mono);font-size:.64rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:#fff}
          .section{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:22px;margin-bottom:14px}
          .section h2{font-family:var(--font-display);font-size:1.35rem;font-weight:600;line-height:1.1;margin:0 0 16px;color:var(--text);letter-spacing:-.03em}
          .meter{background:var(--surface-2);border-radius:var(--radius-pill);height:4px;margin-top:10px}
          .meter-fill{height:4px;border-radius:var(--radius-pill);background:var(--brand);transition:width .3s}
          .empty{padding:16px 0;font-size:.88rem}
          .danger-zone{background:var(--danger-soft);border:1px solid var(--danger-border);border-radius:var(--radius-lg);padding:22px;margin-top:24px}
          .danger-zone h2{font-family:var(--font-display);font-size:1.35rem;font-weight:600;line-height:1.1;margin:0 0 6px;color:var(--danger)}
          .danger-zone p{font-size:.84rem;color:var(--text-muted);margin:0 0 14px}
          .danger-zone .btn-danger{background:var(--danger);color:#fff;border:none}
          .danger-zone .btn-danger:hover{filter:brightness(.9)}
          .purge-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--danger-border);font-size:.88rem;color:var(--text-secondary)}
          .purge-row:last-child{border-bottom:none}
          a code{color:var(--brand)}
          input[type=text]{background:var(--surface);border:1px solid var(--border-strong);color:var(--text);padding:9px 11px;border-radius:var(--radius-md);font-size:.84rem;width:240px;margin-right:8px}
          input[type=text]:focus{outline:none;border-color:var(--brand);box-shadow:var(--focus-ring)}
          input[type=text]::placeholder{color:var(--text-muted)}
          .theme-toggle{position:fixed;top:18px;right:18px;z-index:100}
          @media(max-width:680px){body{padding:26px 14px 56px}.workspace-header{padding-right:42px}.grid{grid-template-columns:1fr}.section{padding:18px}.purge-row{align-items:flex-start;flex-direction:column}input[type=text]{width:100%;margin:0 0 10px}.theme-toggle{top:12px;right:12px}}
        `}</style>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div dangerouslySetInnerHTML={{ __html: THEME_TOGGLE_HTML }} />
        <main>
          <header class="workspace-header">
            <div>
              <div class="eyebrow">Workspace record</div>
              <h1>
                {workspace.slackTeamName ?? ""}
                <span class={`badge plan-badge ${planBadgeClass}`}>{plan.charAt(0).toUpperCase() + plan.slice(1)}</span>
              </h1>
              <p class="team">Usage period · {usage.month}</p>
            </div>
          </header>

          {/* Usage meters */}
          <div class="grid">
          <UsageCard
            label="Queries"
            used={usage.queries.used}
            limit={usage.queries.limit}
          />
          <UsageCard
            label="Messages indexed"
            used={usage.messages.used}
            limit={usage.messages.limit}
          />
          <UsageCard
            label="Active channels"
            used={usage.channels.used}
            limit={usage.channels.limit}
          />
          </div>

        {/* Channels */}
          <div class="section">
          <h2>Indexed channels</h2>
          {channelRows.length === 0 ? (
            <p class="empty">No channels indexed yet. Use <code>/memory channels</code> in Slack to add some.</p>
          ) : (
            <div class="channels">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Channel</th>
                    <th scope="col">Backfill status</th>
                  </tr>
                </thead>
                <tbody>
                  {channelRows.map((ch) => (
                    <tr>
                      <td>#{ch.name}</td>
                      <td>
                        <span
                          class="status"
                          style={`background:${statusColors[ch.backfillStatus] ?? "#6b7280"}`}
                        >
                          {ch.backfillStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>

        {/* Billing */}
          <div class="section">
          <h2>Billing</h2>
          {plan === "free" ? (
            <div>
              <p style="margin:0 0 12px;font-size:.88rem;color:var(--text-muted)">
                You're on the Free plan. Upgrade to Pro for unlimited channels, 50k messages/month, and 500 queries/month.
              </p>
              <form method="post" action={`/billing/checkout?workspace=${workspaceId}`} style="display:inline">
                <button type="submit" class="btn btn-primary">Upgrade to Pro — $19/month →</button>
              </form>
            </div>
          ) : (
            <div>
              <p style="margin:0 0 12px;font-size:.88rem;color:var(--text-muted)">
                You're on the {plan.charAt(0).toUpperCase() + plan.slice(1)} plan.{" "}
                Status: {sub?.status ?? "active"}.
              </p>
              <form method="post" action={`/billing/portal?workspace=${workspaceId}`} style="display:inline">
                <button type="submit" class="btn btn-outline">Manage subscription →</button>
              </form>
            </div>
          )}
          </div>

        {/* API Keys */}
          <div class="section">
          <h2>API Keys</h2>
          <p style="margin:0 0 14px;font-size:.84rem;color:var(--text-muted)">
            Use these keys to call <code>POST /v1/ingest</code> and <code>GET /v1/context</code> from your LLM app.
            Keys are shown once at creation — store them safely.
          </p>
          {apiKeys.length > 0 && (
            <table class="data">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Created</th>
                  <th scope="col">Last used</th>
                  <th scope="col"><span class="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((k) => (
                  <tr>
                    <td>{k.name}</td>
                    <td>{k.createdAt.toLocaleDateString()}</td>
                    <td>{k.lastUsedAt ? k.lastUsedAt.toLocaleDateString() : "Never"}</td>
                    <td>
                      <form method="post" action="/dashboard/api-keys/revoke" style="display:inline"
                            data-key-name={k.name}
                            onsubmit="return confirm('Revoke key &quot;' + this.dataset.keyName + '&quot;? This cannot be undone.')">
                        <input type="hidden" name="keyId" value={k.id} />
                        <button type="submit" class="btn btn-danger btn-sm">Revoke</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form method="post" action="/dashboard/api-keys">
            <input type="text" name="keyName" placeholder="Key name (e.g. Production)" aria-label="API key name" required />
            <button type="submit" class="btn btn-primary">Create API Key</button>
          </form>
          </div>

        {/* Danger Zone */}
          <div class="danger-zone">
          <h2>Danger Zone</h2>
          <p>Permanently delete indexed memory. This cannot be undone. The bot will re-index as new messages arrive.</p>

          {channelRows.length > 0 && (
            <div style="margin-bottom:16px">
              {channelRows.map((ch) => (
                <div class="purge-row">
                  <span>#{ch.name}</span>
                  <form method="post" action="/dashboard/purge/channel"
                        data-channel-name={ch.name}
                        onsubmit="return confirm('Delete all indexed memory for #' + this.dataset.channelName + '? This cannot be undone.')">
                    <input type="hidden" name="channelId" value={ch.id} />
                    <input type="hidden" name="channelName" value={ch.name} />
                    <button type="submit" class="btn btn-danger" style="padding:4px 12px;font-size:.8rem">
                      Purge #{ch.name}
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}

          <form method="post" action="/dashboard/purge" data-count={String(totalChunks)} onsubmit="return confirm('Delete ALL ' + this.dataset.count + ' indexed chunks and synthesized memory? This cannot be undone.')">
            <button type="submit" class="btn btn-danger">
              Purge all memory ({totalChunks.toLocaleString()} chunks)
            </button>
          </form>
          </div>
        </main>
      </body>
    </html>
  ));
});

// ─── Purge routes ─────────────────────────────────────────────────────────────

dashboardRoutes.post("/purge", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  await Promise.all([
    db.delete(memoryChunks).where(eq(memoryChunks.workspaceId, workspaceId)),
    db.delete(staticDocuments).where(eq(staticDocuments.workspaceId, workspaceId)),
  ]);
  console.log(`[dashboard purge] Workspace ${workspaceId} purged all memory`);
  return c.redirect("/dashboard", 302);
});

dashboardRoutes.post("/purge/channel", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const body = await c.req.parseBody();
  const channelId = body["channelId"] as string | undefined;
  const channelName = body["channelName"] as string | undefined;

  if (!channelId) return c.redirect("/dashboard", 302);

  const channelRow = await db.query.channels.findFirst({
    where: and(eq(channels.workspaceId, workspaceId), eq(channels.id, channelId)),
    columns: { id: true },
  });

  if (!channelRow) return c.redirect("/dashboard", 302);

  await db.delete(memoryChunks).where(
    and(eq(memoryChunks.workspaceId, workspaceId), eq(memoryChunks.channelId, channelId))
  );
  console.log(`[dashboard purge] Workspace ${workspaceId} purged channel ${channelName ?? channelId}`);
  return c.redirect("/dashboard", 302);
});

// ─── API key routes ────────────────────────────────────────────────────────────

const WAITLIST_MODE = process.env.WAITLIST_MODE === "true";

dashboardRoutes.post("/api-keys", requireAuth, async (c) => {
  if (WAITLIST_MODE) {
    return c.html(withDoctype(
      <html lang="en"><head><meta charset="utf-8" /><title>Paused — Anansi</title>
        <style>{`${TOKENS_CSS}${BASE_CSS}body{max-width:520px;margin:60px auto;padding:0 16px}`}</style>
      </head><body>
        <h1 style="font-size:1.2rem;font-weight:600;margin-bottom:8px">API key creation paused</h1>
        <p style="color:var(--text-muted);font-size:.88rem;margin-bottom:20px">
          Anansi is in private beta — new keys are temporarily disabled while the backend is being hardened.
        </p>
        <a href="/dashboard" style="color:var(--brand)">← Back to dashboard</a>
      </body></html>
    ));
  }
  const workspaceId = c.get("workspaceId") as string;
  const workspace = c.get("workspace") as typeof workspaces.$inferSelect;
  const body = await c.req.parseBody();
  const keyName = (body["keyName"] as string | undefined)?.slice(0, 80) || "Default";

  // Upsert developer account (auto-created on first key generation)
  const [devAccount] = await db
    .insert(developerAccounts)
    .values({ workspaceId, name: workspace.slackTeamName ?? "", email: `${workspaceId}@anansimemory.com` })
    .onConflictDoUpdate({
      target: [developerAccounts.workspaceId],
      set: { name: workspace.slackTeamName ?? "" },
    })
    .returning({ id: developerAccounts.id });

  const rawKey = randomBytes(32).toString("hex");
  const keyHash = hashApiKey(rawKey);

  await db.insert(developerApiKeys).values({
    developerId: devAccount.id,
    keyHash,
    name: keyName,
  });

  console.log(`[dashboard] Workspace ${workspaceId} created API key "${keyName}"`);

  return c.html(withDoctype(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>API Key Created — Anansi</title>
        <style>{`
          ${TOKENS_CSS}
          ${BASE_CSS}
          body{max-width:600px;margin:60px auto;padding:0 16px}
          .key-box{background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-md);padding:16px;margin:16px 0;font-family:var(--font-mono);font-size:.88rem;word-break:break-all;color:var(--ok);user-select:all}
        `}</style>
      </head>
      <body>
        <h1 style="font-size:1.3rem;margin-bottom:4px;font-weight:600;letter-spacing:-0.2px">API Key Created</h1>
        <p style="color:var(--text-muted);margin-bottom:20px;font-size:.9rem">Key name: <strong style="color:var(--text)">{keyName}</strong></p>
        <div class="alert alert-warn">
          ⚠ This key is shown <strong>only once</strong>. Copy it now — you won't be able to see it again.
        </div>
        <div class="key-box" id="new-api-key">{rawKey}</div>
        <p style="font-size:.84rem;color:var(--text-muted);margin-bottom:24px">
          Use it as: <code>Authorization: Bearer {rawKey}</code>
        </p>
        <div style="display:flex;gap:10px">
          <button type="button" class="btn btn-primary" data-copy-target="#new-api-key">Copy key</button>
          <a href="/dashboard" class="btn btn-outline">← Back to Dashboard</a>
        </div>
        <script dangerouslySetInnerHTML={{ __html: COPY_SCRIPT }} />
      </body>
    </html>
  ));
});

dashboardRoutes.post("/api-keys/revoke", requireAuth, async (c) => {
  const workspaceId = c.get("workspaceId") as string;
  const body = await c.req.parseBody();
  const keyId = body["keyId"] as string | undefined;

  if (!keyId) return c.redirect("/dashboard", 302);

  // Verify the key belongs to this workspace's developer account
  const devAccount = await db.query.developerAccounts.findFirst({
    where: eq(developerAccounts.workspaceId, workspaceId),
    columns: { id: true },
  });
  if (!devAccount) return c.redirect("/dashboard", 302);

  await db
    .delete(developerApiKeys)
    .where(and(eq(developerApiKeys.id, keyId), eq(developerApiKeys.developerId, devAccount.id)));

  console.log(`[dashboard] Workspace ${workspaceId} revoked API key ${keyId}`);
  return c.redirect("/dashboard", 302);
});

function UsageCard({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit === Infinity ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const color = pct >= 90 ? "var(--danger)" : pct >= 70 ? "var(--warn)" : "var(--brand)";
  return (
    <div class="card">
      <h3>{label}</h3>
      <p class="big">{used.toLocaleString()}</p>
      <p class="sub">of {formatLimit(limit)}</p>
      {limit !== Infinity && (
        <div class="meter">
          <div class="meter-fill" style={`width:${pct}%;background:${color}`} />
        </div>
      )}
    </div>
  );
}

// ─── Plain-HTML helper pages ───────────────────────────────────────────────────

const HELPER_PAGE_CSS = `
  ${TOKENS_CSS}
  ${BASE_CSS}
  body{max-width:420px;margin:80px auto;padding:0 16px;text-align:center}
  h1{font-size:1.3rem;font-weight:600;letter-spacing:-0.2px}
  p{color:var(--text-muted);line-height:1.6;font-size:.9rem}
`;

function loginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Anansi Dashboard</title>
<style>${HELPER_PAGE_CSS}</style>
</head>
<body>
  <h1>Anansi Dashboard</h1>
  <p>To access your workspace dashboard, run <code>/memory dashboard</code> in Slack.<br>
  The bot will send you a one-time sign-in link.</p>
  <p style="margin-top:24px"><a href="/portal/login">Developer portal →</a></p>
</body></html>`;
}

function expiredPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Link expired — Anansi</title>
<style>${HELPER_PAGE_CSS}</style>
</head>
<body>
  <h1>Link expired</h1>
  <p>Dashboard links are valid for 30 minutes and can only be used once.<br>
  Run <code>/memory dashboard</code> in Slack to get a fresh link.</p>
</body></html>`;
}
