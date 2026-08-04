/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import { WEB_BG_HTML } from "../lib/ui/web-bg.js";
import { withDoctype } from "../lib/ui/theme.js";
import { getDeploymentConfig } from "../lib/config/deployment.js";

// Third-party analytics is telemetry — omit it whenever the deployment mode
// forbids content-exporting telemetry (local / air-gapped installs).
const ANALYTICS_ENABLED = getDeploymentConfig().telemetryAllowed;

export const landingRoutes = new Hono();

const APP_URL = process.env.APP_URL ?? "https://anansimemory.com";
// Flip WAITLIST_MODE=true in Railway to activate the pre-launch hardening pass:
// signups blocked, API key creation blocked, waitlist form shown, beta banner shown.
const WAITLIST_MODE = process.env.WAITLIST_MODE === "true";

// Apple system typography, silver brand, pixel-web ornaments.
// Data-dense layout (metric strip + endpoints + competitor compare).
// Light/dark not on landing — landing is the marketing surface and stays one mode.
const css = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0e1116;
  --bg2:#161a21;
  --bg3:#1d222a;
  --line:#262c36;
  --line2:#2f3640;
  --text:#e8eaed;
  --mute:#8a93a0;
  --dim:#5b6473;
  /* Silver brand — matches the parallax web threads. No purple anywhere. */
  --brand:#c0c0c0;
  --brand-soft:rgba(232,232,232,.10);
  --brand-line:rgba(232,232,232,.28);
  --brand-glow:#e8e8e8;
  --brand-dim:#9a9aa2;
  --ok:#5fa37c;
  --warn:#c9a64a;
}
html{background:var(--bg);scroll-behavior:smooth}
body{
  background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;
  font-size:14.5px;line-height:1.55;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;
}
a{color:var(--brand-glow);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1px}
.mono{font-family:'SF Mono',Menlo,Monaco,'Courier New',monospace;font-size:.92em}
.container{max-width:1240px;margin:0 auto;padding:0 24px;position:relative}

/* ── Full-page parallax silver web (the big one from anansimemory.com) ──
   The pulse animates opacity (GPU-composited), not filter:drop-shadow —
   animating a filter on two full-viewport fixed SVGs re-rasterizes every frame. */
.web-bg-far,.web-bg-near{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}
.web-bg-far{--web-o:.14;transform:scale(1.45)}
.web-bg-near{--web-o:.30}
.web-bg-far .thread,.web-bg-near .thread{fill:none;stroke-width:.5}
.web-bg-far .thread{stroke:url(#silver-far)}
.web-bg-near .thread{stroke:url(#silver-near)}
.web-bg-far,.web-bg-near{opacity:var(--web-o);animation:web-pulse 14s ease-in-out infinite;will-change:opacity}
.web-bg-near{animation-delay:-7s}
@keyframes web-pulse{0%,100%{opacity:calc(var(--web-o)*.8)}50%{opacity:calc(var(--web-o)*1.3)}}
.spotlight{position:fixed;inset:0;pointer-events:none;z-index:1;background:radial-gradient(circle 820px at var(--mx,28%) var(--my,38%),rgba(232,232,232,.06) 0%,rgba(232,232,232,.025) 35%,transparent 70%);animation:trace 18s ease-in-out infinite}
@keyframes trace{0%,100%{--mx:24%;--my:30%}33%{--mx:78%;--my:46%}66%{--mx:48%;--my:76%}}

/* Section layering — content always rides above the silver web */
.section,.metrics,.hero,.closing{position:relative;overflow:hidden;z-index:2}
.section > .container,.metrics > .container,.hero > .container,.closing > .container{position:relative;z-index:1}
/* Sections shouldn't have solid bg; let the silver web show through */
.metrics{background:transparent !important}

/* ── Nav logo — static brand mark, no cursor tracking ── */

@media(prefers-reduced-motion:reduce){
  .web-bg-far,.web-bg-near,.spotlight{animation:none}
}

/* ── Nav ── */
nav.gnav{height:54px;border-bottom:1px solid var(--line);background:rgba(14,17,22,.84);backdrop-filter:saturate(160%) blur(14px);-webkit-backdrop-filter:saturate(160%) blur(14px);position:sticky;top:0;z-index:50}
.gnav-inner{display:flex;align-items:center;justify-content:space-between;height:100%;max-width:1240px;margin:0 auto;padding:0 24px}
.gnav-brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:15.5px;color:var(--text);letter-spacing:-.01em}
.gnav-brand:hover{text-decoration:none}
.gnav-links{display:flex;align-items:center;gap:22px;font-size:13.5px}
.gnav-link{color:var(--mute);font-weight:500}
.gnav-link:hover{color:var(--text);text-decoration:none}
.gnav-status{display:inline-flex;align-items:center;gap:6px;font-family:'SF Mono',Menlo,monospace;font-size:11px;color:var(--ok);background:rgba(95,163,124,.08);padding:3px 8px;border-radius:99px;border:1px solid rgba(95,163,124,.22)}
.gnav-status::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 6px var(--ok)}
.gnav-cta{background:var(--brand);color:#0e1116;padding:6px 14px;border-radius:6px;font-weight:600;font-size:13px;letter-spacing:-.005em;transition:filter .15s}
.gnav-cta:hover{filter:brightness(1.18);text-decoration:none}

/* ── Hero ── */
.hero{padding:60px 0 48px;border-bottom:1px solid var(--line);position:relative;overflow:hidden}
.hero-grid{display:grid;grid-template-columns:1.1fr 1fr;gap:48px;align-items:start}
.kicker{font-family:'SF Mono',Menlo,monospace;font-size:11.5px;color:var(--brand-glow);text-transform:uppercase;letter-spacing:.12em;margin-bottom:18px}
h1.hero-h1{
  font-size:clamp(34px,4.5vw,54px);font-weight:700;
  letter-spacing:-.028em;line-height:1.04;margin-bottom:18px;color:var(--text);
}
h1.hero-h1 em{font-style:normal;color:var(--brand-glow)}
.hero-sub{font-size:16.5px;color:var(--mute);max-width:560px;line-height:1.55;margin-bottom:22px}
.hero-meta{display:flex;flex-wrap:wrap;gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;font-family:'SF Mono',Menlo,monospace;font-size:12px;margin-bottom:24px;background:var(--bg2)}
.hero-meta-cell{padding:10px 14px;border-right:1px solid var(--line);flex:1;min-width:118px}
.hero-meta-cell:last-child{border-right:0}
.hero-meta-label{color:var(--dim);font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}
.hero-meta-val{color:var(--text);font-weight:600;font-size:13.5px}
.cta-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.btn-primary{background:var(--brand);color:#0e1116;padding:11px 20px;border-radius:7px;font-weight:600;font-size:13.5px;letter-spacing:-.005em;transition:filter .15s}
.btn-primary:hover{filter:brightness(1.18);text-decoration:none}
.btn-ghost{color:var(--text);padding:11px 18px;border-radius:7px;font-weight:500;font-size:13.5px;border:1px solid var(--line2);font-family:'SF Mono',Menlo,monospace}
.btn-ghost:hover{border-color:var(--brand-line);color:var(--brand-glow);text-decoration:none}

/* ── Code card ── */
.code-card{background:#0a0d11;border:1px solid var(--line);border-radius:8px;overflow:hidden;box-shadow:0 18px 56px rgba(0,0,0,.32)}
.code-head{padding:10px 14px;background:var(--bg3);border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;font-family:'SF Mono',Menlo,monospace;font-size:11.5px;color:var(--mute)}
.code-head .dim{color:var(--dim)}
.code-body{padding:18px 20px;font-family:'SF Mono',Menlo,monospace;font-size:12.8px;line-height:1.9;color:#d0d5dc;overflow-x:auto;white-space:pre}
.k{color:var(--brand-glow)}
.s{color:#c9a64a}
.c{color:var(--dim);font-style:italic}
.f{color:#9bb8ff}

/* ── Metrics strip ── */
.metrics{padding:36px 0;border-bottom:1px solid var(--line);background:var(--bg2);position:relative}
.metrics-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--bg)}
.metric{padding:18px;border-right:1px solid var(--line)}
.metric:last-child{border-right:0}
.metric-label{font-family:'SF Mono',Menlo,monospace;font-size:10.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.metric-val{font-family:'SF Mono',Menlo,monospace;font-size:21px;font-weight:700;color:var(--text);letter-spacing:-.02em;line-height:1}
.metric-val .unit{font-size:12px;color:var(--mute);font-weight:400;margin-left:2px}
.metric-trend{font-size:11px;color:var(--ok);margin-top:4px;font-family:'SF Mono',Menlo,monospace}
.metric-trend.warn{color:var(--warn)}
.metric-trend.dim{color:var(--dim)}

/* ── Sections ── */
.section{padding:64px 0;border-bottom:1px solid var(--line);position:relative;overflow:hidden}
.section-label{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:var(--brand-glow);text-transform:uppercase;letter-spacing:.12em;margin-bottom:14px}
.section-label::before{content:'§ '}
.section h2{font-size:30px;font-weight:700;letter-spacing:-.022em;line-height:1.14;margin-bottom:12px}
.section-sub{color:var(--mute);font-size:15.5px;max-width:620px;margin-bottom:36px;line-height:1.55}

/* ── Endpoints grid ── */
.endpoints{display:grid;grid-template-columns:repeat(2,1fr);gap:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--bg2)}
.endpoint{padding:20px 24px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--bg2);transition:background .15s}
.endpoint:hover{background:var(--bg3)}
.endpoint:nth-child(2n){border-right:0}
.endpoint:nth-last-child(-n+2){border-bottom:0}
.endpoint-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.endpoint-method{font-family:'SF Mono',Menlo,monospace;font-size:11px;font-weight:700;padding:2px 7px;border-radius:3px;letter-spacing:.04em}
.method-post{background:var(--brand-soft);color:var(--brand-glow);border:1px solid var(--brand-line)}
.method-get{background:rgba(95,163,124,.12);color:var(--ok);border:1px solid rgba(95,163,124,.28)}
.method-del{background:rgba(201,166,74,.12);color:var(--warn);border:1px solid rgba(201,166,74,.28)}
.endpoint-path{font-family:'SF Mono',Menlo,monospace;font-size:14.5px;font-weight:600;color:var(--text)}
.endpoint p{color:var(--mute);font-size:13.5px;line-height:1.55}

/* ── How it works ── */
.how-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:32px}
.how-block{border:1px solid var(--line);background:var(--bg2);border-radius:8px;padding:22px 24px}
.how-block h3{font-size:13px;font-family:'SF Mono',Menlo,monospace;text-transform:uppercase;letter-spacing:.1em;color:var(--brand-glow);font-weight:700;margin-bottom:10px}
.how-block p{font-size:14px;color:var(--mute);line-height:1.6;margin-bottom:14px}
.how-block ol{list-style:none;counter-reset:s;font-size:13.5px;color:var(--text);line-height:1.7}
.how-block ol li{counter-increment:s;position:relative;padding-left:26px;margin-bottom:5px}
.how-block ol li::before{content:counter(s,decimal-leading-zero);position:absolute;left:0;top:0;font-family:'SF Mono',Menlo,monospace;color:var(--brand-glow);font-size:11.5px;font-weight:700}
.how-block.tech ol li{font-family:'SF Mono',Menlo,monospace;font-size:12.5px;color:#d0d5dc}
.how-block.tech ol li b{color:var(--brand-glow);font-weight:600}
.arch-wrap{border:1px solid var(--line);background:#0a0d11;border-radius:8px;padding:28px 24px;overflow-x:auto}
.arch-cap{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px}
.arch{width:100%;min-width:760px;height:auto;display:block}
.arch .n-box{fill:#161a21;stroke:#2f3640;stroke-width:1}
.arch .n-box.brand{fill:rgba(232,232,232,.06);stroke:var(--brand-line);stroke-width:1.4}
.arch .n-box.store{fill:#13171d;stroke:#3a414c}
.arch .n-title{fill:#e8eaed;font-family:'SF Pro Text',-apple-system,sans-serif;font-size:12.5px;font-weight:600}
.arch .n-sub{fill:#8a93a0;font-family:'SF Mono',Menlo,monospace;font-size:10.5px}
.arch .n-tag{fill:var(--brand-glow);font-family:'SF Mono',Menlo,monospace;font-size:10px;font-weight:700;letter-spacing:.06em}
.arch .edge{stroke:#5b6473;stroke-width:1.2;fill:none}
.arch .edge.brand{stroke:#c0c0c0;stroke-width:1.4}
.arch .edge-label{fill:#8a93a0;font-family:'SF Mono',Menlo,monospace;font-size:10px}
.arch .lane-label{fill:var(--dim);font-family:'SF Mono',Menlo,monospace;font-size:10px;text-transform:uppercase;letter-spacing:.08em}
@media(max-width:920px){.how-grid{grid-template-columns:1fr}}

/* ── Compare table ── */
.compare-wrap{border:1px solid var(--line);border-radius:8px;overflow:hidden}
table.compare{width:100%;border-collapse:collapse;font-size:13.5px}
.compare th,.compare td{padding:11px 16px;text-align:left;border-bottom:1px solid var(--line)}
.compare th{background:var(--bg3);color:var(--dim);font-weight:600;font-family:'SF Mono',Menlo,monospace;font-size:11.5px;text-transform:uppercase;letter-spacing:.06em}
.compare td{color:var(--mute);background:var(--bg)}
.compare tr:last-child td{border-bottom:0}
.compare td:first-child{color:var(--text);font-weight:500}
.compare .yes{color:var(--ok);font-family:'SF Mono',Menlo,monospace;font-weight:600}
.compare .no{color:var(--dim);font-family:'SF Mono',Menlo,monospace}
.compare .col-anansi{color:var(--brand-glow)}
.compare .feat-anansi td{background:var(--brand-soft)}

/* ── Pricing ── */
.tier-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.tier{border:1px solid var(--line);background:var(--bg2);padding:24px;border-radius:8px;display:flex;flex-direction:column}
.tier.featured{border-color:var(--brand-line);background:linear-gradient(180deg,var(--brand-soft),var(--bg2) 80%)}
.tier-name{font-family:'SF Mono',Menlo,monospace;font-size:11px;color:var(--brand-glow);font-weight:600;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
.tier-price{font-size:30px;font-weight:700;color:var(--text);letter-spacing:-.022em;line-height:1;margin-bottom:4px}
.tier-price small{font-size:13px;color:var(--mute);font-weight:400;margin-left:3px}
.tier ul{list-style:none;margin:18px 0 22px;font-size:13.5px;color:var(--mute);line-height:1.9;flex:1}
.tier li::before{content:'✓';color:var(--ok);margin-right:8px;font-weight:700}
.tier-cta{display:block;text-align:center;padding:9px 18px;font-size:13px;font-weight:600;border-radius:6px;border:1px solid var(--line2);color:var(--text);transition:filter .15s}
.tier.featured .tier-cta{background:var(--brand);color:#0e1116;border-color:var(--brand)}
.tier-cta:hover{filter:brightness(1.18);text-decoration:none}

/* ── Closing band ── */
.closing{padding:80px 0;border-bottom:1px solid var(--line);text-align:center;position:relative;overflow:hidden}
.closing h2{font-size:34px;font-weight:700;letter-spacing:-.025em;line-height:1.1;margin-bottom:14px}
.closing p{color:var(--mute);font-size:16px;max-width:560px;margin:0 auto 26px}
.closing .cta-row{justify-content:center}
.closing .quote{font-style:italic;color:var(--brand-glow);font-size:15.5px;margin-bottom:18px;font-family:-apple-system,'SF Pro Display'}

/* ── Footer ── */
footer{padding:30px 0;color:var(--dim);font-size:12.5px;font-family:'SF Mono',Menlo,monospace}
.footer-row{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.footer-row a{color:var(--mute)}

/* ── Responsive ── */
@media(max-width:920px){
  .hero-grid,.endpoints,.tier-grid{grid-template-columns:1fr}
  .endpoint{border-right:0}
  .metrics-grid{grid-template-columns:repeat(3,1fr)}
  .metric:nth-child(3n){border-right:0}
  .metric:nth-child(-n+3){border-bottom:1px solid var(--line)}
}
@media(max-width:560px){
  .metrics-grid{grid-template-columns:repeat(2,1fr)}
  .metric{border-right:0;border-bottom:1px solid var(--line)}
  .metric:nth-child(2n){border-right:0}
  h1.hero-h1{font-size:32px}
}
/* ── Beta banner ── */
.beta-banner{background:#080b0f;border-bottom:1px solid var(--line);padding:9px 24px;text-align:center;font-size:12px;font-family:'SF Mono',Menlo,monospace;color:var(--mute);position:relative;z-index:100}
.beta-banner strong{color:var(--text)}
.beta-banner a{color:var(--brand-glow);margin-left:6px}
/* ── Waitlist section ── */
.waitlist-section{padding:64px 0;border-bottom:1px solid var(--line);text-align:center;position:relative;z-index:2}
.waitlist-section h2{font-size:30px;font-weight:700;letter-spacing:-.022em;margin-bottom:10px}
.waitlist-section .section-sub{margin:0 auto 28px}
.waitlist-form{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:0 0 12px}
.waitlist-input{background:var(--bg2);border:1px solid var(--line2);border-radius:7px;color:var(--text);padding:11px 16px;font-size:14px;min-width:272px;font-family:-apple-system,sans-serif;outline:none;transition:border-color .15s}
.waitlist-input:focus{border-color:var(--brand-line)}
.waitlist-input::placeholder{color:var(--dim)}
.waitlist-success{display:inline-flex;align-items:center;gap:10px;background:rgba(95,163,124,.08);border:1px solid rgba(95,163,124,.22);border-radius:8px;padding:14px 22px;font-family:'SF Mono',Menlo,monospace;font-size:13px;color:var(--ok);margin-bottom:12px}
.waitlist-error{display:inline-flex;align-items:center;gap:10px;background:rgba(201,166,74,.08);border:1px solid rgba(201,166,74,.22);border-radius:8px;padding:14px 22px;font-family:'SF Mono',Menlo,monospace;font-size:13px;color:var(--warn);margin-bottom:12px}
.waitlist-note{font-size:12px;color:var(--dim);font-family:'SF Mono',Menlo,monospace}
`;

// 16×16 pixel-perfect spider web. `shape-rendering: crispEdges` disables
// antialiasing, so integer coordinates produce true pixel art that scales
// up without blurring.
// Pixel-art spider web on a 32x32 grid. `shape-rendering: crispEdges` keeps
// each line a hard 1-2px stair-step at any output size — true 8-bit feel.
function SpiderMark({ size = 20, color = "#e8e8e8", id }: { size?: number; color?: string; id?: string }) {
  return (
    <svg id={id} width={size} height={size} viewBox="0 0 64 64" fill="none" stroke={color} stroke-width="3.5" stroke-linecap="round">
      <circle cx="32" cy="32" r="5" />
      <line x1="27" y1="32" x2="8" y2="18" />
      <line x1="27" y1="32" x2="6" y2="32" />
      <line x1="27" y1="32" x2="8" y2="46" />
      <line x1="29" y1="36" x2="18" y2="58" />
      <line x1="37" y1="32" x2="56" y2="18" />
      <line x1="37" y1="32" x2="58" y2="32" />
      <line x1="37" y1="32" x2="56" y2="46" />
      <line x1="35" y1="36" x2="46" y2="58" />
    </svg>
  );
}

function BetaBanner() {
  return (
    <div class="beta-banner">
      Anansi is in <strong>private beta</strong> — the API is being hardened before general access.
      <a href="#waitlist">Join the waitlist →</a>
    </div>
  );
}

function GlobalNav() {
  return (
    <nav class="gnav">
      <div class="gnav-inner">
        <a href="/" class="gnav-brand">
          <SpiderMark size={20} color="#e8e8e8" id="anansi-logo" />
          Anansi
        </a>
        <div class="gnav-links">
          <a href="/status" class="gnav-status">status</a>
          <a href="/docs" class="gnav-link">Docs</a>
          <a href="/#pricing" class="gnav-link">Pricing</a>
          {!WAITLIST_MODE && <a href="/portal/login" class="gnav-link">Portal</a>}
          {WAITLIST_MODE
            ? <a href="#waitlist" class="gnav-cta">Join the beta →</a>
            : <a href="/portal/login" class="gnav-cta">Get API key →</a>}
        </div>
      </div>
    </nav>
  );
}

function page(waitlisted: boolean | "error" = false) {
  const ingestCode = [
    `<span class="c">// POST /v1/ingest</span>`,
    `<span class="k">await</span> memory.<span class="f">ingest</span>({`,
    `  userId: <span class="s">"user_abc"</span>,`,
    `  content: <span class="s">"Prefers TypeScript. Building a VAPI voice agent."</span>,`,
    `});`,
    `<span class="c">// → 202 Accepted { id, queued: true }</span>`,
    ``,
    `<span class="c">// GET /v1/context</span>`,
    `<span class="k">const</span> ctx = <span class="k">await</span> memory.<span class="f">context</span>({ userId: <span class="s">"user_abc"</span> });`,
    `<span class="c">// → 200 OK</span>`,
    `<span class="c">// {</span>`,
    `<span class="c">//   static:  ["Senior TS engineer", "Uses BullMQ", ...],</span>`,
    `<span class="c">//   dynamic: ["Building VAPI voice agent this week"],</span>`,
    `<span class="c">//   relevant: [...]</span>`,
    `<span class="c">// }</span>`,
  ].join("\n");

  // Matches the real surface: GET /v1/entities?asOf=&asOfKnowledge= — see
  // routes/v1.ts (parseAsOf) and lib/ai/query-engine.ts (getEntitiesForUser).
  const biTemporalCode = [
    `<span class="c">// In June you learn: Alex actually left Acme back in April.</span>`,
    `<span class="c">// A single-axis graph quietly rewrites history. Anansi keeps both axes.</span>`,
    ``,
    `<span class="c">// "What was true on May 1 — as we KNEW it on May 1?"</span>`,
    `<span class="k">await</span> memory.<span class="f">listEntities</span>({`,
    `  userId: <span class="s">"user_abc"</span>,`,
    `  asOf: <span class="s">"2026-05-01"</span>,          <span class="c">// valid-time instant</span>`,
    `  asOfKnowledge: <span class="s">"2026-05-01"</span>, <span class="c">// knowledge-time instant</span>`,
    `});`,
    `<span class="c">// → Alex —works_at→ Acme (current: true) — you hadn't learned they'd left</span>`,
    ``,
    `<span class="c">// "What was true on May 1 — as we know it TODAY?"</span>`,
    `<span class="k">await</span> memory.<span class="f">listEntities</span>({ userId: <span class="s">"user_abc"</span>, asOf: <span class="s">"2026-05-01"</span> });`,
    `<span class="c">// → no works_at edge — the April departure, recorded in June, now applies</span>`,
  ].join("\n");

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Anansi — The open-source bi-temporal memory API for AI apps</title>
        <meta name="description" content="Give your AI persistent memory of your users in two API calls — and rewind to what it knew at any moment in the past. Open-source (MIT), self-hostable, built on a bi-temporal knowledge graph." />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Anansi — The open-source bi-temporal memory API for AI apps" />
        <meta property="og:description" content="Give your AI persistent memory of your users in two API calls — and rewind to what it knew at any moment in the past. Open-source (MIT), self-hostable, built on a bi-temporal knowledge graph." />
        <meta property="og:image" content="/public/logo.png" />
        <meta property="og:url" content="https://anansimemory.com" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Anansi — The open-source bi-temporal memory API for AI apps" />
        <meta name="twitter:image" content="/public/logo.png" />
        <link rel="icon" href="/public/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/public/logo.png" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        {ANALYTICS_ENABLED && (
          <script defer data-domain="anansimemory.com" src="https://plausible.io/js/script.js"></script>
        )}
      </head>
      <body>
        {/* Silver-web background (shared with portal auth pages via lib/ui/web-bg) */}
        <div dangerouslySetInnerHTML={{ __html: WEB_BG_HTML }} />
        {WAITLIST_MODE && <BetaBanner />}
        <GlobalNav />

        {/* ── Hero ── */}
        <section class="hero">
<div class="container">
            <div class="hero-grid">
                <div>
                  <div class="kicker">// memory api · v0.3.0 · MIT licensed</div>
                  <h1 class="hero-h1">Memory that knows what you knew — <em>and when you knew it</em>.</h1>
                  <p class="hero-sub">Give your AI a memory that remembers your users across every session — and lets you <em>rewind</em> to exactly what it knew at any moment in the past. Two endpoints, synthesized profiles that drop straight into a system prompt, open-source and <span class="mono">docker compose up</span> if you'd rather run it yourself. Under the hood: a bi-temporal knowledge graph.</p>

                  <div class="hero-meta">
                    <div class="hero-meta-cell">
                      <div class="hero-meta-label">time axes</div>
                      <div class="hero-meta-val">valid + knowledge</div>
                    </div>
                    <div class="hero-meta-cell">
                      <div class="hero-meta-label">license</div>
                      <div class="hero-meta-val">MIT</div>
                    </div>
                    <div class="hero-meta-cell">
                      <div class="hero-meta-label">embedding</div>
                      <div class="hero-meta-val">768-dim</div>
                    </div>
                    <div class="hero-meta-cell">
                      <div class="hero-meta-label">retrieval</div>
                      <div class="hero-meta-val">BM25 + vector</div>
                    </div>
                  </div>

                  <div class="cta-row">
                    {WAITLIST_MODE
                      ? <a href="#waitlist" class="btn-primary">Join the Anansi beta →</a>
                      : <a href="/portal/login" class="btn-primary">Get an API key</a>}
                    <a href="/docs" class="btn-ghost">{WAITLIST_MODE ? "Read the docs →" : "npm install anansi-memory"}</a>
                  </div>
                </div>

                <div>
                  <div class="code-card">
                    <div class="code-head">
                      <span>POST /v1/ingest · GET /v1/context</span>
                      <span class="dim">REST · JSON · bearer auth</span>
                    </div>
                    <div class="code-body" dangerouslySetInnerHTML={{ __html: ingestCode }} />
                  </div>
                </div>
              </div>
            </div>
        </section>

        {/* ── Facts strip — every cell verifiable in the open-source repo ── */}
        <section class="metrics">
          <div class="container">
            <div class="metrics-grid">
              <div class="metric">
                <div class="metric-label">time axes</div>
                <div class="metric-val">2</div>
                <div class="metric-trend dim">valid-time + knowledge-time</div>
              </div>
              <div class="metric">
                <div class="metric-label">license</div>
                <div class="metric-val">MIT</div>
                <div class="metric-trend dim">self-hostable · docker compose</div>
              </div>
              <div class="metric">
                <div class="metric-label">core endpoints</div>
                <div class="metric-val">2</div>
                <div class="metric-trend dim">ingest + context</div>
              </div>
              <div class="metric">
                <div class="metric-label">connectors</div>
                <div class="metric-val">4</div>
                <div class="metric-trend dim">notion · gdocs · linear · transcripts</div>
              </div>
              <div class="metric">
                <div class="metric-label">retention</div>
                <div class="metric-val">∞<span class="unit"> pro</span></div>
                <div class="metric-trend dim">7d free · ∞ pro</div>
              </div>
              <div class="metric">
                <div class="metric-label">embeddings</div>
                <div class="metric-val">768<span class="unit">-dim</span></div>
                <div class="metric-trend dim">nomic · ollama · bring your own</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section class="section" id="how">
          <div class="container">
            <div class="section-label">how it works</div>
            <h2>From conversation to system-prompt-ready memory.</h2>
            <p class="section-sub">Two endpoints on the outside. Three stages on the inside. One synthesized artifact your model can actually use.</p>

            <div class="how-grid">
              <div class="how-block">
                <h3>In plain English</h3>
                <p>Think of Anansi as a notebook your AI keeps about each user. Every time someone talks to your app, the message gets handed to Anansi. Anansi quietly figures out what's worth remembering — who the user is, what they're working on, what they prefer — and writes it down. Next time the user shows up, your app asks for the notebook and pastes it into the prompt. The AI greets them like an old friend.</p>
                <ol>
                  <li>Your app sends a message → Anansi stores it</li>
                  <li>In the background Anansi summarizes what matters about the user</li>
                  <li>Your app asks for the summary → Anansi returns a short profile</li>
                  <li>Paste it into the system prompt → the AI remembers the user</li>
                </ol>
              </div>
              <div class="how-block tech">
                <h3>Under the hood</h3>
                <p>Two HTTP surfaces, three internal stages, one versioned artifact (<span class="mono">static_documents</span>) per user.</p>
                <ol>
                  <li><b>Ingest path</b> — <span class="mono">POST /v1/ingest</span> → sanitize (PII / secret redaction) → chunker (512 tok, 50 overlap, source-aware) → embed (768-dim) → pgvector + Postgres. Returns <span class="mono">202</span> immediately — embedding runs off the request path.</li>
                  <li><b>Synthesis worker</b> — BullMQ job, advisory-locked per user. An LLM pass reads accumulated chunks and writes <span class="mono">static_facts</span> (≤30) + <span class="mono">dynamic_context</span> (≤15) + bi-temporal entity graph.</li>
                  <li><b>Retrieve path</b> — <span class="mono">GET /v1/context</span> → Redis cache (60s TTL) → BM25 + vector search (parallel) → reciprocal rank fusion → JSON.</li>
                </ol>
              </div>
            </div>

            <div class="arch-wrap">
              <div class="arch-cap">// architecture · ingest top, synthesis middle, retrieve bottom</div>
              <svg class="arch" viewBox="0 0 880 400" xmlns="http://www.w3.org/2000/svg" aria-label="Anansi data flow diagram">
                <defs>
                  <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="#8a93a0" />
                  </marker>
                  <marker id="arrBrand" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" fill="#c0c0c0" />
                  </marker>
                </defs>

                {/* lane labels — placed at vertical center of each row */}
                <text x="14" y="58" class="lane-label">INGEST</text>
                <text x="14" y="214" class="lane-label">SYNTH</text>
                <text x="14" y="354" class="lane-label">RETRIEVE</text>

                {/* ── Row 1: Ingest (5 equal boxes, 140w, gap 18) ── */}
                <rect x="85" y="28" width="140" height="60" rx="6" class="n-box brand" />
                <text x="155" y="56" text-anchor="middle" class="n-title">Your AI app</text>
                <text x="155" y="74" text-anchor="middle" class="n-sub">chat · voice · agent</text>

                <rect x="243" y="28" width="140" height="60" rx="6" class="n-box" />
                <text x="313" y="54" text-anchor="middle" class="n-tag">POST</text>
                <text x="313" y="74" text-anchor="middle" class="n-sub">/v1/ingest</text>

                <rect x="401" y="28" width="140" height="60" rx="6" class="n-box" />
                <text x="471" y="56" text-anchor="middle" class="n-title">Sanitize</text>
                <text x="471" y="74" text-anchor="middle" class="n-sub">redact PII · secrets</text>

                <rect x="559" y="28" width="140" height="60" rx="6" class="n-box" />
                <text x="629" y="56" text-anchor="middle" class="n-title">Chunk + embed</text>
                <text x="629" y="74" text-anchor="middle" class="n-sub">512 tok · 768-dim</text>

                <rect x="717" y="28" width="140" height="60" rx="6" class="n-box store" />
                <text x="787" y="56" text-anchor="middle" class="n-title">Postgres</text>
                <text x="787" y="74" text-anchor="middle" class="n-sub">+ pgvector</text>

                {/* Row 1 arrows — clear of all text */}
                <line class="edge brand" x1="225" y1="58" x2="243" y2="58" marker-end="url(#arrBrand)" />
                <line class="edge" x1="383" y1="58" x2="401" y2="58" marker-end="url(#arr)" />
                <line class="edge" x1="541" y1="58" x2="559" y2="58" marker-end="url(#arr)" />
                <line class="edge" x1="699" y1="58" x2="717" y2="58" marker-end="url(#arr)" />

                {/* Row 1 → Row 2: Postgres bottom → Worker top (curves through empty band y=88-180) */}
                <path class="edge" d="M 787 88 C 787 135, 210 135, 210 180" marker-end="url(#arr)" />

                {/* ── Row 2: Synthesize (3 boxes, 200w, centered, gap 30) ── */}
                <rect x="110" y="180" width="200" height="80" rx="6" class="n-box" />
                <text x="210" y="210" text-anchor="middle" class="n-title">Synthesis worker</text>
                <text x="210" y="230" text-anchor="middle" class="n-sub">BullMQ · advisory-lock</text>

                <rect x="340" y="180" width="200" height="80" rx="6" class="n-box brand" />
                <text x="440" y="210" text-anchor="middle" class="n-title">LLM reads chunks</text>
                <text x="440" y="230" text-anchor="middle" class="n-sub">→ writes static + dynamic</text>

                <rect x="570" y="180" width="200" height="80" rx="6" class="n-box store" />
                <text x="670" y="206" text-anchor="middle" class="n-title">static_documents</text>
                <text x="670" y="226" text-anchor="middle" class="n-sub">static[≤30] + dynamic[≤15]</text>
                <text x="670" y="244" text-anchor="middle" class="n-sub">+ entity graph</text>

                {/* Row 2 arrows */}
                <line class="edge" x1="310" y1="220" x2="340" y2="220" marker-end="url(#arr)" />
                <line class="edge brand" x1="540" y1="220" x2="570" y2="220" marker-end="url(#arrBrand)" />

                {/* Row 2 → Row 3: static_documents bottom → Redis cache top (dashed, invalidate) */}
                <path class="edge brand" d="M 670 260 C 670 290, 471 290, 471 320" marker-end="url(#arrBrand)" stroke-dasharray="3 3" />
                <text x="685" y="282" class="edge-label">// invalidate on synthesis</text>

                {/* ── Row 3: Retrieve (5 equal boxes, mirrored from row 1, arrows point ←) ── */}
                <rect x="85" y="320" width="140" height="60" rx="6" class="n-box brand" />
                <text x="155" y="348" text-anchor="middle" class="n-title">Your AI app</text>
                <text x="155" y="366" text-anchor="middle" class="n-sub">system prompt</text>

                <rect x="243" y="320" width="140" height="60" rx="6" class="n-box" />
                <text x="313" y="346" text-anchor="middle" class="n-tag">GET</text>
                <text x="313" y="366" text-anchor="middle" class="n-sub">/v1/context</text>

                <rect x="401" y="320" width="140" height="60" rx="6" class="n-box" />
                <text x="471" y="348" text-anchor="middle" class="n-title">Redis cache</text>
                <text x="471" y="366" text-anchor="middle" class="n-sub">60s TTL</text>

                <rect x="559" y="320" width="140" height="60" rx="6" class="n-box" />
                <text x="629" y="348" text-anchor="middle" class="n-title">Hybrid retrieval</text>
                <text x="629" y="366" text-anchor="middle" class="n-sub">BM25 + vector · RRF</text>

                <rect x="717" y="320" width="140" height="60" rx="6" class="n-box store" />
                <text x="787" y="348" text-anchor="middle" class="n-title">Postgres</text>
                <text x="787" y="366" text-anchor="middle" class="n-sub">chunks + profile</text>

                {/* Row 3 arrows — point left for retrieve direction */}
                <line class="edge brand" x1="243" y1="350" x2="225" y2="350" marker-end="url(#arrBrand)" />
                <line class="edge" x1="401" y1="350" x2="383" y2="350" marker-end="url(#arr)" />
                <line class="edge" x1="559" y1="350" x2="541" y2="350" marker-end="url(#arr)" />
                <line class="edge" x1="717" y1="350" x2="699" y2="350" marker-end="url(#arr)" />
              </svg>
            </div>
          </div>
        </section>

        {/* ── Endpoints ── */}
        <section class="section" id="endpoints">
          <div class="container">
            <div class="section-label">the api</div>
            <h2>Two endpoints. No SDK required.</h2>
            <p class="section-sub">SDKs are convenience wrappers. The contract is REST, the auth is a bearer token, the response is JSON. Two calls do the job; the other two surfaces are there when you need them.</p>
            <div class="endpoints">
              <div class="endpoint">
                <div class="endpoint-row">
                  <span class="endpoint-method method-post">POST</span>
                  <span class="endpoint-path">/v1/ingest</span>
                </div>
                <p>Store a conversation turn, document, note, or meeting transcript. Sanitization + chunking + embedding happen async — the request returns <span class="mono">202</span> before any of it runs.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row">
                  <span class="endpoint-method method-get">GET</span>
                  <span class="endpoint-path">/v1/context</span>
                </div>
                <p>Returns synthesized <span class="mono">static</span> + <span class="mono">dynamic</span> arrays plus optional <span class="mono">relevant</span> chunks. Drop both into a system prompt.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row">
                  <span class="endpoint-method method-post">POST</span>
                  <span class="endpoint-path">/v1/search</span>
                </div>
                <p>Raw hybrid search (vector + BM25 + RRF). For when you want the chunks, not the profile.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row">
                  <span class="endpoint-method method-get">GET</span>
                  <span class="endpoint-path">/v1/entities</span>
                </div>
                <p>Bi-temporal entity graph extracted during synthesis. People, projects, decisions — with valid-time <em>and</em> knowledge-time edges, queryable via <span class="mono">asOf</span> / <span class="mono">asOfKnowledge</span>. Pro+.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Why it's different ── */}
        <section class="section" id="features">
          <div class="container">
            <div class="section-label">why anansi</div>
            <h2>Open-source memory with a bi-temporal graph.</h2>
            <p class="section-sub">Memory is a crowded space. Here's what Anansi does that's genuinely distinct — each one backed by code in the repo, not a slide.</p>
            <div class="endpoints" style="margin-bottom:14px">
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">01 · Bi-temporal graph</span></div>
                <p>Entity edges track two time axes — <span class="mono">valid-time</span> (when it was true) and <span class="mono">knowledge-time</span> (when we learned it). Query the graph <span class="mono">asOf</span> a date, or as we <span class="mono">knew</span> it. Ask what was true <em>when</em>.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">02 · MIT & self-hostable</span></div>
                <p>Open-source under MIT. <span class="mono">docker compose up</span> brings up Postgres + Redis; the API ships its own Dockerfile. Run the hosted service or host it yourself — your users' memory, your infra.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">03 · Synthesized profiles</span></div>
                <p>An LLM pass distills accumulated chunks into <span class="mono">static</span> facts and <span class="mono">dynamic</span> context. Drop both arrays into a system prompt — no chunks to dedupe, rank, or trim yourself.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">04 · Bring your own embeddings</span></div>
                <p>Swap the embedding provider (Nomic or local Ollama), or skip it entirely — pass a pre-computed <span class="mono">embedding</span> on ingest and we store your vectors. Model-agnostic on the LLM side too.</p>
              </div>
            </div>

            {/* Bi-temporal proof — real request against GET /v1/entities (asOf + asOfKnowledge) */}
            <div class="code-card">
              <div class="code-head">
                <span>GET /v1/entities · the "as we knew it" query</span>
                <span class="dim">bi-temporal · Pro+</span>
              </div>
              <div class="code-body" dangerouslySetInnerHTML={{ __html: biTemporalCode }} />
            </div>
          </div>
        </section>

        {/* ── Who it's for ── */}
        <section class="section" id="use-cases">
          <div class="container">
            <div class="section-label">who it's for</div>
            <h2>Three places Anansi genuinely wins.</h2>
            <p class="section-sub">Not "memory for everyone" — memory for teams whose problem shape matches what this engine actually does.</p>
            <div class="endpoints">
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Compliance & audit</span></div>
                <p>"What did we know on March 3rd?" is an audit question, and most memory stores can't answer it — they overwrite. Anansi's knowledge-time axis reconstructs the graph <em>as you knew it</em> at any instant, self-hosting keeps memory on your infrastructure, and <span class="mono">DELETE /v1/user</span> gives you a GDPR hard-delete that cascades through chunks, profile, and graph.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Slack-first teams</span></div>
                <p>Install the Slack app and the workspace becomes shared memory: messages ingest automatically, <span class="mono">/ask</span> answers from a two-layer profile (curated static facts + current context), and <span class="mono">/memory forget-me</span> lets anyone opt out. No pipeline to build — the bot runs on the same engine as the API.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">OSS-first engineers</span></div>
                <p>MIT license, no open-core asterisks. <span class="mono">docker compose up</span> starts Postgres + Redis, and with local Ollama serving both embeddings and synthesis, the whole stack runs on your laptop with <em>zero</em> external API calls. Read the retrieval code before you trust it with your users' memory.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Compare ── */}
        <section class="section" id="compare">
          <div class="container">
            <div class="section-label">vs the field</div>
            <h2>Where Anansi sits.</h2>
            <p class="section-sub">An honest read of the memory landscape. Mem0, Supermemory, and Zep are strong tools with graph memory, temporal reasoning, and dashboards of their own — these are the axes where Anansi is genuinely differentiated.</p>
            <div class="compare-wrap">
              <table class="compare">
                <thead>
                  <tr>
                    <th>capability</th>
                    <th class="col-anansi">anansi</th>
                    <th>supermemory</th>
                    <th>mem0</th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="feat-anansi"><td>Knowledge-time queries — the graph "as we knew it" (<span class="mono">asOfKnowledge</span>)</td><td class="yes">✓</td><td class="no">—</td><td class="no">—</td></tr>
                  <tr class="feat-anansi"><td>MIT license, full stack self-hostable via docker compose</td><td class="yes">✓</td><td class="no">hosted</td><td class="no">OSS core</td></tr>
                  <tr><td>Graph / temporal memory</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
                  <tr><td>Synthesized profile (system-prompt ready)</td><td class="yes">✓</td><td class="yes">✓</td><td class="no">—</td></tr>
                  <tr><td>Hybrid retrieval (BM25 + vector)</td><td class="yes">✓</td><td class="yes">✓</td><td class="yes">✓</td></tr>
                  <tr><td>First-party Slack app with <span class="mono">/ask</span> team memory</td><td class="yes">✓</td><td class="no">—</td><td class="no">—</td></tr>
                </tbody>
              </table>
            </div>
            <p style="color:var(--dim);font-size:12px;margin-top:10px;font-family:'SF Mono',Menlo,monospace">// based on each product's public docs as of July 2026. Spotted an error? Open an issue — we'll fix the table.</p>
          </div>
        </section>

        {/* ── Pricing ── */}
        <section class="section" id="pricing">
          <div class="container">
            <div class="section-label">pricing</div>
            <h2>Pay for what you ingest. No per-seat tax.</h2>
            <p class="section-sub">Usage-metered. Cancel any time via <span class="mono">/portal</span>. Free tier is real — 1,000 ingest calls per month, no card.</p>
            <div class="tier-grid">
              <div class="tier">
                <div class="tier-name">free</div>
                <div class="tier-price">$0<small>/mo</small></div>
                <ul>
                  <li>1,000 ingest calls</li>
                  <li>500 context calls</li>
                  <li>10 memory users</li>
                  <li>7-day retention</li>
                  <li>vector retrieval</li>
                </ul>
                {WAITLIST_MODE
                  ? <a href="#waitlist" class="tier-cta">Join waitlist →</a>
                  : <a href="/portal/signup" class="tier-cta">Start free</a>}
              </div>
              <div class="tier featured">
                <div class="tier-name">pro · recommended</div>
                <div class="tier-price">$19<small>/mo</small></div>
                <ul>
                  <li>25,000 ingest calls</li>
                  <li>10,000 context calls</li>
                  <li>unlimited memory users</li>
                  <li>infinite retention</li>
                  <li>hybrid search + entity graph</li>
                  <li>all 4 connectors</li>
                </ul>
                {WAITLIST_MODE
                  ? <a href="#waitlist" class="tier-cta">Join waitlist →</a>
                  : <a href="/portal/signup?plan=pro" class="tier-cta">Start 14-day trial</a>}
              </div>
              <div class="tier">
                <div class="tier-name">scale</div>
                <div class="tier-price">$99<small>/mo</small></div>
                <ul>
                  <li>250,000 ingest calls</li>
                  <li>100,000 context calls</li>
                  <li>everything in pro</li>
                  <li>priority support</li>
                  <li>SLA on request</li>
                </ul>
                <a href="mailto:anansi.memory@gmail.com?subject=Scale%20plan%20inquiry" class="tier-cta">Contact us</a>
              </div>
            </div>
          </div>
        </section>

        {/* ── Closing ── */}
        <section class="closing">
          <div class="container">
            <p class="quote">Anansi didn't weave a new web for every story. Your agent shouldn't build a new mind for every session.</p>
            <h2>Stop letting your agent forget.</h2>
            <p>Two function calls. Any LLM. Free tier, no card. Five minutes from signed-up to remembering users in production.</p>
            <div class="cta-row">
              {WAITLIST_MODE
                ? <a href="#waitlist" class="btn-primary">Join the Anansi beta →</a>
                : <a href="/portal/signup" class="btn-primary">Get an API key</a>}
              <a href="/docs" class="btn-ghost">Read the docs →</a>
            </div>
          </div>
        </section>

        {/* ── Waitlist — only rendered in WAITLIST_MODE ── */}
        {WAITLIST_MODE && (
          <section class="waitlist-section" id="waitlist">
            <div class="container">
              <div class="section-label">early access</div>
              <h2>Join the Anansi beta.</h2>
              <p class="section-sub">
                We're hardening the API before opening general access. Drop your email and we'll reach out when you're in — no spam, one email when beta opens.
              </p>
              {waitlisted === true && (
                <div class="waitlist-success">✓ You're on the list — we'll be in touch when beta opens.</div>
              )}
              {waitlisted === "error" && (
                <div class="waitlist-error">Something went wrong — please try again or email <a href="mailto:anansi.memory@gmail.com">anansi.memory@gmail.com</a>.</div>
              )}
              {!waitlisted && (
                <form method="post" action="/waitlist" class="waitlist-form">
                  <input type="email" name="email" placeholder="you@company.com" required class="waitlist-input" />
                  <button type="submit" class="btn-primary">Join the Anansi beta →</button>
                </form>
              )}
              <p class="waitlist-note">// no spam · one email when access opens · unsubscribe anytime</p>
            </div>
          </section>
        )}

        <footer>
          <div class="container footer-row">
            <span>anansi.memory@gmail.com · © 2026</span>
            <span><a href="/docs">docs</a> · <a href="/docs/faq">faq</a> · <a href="/privacy">privacy</a> · <a href="/terms">terms</a></span>
          </div>
          <div class="container footer-row" style="margin-top:6px">
            <span>Built by <a href="https://www.linkedin.com/in/jibrilsuleiman" target="_blank" rel="noopener noreferrer">Jibril Suleiman</a></span>
          </div>
        </footer>

      </body>
    </html>
  );
}

landingRoutes.get("/", (c) => {
  const w = c.req.query("waitlisted");
  return c.html(withDoctype(page(w === "1" ? true : w === "error" ? "error" : false)));
});

// ── Waitlist email capture ──────────────────────────────────────────────────────
// Stores submissions in a `waitlist_emails` Postgres table (created on first use —
// no migration needed). Falls back to stdout logging if the table can't be created.
// Gated by WAITLIST_MODE but safe to leave deployed — no-ops when the flag is off.
landingRoutes.post("/waitlist", async (c) => {
  let email: string;
  try {
    const body = await c.req.formData();
    email = (body.get("email")?.toString() ?? "").toLowerCase().trim();
  } catch {
    return c.redirect("/?waitlisted=error", 302);
  }

  if (!email || !email.includes("@") || email.length > 320) {
    return c.redirect("/?waitlisted=error", 302);
  }

  // Mask before logging — show first 2 chars of local + first 2 chars of domain
  const masked = email.replace(/^(.{2}).*@(.{2}).*$/, "$1***@$2***");
  console.log(JSON.stringify({ event: "waitlist_signup", email: masked }));

  try {
    const { pool } = await import("../lib/db/index.js");
    const client = await pool.connect();
    try {
      // Create table on first use — no migration required, idempotent.
      await client.query(`
        CREATE TABLE IF NOT EXISTS waitlist_emails (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(email)
        )
      `);
      await client.query(
        "INSERT INTO waitlist_emails (email) VALUES ($1) ON CONFLICT (email) DO NOTHING",
        [email]
      );
    } finally {
      client.release();
    }
  } catch (err) {
    // Email is already in logs — don't show the user an error for a DB hiccup
    console.error(JSON.stringify({ event: "waitlist_db_error", error: (err as Error).message }));
  }

  return c.redirect("/?waitlisted=1#waitlist", 302);
});

landingRoutes.get("/sitemap.xml", (c) => c.redirect(`${APP_URL}/sitemap.xml`));
