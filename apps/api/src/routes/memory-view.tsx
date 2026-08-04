/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import { staticDocuments, workspaces } from "../lib/db/schema.js";
import { TOKENS_CSS, BASE_CSS, THEME_TOGGLE_CSS, THEME_TOGGLE_HTML, THEME_SCRIPT, withDoctype } from "../lib/ui/theme.js";

export const memoryViewRoutes = new Hono();

// GET /memory/view?workspace=<id>&sf=1,3&dc=2
// Public read-only view of the synthesized static document.
// The workspace UUID is effectively a secret; no separate auth needed for MVP.
memoryViewRoutes.get("/view", async (c) => {
  const workspaceId = c.req.query("workspace");
  if (!workspaceId || !/^[0-9a-f-]{36}$/.test(workspaceId))
    return c.text("Invalid workspace", 400);

  const sfParam = c.req.query("sf") ?? "";
  const dcParam = c.req.query("dc") ?? "";
  const highlightSf = new Set(
    sfParam.split(",").filter(Boolean).map((n) => parseInt(n, 10))
  );
  const highlightDc = new Set(
    dcParam.split(",").filter(Boolean).map((n) => parseInt(n, 10))
  );

  const [workspace, staticDoc] = await Promise.all([
    db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
      columns: { slackTeamName: true },
    }),
    db.query.staticDocuments.findFirst({
      where: eq(staticDocuments.workspaceId, workspaceId),
    }),
  ]);

  if (!workspace) return c.text("Workspace not found", 404);

  const lastSynced = staticDoc?.lastSynthesizedAt
    ? staticDoc.lastSynthesizedAt.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const hasCitations = highlightSf.size > 0 || highlightDc.size > 0;

  return c.html(withDoctype(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{workspace.slackTeamName} — Memory</title>
        <style>{`
          ${TOKENS_CSS}
          ${BASE_CSS}
          ${THEME_TOGGLE_CSS}
          body { padding:clamp(28px,7vw,84px) 16px 72px }
          .container { max-width: 760px; margin: 0 auto }
          .header { display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:end;padding-bottom:28px;margin-bottom:34px;border-bottom:1px solid var(--border) }
          .workspace { font-family:var(--font-mono);font-size:.66rem;font-weight:650;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px }
          h1 { font-family:var(--font-display);font-size:clamp(2rem,5vw,3rem);font-weight:600;line-height:1.02;letter-spacing:-.045em;margin-bottom:8px }
          .meta { font-family:var(--font-mono);font-size:.69rem;color:var(--text-muted);white-space:nowrap }
          .meta a { color: inherit }

          .banner {
            background: var(--brand-soft);
            border-left: 2px solid var(--brand);
            padding: 11px 13px;
            font-size: .82rem;
            color: var(--text-secondary);
            margin-bottom: 30px;
          }

          .section { margin-bottom: 38px }
          .section-title {
            font-family:var(--font-mono);
            font-size: .67rem;
            font-weight: 650;
            text-transform: uppercase;
            letter-spacing: .1em;
            color: var(--text-muted);
            margin-bottom: 12px;
          }
          .fact-list { list-style: none; display: flex; flex-direction: column; gap:8px }
          .fact {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            box-shadow:var(--shadow-card);
            padding: 14px 16px;
            font-size: .91rem;
            line-height: 1.6;
            display: flex;
            gap: 14px;
            align-items: flex-start;
          }
          .fact.cited {
            background: var(--brand-soft);
            border-color: var(--brand);
            box-shadow:none;
          }
          .fact-num {
            font-family:var(--font-mono);
            font-size: .68rem;
            font-weight: 650;
            color: var(--text-muted);
            min-width: 34px;
            padding-top: 3px;
          }
          .fact.cited .fact-num { color: var(--brand) }
          .fact-text { flex: 1 }
          .cited-tag {
            font-family:var(--font-mono);
            font-size: .61rem;
            font-weight:650;
            text-transform:uppercase;
            letter-spacing:.07em;
            color: var(--brand);
            padding: 3px 5px;
            border:1px solid var(--brand);
            border-radius: var(--radius-sm);
            white-space: nowrap;
          }
          .empty { font-family:var(--font-display);font-size:1.06rem;color:var(--text-secondary);font-style:italic;padding:10px 0 }
          .theme-toggle{position:fixed;top:18px;right:18px;z-index:1}
          @media(max-width:540px){.header{grid-template-columns:1fr;gap:10px}.meta{white-space:normal}.fact{padding:12px;gap:10px}.fact-num{min-width:30px}.cited-tag{display:none}}
        `}</style>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <div dangerouslySetInnerHTML={{ __html: THEME_TOGGLE_HTML }} />
        <div class="container">
          <div class="header">
            <div class="workspace">{workspace.slackTeamName}</div>
            <h1>Synthesized Memory</h1>
            <p class="meta">
              {lastSynced ? `Last updated ${lastSynced}` : "Not yet synthesized"}
            </p>
          </div>

          {hasCitations && (
            <div class="banner">
              ✦ Highlighted items were cited in answering your question.
            </div>
          )}

          <div class="section">
            <div class="section-title">Permanent Knowledge</div>
            {!staticDoc?.staticFacts?.length ? (
              <p class="empty">No permanent facts yet — memory builds up as Slack activity is synthesized.</p>
            ) : (
              <ul class="fact-list">
                {staticDoc.staticFacts.map((fact, i) => {
                  const cited = highlightSf.has(i);
                  return (
                    <li class={`fact${cited ? " cited" : ""}`}>
                      <span class="fact-num">SF{i + 1}</span>
                      <span class="fact-text">{fact}</span>
                      {cited && <span class="cited-tag">cited</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div class="section">
            <div class="section-title">Current Context</div>
            {!staticDoc?.dynamicContext?.length ? (
              <p class="empty">No current context yet.</p>
            ) : (
              <ul class="fact-list">
                {staticDoc.dynamicContext.map((item, i) => {
                  const cited = highlightDc.has(i);
                  return (
                    <li class={`fact${cited ? " cited" : ""}`}>
                      <span class="fact-num">DC{i + 1}</span>
                      <span class="fact-text">{item}</span>
                      {cited && <span class="cited-tag">cited</span>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </body>
    </html>
  ));
});
