/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../lib/db/index.js";
import { staticDocuments, workspaces } from "../lib/db/schema.js";
import { TOKENS_CSS, BASE_CSS, withDoctype } from "../lib/ui/theme.js";

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
          body { padding: 32px 16px 64px }
          .container { max-width: 680px; margin: 0 auto }
          .header { margin-bottom: 32px }
          .workspace { font-size: .8rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px }
          h1 { font-size: 1.5rem; font-weight: 700; letter-spacing: -.02em; margin-bottom: 8px }
          .meta { font-size: .82rem; color: var(--text-muted) }
          .meta a { color: inherit }

          .banner {
            background: var(--warn-soft);
            border: 1px solid var(--warn-border);
            border-radius: var(--radius-md);
            padding: 10px 14px;
            font-size: .83rem;
            color: var(--warn);
            margin-bottom: 24px;
          }

          .section { margin-bottom: 32px }
          .section-title {
            font-size: .72rem;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: .08em;
            color: var(--text-muted);
            margin-bottom: 12px
          }
          .fact-list { list-style: none; display: flex; flex-direction: column; gap: 6px }
          .fact {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius-md);
            padding: 10px 14px;
            font-size: .9rem;
            line-height: 1.5;
            display: flex;
            gap: 10px;
            align-items: flex-start;
          }
          .fact.cited {
            background: var(--warn-soft);
            border-color: var(--warn-border);
          }
          .fact-num {
            font-size: .72rem;
            font-weight: 700;
            color: var(--text-muted);
            min-width: 28px;
            padding-top: 2px;
          }
          .fact.cited .fact-num { color: var(--warn) }
          .fact-text { flex: 1 }
          .cited-tag {
            font-size: .68rem;
            font-weight: 700;
            background: var(--warn-soft);
            border: 1px solid var(--warn-border);
            color: var(--warn);
            padding: 2px 6px;
            border-radius: var(--radius-pill);
            white-space: nowrap;
          }
          .empty { font-style: italic; padding: 10px 0 }
        `}</style>
      </head>
      <body>
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
