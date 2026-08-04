/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
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
// Data-dense layout (metric strip + API surfaces + decision table).
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

/* ── Production visual system: editorial paper + technical workbench ── */
:root{--bg:#f5f6f8;--bg2:#fff;--bg3:#edf1f6;--line:#d8dee8;--line2:#bdc8d8;--text:#111827;--mute:#607086;--dim:#8793a5;--brand:#1d5bff;--brand-soft:#e8f0ff;--brand-line:#bed0ff;--brand-glow:#1749c4;--brand-dim:#607086;--ok:#087a5a;--warn:#a66700}
html,body{background:var(--bg);color:var(--text)}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px}
a{color:#1749c4}.container{max-width:1200px;padding:0 28px}.web-bg-far,.web-bg-near,.spotlight{display:none!important}
:focus-visible{outline:3px solid rgba(29,91,255,.42);outline-offset:3px}

nav.gnav{height:68px;background:rgba(255,255,255,.94);border-color:var(--line);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.gnav-brand{color:var(--text);font-size:16px;font-weight:760;letter-spacing:-.025em}.gnav-links{gap:20px;font-size:13px}.gnav-link{color:var(--mute);font-weight:620}.gnav-link:hover{color:var(--text)}
.gnav-status{padding:4px 0;background:transparent;border:0;color:var(--ok);font-size:10.5px}.gnav-status::before{box-shadow:none}.gnav-cta{background:#1d5bff;color:#fff;padding:9px 14px;font-size:12.5px;font-weight:700;transition:background .16s ease,transform .16s ease}.gnav-cta:hover{background:#1749c4;filter:none;transform:translateY(-1px)}

.hero{padding:104px 0 92px;background:#f5f6f8;border-color:var(--line)}.hero-grid{grid-template-columns:1.06fr .94fr;gap:72px;align-items:center}.kicker{color:#1749c4;font-size:11px;font-weight:700;letter-spacing:.11em;margin-bottom:22px}
h1.hero-h1{font-size:clamp(42px,5vw,68px);font-weight:780;letter-spacing:-.052em;line-height:.99;margin-bottom:22px;color:var(--text);max-width:680px}h1.hero-h1 em{color:#1749c4}.hero-sub{font-size:18px;color:var(--mute);max-width:610px;line-height:1.55;margin-bottom:30px;letter-spacing:-.012em}
.time-rail{border-top:1px solid var(--text);border-bottom:1px solid var(--line2);margin:34px 0 30px;padding:13px 0 14px}.time-rail-head{display:flex;justify-content:space-between;gap:12px;font-family:'SF Mono',Menlo,monospace;font-size:10.5px;color:var(--mute);letter-spacing:.04em;margin-bottom:16px;text-transform:uppercase}.time-rail-head b{color:var(--text);font-weight:700}.time-rail-grid{display:grid;grid-template-columns:1fr 1fr;gap:0}.time-axis{padding:0 20px 0 0;border-right:1px solid var(--line)}.time-axis+.time-axis{padding:0 0 0 20px;border:0}.time-axis-label{font-family:'SF Mono',Menlo,monospace;font-size:10.5px;color:#1749c4;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}.time-axis p{font-size:12.5px;line-height:1.45;color:var(--mute)}.hero-footnotes{display:flex;gap:14px;flex-wrap:wrap;font-family:'SF Mono',Menlo,monospace;font-size:10.5px;color:var(--mute);margin-top:16px}.hero-footnotes span::before{content:'•';color:#1d5bff;margin-right:6px}
.cta-row{gap:10px}.btn-primary{background:#1d5bff;color:#fff;padding:13px 19px;border-radius:6px;font-weight:740;font-size:13.5px;transition:background .16s ease,transform .16s ease}.btn-primary:hover{background:#1749c4;filter:none;transform:translateY(-1px)}.btn-ghost{color:var(--text);padding:12px 17px;border-radius:6px;font-weight:650;font-size:13px;border-color:var(--line2)}.btn-ghost:hover{border-color:#1d5bff;color:var(--text);background:#e8f0ff}

.code-card{background:#0b1322;border-color:#20304a;border-radius:10px;box-shadow:0 22px 50px rgba(17,24,39,.16)}.code-head{padding:13px 16px;background:#111d31;border-color:#22334e;font-size:10.5px;color:#b9c6d8;text-transform:uppercase;letter-spacing:.045em}.code-head .dim{color:#7f91aa}.code-body{padding:23px 24px;font-size:12.5px;line-height:1.95;color:#dfe8f5}.k{color:#9cc1ff}.s{color:#f3c86b}.c{color:#8c9db4}.f{color:#8fc8ff}

.metrics{padding:0;background:#0b1322!important;border-color:#0b1322}.metrics-grid{max-width:1240px;margin:0 auto;padding:0 24px;background:transparent;border:0;border-radius:0}.metric{padding:28px 18px 30px;border-color:#24334b}.metric-label{color:#8da0ba;font-size:10px;margin-bottom:9px}.metric-val{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:17px;font-weight:720;color:#f8fafc;letter-spacing:-.025em}.metric-trend,.metric-trend.dim{color:#8da0ba;font-size:10.5px;margin-top:7px;line-height:1.45}.metric-val .unit{color:#b9c6d8}

.section{padding:104px 0;background:#fff;border-color:var(--line)}.section-label{font-size:10.5px;color:#1749c4;letter-spacing:.11em;font-weight:700;margin-bottom:16px}.section-label::before{content:'// ';color:var(--dim)}.section h2{font-size:clamp(32px,3.5vw,48px);font-weight:760;letter-spacing:-.045em;line-height:1.04;margin-bottom:15px;max-width:760px}.section-sub{font-size:17px;color:var(--mute);max-width:680px;margin-bottom:42px;letter-spacing:-.012em}
section[id]{scroll-margin-top:92px}
#how,#compare,#open-source{background:#f5f6f8}#features,#enterprise{background:#0b1322;border-color:#0b1322;color:#f8fafc}#features .section-label,#enterprise .section-label{color:#9cc1ff}#features .section-label::before,#enterprise .section-label::before{color:#6f85a2}#features .section-sub,#enterprise .section-sub{color:#b9c6d8}

.endpoints{border:0;border-top:1px solid var(--line2);border-left:1px solid var(--line2);border-radius:0;background:#fff}.endpoint{padding:29px 30px;border-color:var(--line2);background:#fff;transition:background .16s ease}.endpoint:hover{background:#e8f0ff}.endpoint-row{gap:9px;margin-bottom:11px}.endpoint-method{font-size:10.5px;padding:3px 6px;border-radius:4px}.method-post{background:#e8f0ff;color:#1749c4;border-color:#bed0ff}.method-get{background:#e9f6f1;color:#087a5a;border-color:#b9e5d5}.method-del{background:#fff4df;color:#a66700;border-color:#f1d49a}.endpoint-path{font-size:14px;font-weight:720;color:var(--text);letter-spacing:-.012em}.endpoint p{color:var(--mute);font-size:14px;line-height:1.6;max-width:490px}
.feature-icon{width:25px;height:25px;display:inline-flex;align-items:center;justify-content:center;color:#8fb6ff;border:1px solid #38547b;border-radius:5px;flex:0 0 auto}.feature-icon svg{width:15px;height:15px}
#features .endpoints,#enterprise .endpoints{background:#0b1322;border-color:#2a3b56}#features .endpoint,#enterprise .endpoint{background:#0b1322;border-color:#2a3b56}#features .endpoint:hover,#enterprise .endpoint:hover{background:#111d31}#features .endpoint-path,#enterprise .endpoint-path{color:#f8fafc}#features .endpoint p,#enterprise .endpoint p{color:#b9c6d8}

.how-grid{gap:0;margin-bottom:42px;border-top:1px solid var(--line2);border-left:1px solid var(--line2)}.how-block{border-color:var(--line2);border-radius:0;background:#f5f6f8;padding:32px 34px}.how-block h3{font-size:11px;color:#1749c4;margin-bottom:14px}.how-block p{font-size:15px;color:var(--mute);margin-bottom:18px}.how-block ol{font-size:14px;color:var(--text)}.how-block ol li{padding-left:31px;margin-bottom:9px}.how-block ol li::before{color:#1749c4;font-size:10.5px}.how-block.tech ol li{font-size:12px;color:#3d4e66}.how-block.tech ol li b{color:var(--text)}
.arch-wrap{border-color:#20304a;background:#0b1322;border-radius:10px;padding:30px 26px;box-shadow:0 18px 40px rgba(17,24,39,.12)}.arch-cap{color:#8da0ba;font-size:10.5px;margin-bottom:16px}.arch .n-box{fill:#111d31;stroke:#2d405f}.arch .n-box.brand{fill:#15294a;stroke:#4f84de}.arch .n-box.store{fill:#0d192b;stroke:#354a6a}.arch .n-title{fill:#f8fafc}.arch .n-sub{fill:#a9b9cf}.arch .n-tag{fill:#9cc1ff}.arch .edge{stroke:#71829b}.arch .edge.brand{stroke:#8cb5ff}.arch .edge-label{fill:#a9b9cf}.arch .lane-label{fill:#71829b}

.compare-wrap{border:0;border-top:1px solid var(--line2);border-left:1px solid var(--line2);border-radius:0;background:#fff;overflow:auto}table.compare{min-width:720px}.compare th,.compare td{padding:17px 18px;border-right:1px solid var(--line2);border-bottom:1px solid var(--line2);vertical-align:top}.compare th{background:#edf1f6;color:var(--mute);font-size:10.5px;font-weight:700}.compare td{background:#fff;color:var(--mute);line-height:1.5}.compare td:first-child{color:var(--text);font-weight:650}.compare .yes,.compare .col-anansi{color:#1749c4}.compare .feat-anansi td{background:#f3f7ff}

.tier-grid{gap:0;border-top:1px solid var(--line2);border-left:1px solid var(--line2)}.tier{border-color:var(--line2);border-radius:0;background:#fff;padding:30px}.tier.featured{border-color:var(--line2);border-top:4px solid #1d5bff;background:#e8f0ff;padding-top:27px}.tier-name{color:#1749c4;font-size:10.5px;font-weight:700;margin-bottom:16px}.tier-price{color:var(--text);font-size:38px;font-weight:760;letter-spacing:-.045em}.tier ul{margin:22px 0 28px}.tier-cta{border-color:var(--line2);color:var(--text);padding:11px 16px;font-weight:700}.tier.featured .tier-cta{background:#1d5bff;color:#fff;border-color:#1d5bff}.tier-cta:hover{background:#e8f0ff;border-color:#1d5bff;filter:none}.tier.featured .tier-cta:hover{background:#1749c4}

.closing{padding:112px 0;background:#0b1322;border-color:#0b1322;color:#f8fafc}.closing h2{font-size:clamp(36px,4vw,54px);font-weight:760;letter-spacing:-.05em;line-height:1.02;margin-bottom:16px}.closing p{color:#b9c6d8;font-size:17px;max-width:600px;margin-bottom:30px}.closing .quote{font-family:'SF Mono',Menlo,monospace;font-style:normal;color:#9cc1ff;font-size:11px;letter-spacing:.05em;text-transform:uppercase;margin-bottom:20px}.closing .btn-ghost{color:#f8fafc;border-color:#4a5d7a}.closing .btn-ghost:hover{color:#f8fafc;background:#111d31;border-color:#8cb5ff}
footer{padding:32px 0;background:#0b1322;color:#8da0ba;font-size:12px}footer .footer-row a{color:#b9c6d8}.beta-banner{background:#0b1322;border-color:#263853;color:#b9c6d8}.beta-banner strong{color:#fff}.beta-banner a{color:#9cc1ff}
.waitlist-section{padding:96px 0;background:#f5f6f8;border-color:var(--line)}.waitlist-section h2{font-size:38px;font-weight:760;letter-spacing:-.045em}.waitlist-input{background:#fff;border-color:var(--line2);border-radius:6px;color:var(--text);padding:12px 16px}.waitlist-input:focus{border-color:#1d5bff}.waitlist-success{background:#e9f6f1;border-color:#b9e5d5;border-radius:6px;color:#087a5a}.waitlist-error{background:#fff4df;border-color:#f1d49a;border-radius:6px;color:#a66700}

@media(max-width:920px){.hero{padding:78px 0 72px}.hero-grid,.endpoints,.tier-grid{grid-template-columns:1fr;gap:36px}.endpoint{border-right:0}.endpoint:nth-last-child(-n+2){border-bottom:1px solid var(--line2)}.endpoint:last-child{border-bottom:0}.metrics-grid{grid-template-columns:repeat(3,1fr)}.metric:nth-child(-n+3){border-bottom:1px solid #24334b}.how-grid{grid-template-columns:1fr}.section{padding:78px 0}}
@media(max-width:560px){.container,.gnav-inner{padding:0 20px}.gnav-links{gap:13px}.gnav-optional,.gnav-status{display:none}.metrics-grid{grid-template-columns:repeat(2,1fr);padding:0}.metric{padding:23px 18px;border-bottom:1px solid #24334b}.metric:nth-child(2n){border-right:0}h1.hero-h1{font-size:42px}.hero-sub{font-size:16px}.time-rail-grid{grid-template-columns:1fr;gap:14px}.time-axis,.time-axis+.time-axis{padding:0;border:0}.time-axis+.time-axis{padding-top:14px;border-top:1px solid var(--line)}.section{padding:66px 0}.section h2{font-size:34px}.section-sub{font-size:16px}.endpoint,.how-block,.tier{padding:25px 22px}.code-body{padding:19px;font-size:11.5px}.hero-footnotes{gap:8px}}

/* ── Research Lab identity ────────────────────────────────────────────────
   The public site has a different job from the console: explain a technical
   system. Field-paper sections read like a research note; graphite panels are
   reserved for executable surfaces and system state. */
:root{--bg:#f6f5f0;--bg2:#fffefa;--bg3:#ebece6;--line:#d8d9d2;--line2:#bdc0b8;--text:#151b24;--mute:#667085;--dim:#7c8580;--brand:#315ef4;--brand-soft:#e8efff;--brand-line:#aebffa;--brand-glow:#203eaa;--ok:#237a5a;--warn:#9a6200}
html,body{background:var(--bg);color:var(--text)}body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background-image:linear-gradient(90deg,transparent 0,transparent calc(50% - .5px),rgba(21,27,36,.045) calc(50% - .5px),rgba(21,27,36,.045) calc(50% + .5px),transparent calc(50% + .5px));background-size:min(1440px,100%) 100%;background-position:center top}a{color:var(--brand-glow)}.container{max-width:1280px;padding:0 32px}.web-bg-far,.web-bg-near,.spotlight{display:none!important}:focus-visible{outline:3px solid rgba(49,94,244,.38);outline-offset:3px}

nav.gnav{height:72px;border-color:var(--line);background:rgba(246,245,240,.93);backdrop-filter:blur(14px) saturate(.9);-webkit-backdrop-filter:blur(14px) saturate(.9)}.gnav-inner{max-width:1280px;padding:0 32px}.gnav-brand{gap:10px;color:var(--text);font-weight:730;font-size:16px;letter-spacing:-.035em}.gnav-brand svg{padding:4px;border:1px solid var(--text);width:27px;height:27px}.gnav-links{gap:4px;font-size:12.5px}.gnav-link{padding:7px 9px;color:var(--mute);font-weight:620}.gnav-link:hover{color:var(--text);text-decoration:none}.gnav-status{order:-1;margin-right:10px;padding:0;background:none;border:0;color:var(--ok);font-size:10px;letter-spacing:.06em;text-transform:uppercase}.gnav-status::before{width:5px;height:5px;box-shadow:none}.gnav-cta{border-radius:3px;background:var(--brand);padding:9px 13px;color:#fff;font-size:12px;font-weight:720;box-shadow:inset 0 -1px 0 rgba(11,24,75,.28),0 2px 5px rgba(49,94,244,.16);transition:background .15s,transform .15s}.gnav-cta:hover{background:#244ad0;filter:none;transform:translateY(-1px)}

.hero{padding:clamp(70px,10vw,136px) 0 clamp(78px,10vw,140px);background:var(--bg);border:0}.hero::before{position:absolute;top:0;left:max(32px,calc((100% - 1216px)/2));width:40px;height:1px;background:var(--text);content:''}.hero-grid{grid-template-columns:minmax(0,1.03fr) minmax(370px,.97fr);gap:clamp(54px,8vw,120px);align-items:center}.kicker{margin-bottom:23px;color:var(--brand);font-size:10px;font-weight:750;letter-spacing:.11em}.kicker::before{margin-right:7px;color:var(--dim);content:'//'}h1.hero-h1{max-width:11.8ch;margin-bottom:24px;color:var(--text);font-family:Iowan Old Style,Charter,Georgia,serif;font-size:clamp(52px,6.25vw,84px);font-weight:500;letter-spacing:-.066em;line-height:.91}h1.hero-h1 em{color:var(--text);font-style:italic;font-weight:400}.hero-sub{max-width:540px;margin-bottom:0;color:var(--mute);font-size:17px;letter-spacing:-.012em;line-height:1.66}.time-rail{margin:34px 0 30px;padding:14px 0 16px;border-top:1px solid var(--text);border-bottom:1px solid var(--line)}.time-rail-head{color:var(--mute);font-size:9.5px}.time-rail-head b{color:var(--text)}.time-axis-label{color:var(--brand);font-size:10px}.time-axis p{color:var(--mute);font-size:12.5px}.btn-primary{border-radius:3px;background:var(--brand);padding:12px 18px;color:#fff;font-size:13px;font-weight:720;box-shadow:inset 0 -1px 0 rgba(11,24,75,.28),0 2px 5px rgba(49,94,244,.16)}.btn-primary:hover{background:#244ad0;filter:none}.btn-ghost{border-radius:3px;border-color:var(--line2);color:var(--text);font-size:12px;font-weight:670}.btn-ghost:hover{border-color:var(--text);background:var(--bg2);color:var(--text)}.hero-footnotes{font-size:9.5px;letter-spacing:.035em;text-transform:uppercase}.hero-footnotes span::before{background:var(--ok);border-radius:50%;font-size:0;width:5px;height:5px;display:inline-block;margin-right:6px}

.code-card{position:relative;border-radius:2px;border-color:#39463e;background:#151b18;box-shadow:0 28px 60px rgba(19,25,21,.18)}.code-card::before{position:absolute;z-index:2;top:13px;left:15px;width:6px;height:6px;border-radius:50%;background:#75c3a0;box-shadow:13px 0 #e3b967,26px 0 #e17c6f;content:''}.code-head{padding:12px 16px 12px 56px;border-color:#354139;background:#1d2721;color:#aebbb1;font-size:9.5px;letter-spacing:.075em;text-transform:uppercase}.code-head .dim{color:#8a968d}.code-body{padding:24px;color:#e8efe9;font-size:12px;line-height:2}.k{color:#a6baff}.s{color:#e8c56e}.c{color:#91a096}.f{color:#8ed0b2}

.metrics{background:#151b18!important;border:0}.metrics-grid{max-width:1280px;padding:0 32px}.metric{min-height:108px;padding:27px 18px;border-color:#3a443d}.metric-label{color:#929e95;font-size:9.5px}.metric-val{color:#f2f4ef;font-family:Inter,-apple-system,sans-serif;font-size:16px;font-weight:720}.metric-trend,.metric-trend.dim{color:#adb8b0;font-size:9.5px}.metric:nth-child(1){border-left:1px solid #3a443d}

.section{padding:clamp(76px,9vw,124px) 0;background:var(--bg2);border-color:var(--line)}.section::before{position:absolute;top:0;left:max(32px,calc((100% - 1216px)/2));width:34px;height:1px;background:var(--text);content:''}.section-label{color:var(--brand);font-size:10px;font-weight:750;letter-spacing:.1em}.section-label::before{content:'//';margin-right:7px;color:var(--dim)}.section h2{max-width:18ch;font-family:Iowan Old Style,Charter,Georgia,serif;font-size:clamp(36px,4vw,57px);font-weight:500;letter-spacing:-.055em;line-height:.99}.section-sub{max-width:650px;color:var(--mute);font-size:16px;line-height:1.62}#how,#compare,#open-source{background:var(--bg)}#features,#enterprise{background:#151b18;border-color:#151b18;color:#f2f4ef}#features::before,#enterprise::before{background:#9daca1}#features .section-label,#enterprise .section-label{color:#aac1ff}#features .section-label::before,#enterprise .section-label::before{color:#849087}#features .section-sub,#enterprise .section-sub{color:#b6c0b8}

.endpoints{border-radius:2px;border-color:var(--line);background:var(--line)}.endpoint{padding:28px;background:var(--bg2);border-color:var(--line);transition:transform .16s,background .16s}.endpoint:hover{background:#f1f4ff;transform:translateY(-2px)}.endpoint-path{font-size:14px;font-weight:730}.endpoint p{font-size:13.5px}.endpoint-method{border-radius:3px;font-size:9px}.method-post{border-color:#b9c7fb;background:#e8efff;color:#2448c9}.method-get{border-color:#b8ddcd;background:#e8f4ee;color:#17634a}.method-del{border-color:#ead2a2;background:#fff5df;color:#875305}.feature-icon{border-radius:50%;border-color:#596d60;color:#b4c8ff}#features .endpoints,#enterprise .endpoints{background:#3a443d;border-color:#3a443d}#features .endpoint,#enterprise .endpoint{background:#151b18;border-color:#3a443d}#features .endpoint:hover,#enterprise .endpoint:hover{background:#202a24}#features .endpoint-path,#enterprise .endpoint-path{color:#f2f4ef}#features .endpoint p,#enterprise .endpoint p{color:#b6c0b8}

.how-grid{border-color:var(--line)}.how-block{border-radius:0;border-color:var(--line);background:#f1f0eb;padding:32px}.how-block h3{color:var(--brand);font-size:10px}.how-block p{color:var(--mute);font-size:14px}.how-block ol li::before{color:var(--brand)}.how-block.tech ol li{color:#3e4b44}.arch-wrap{border-radius:2px;border-color:#3a443d;background:#151b18;box-shadow:0 22px 45px rgba(19,25,21,.14)}.arch-cap{color:#9ba99e}.arch .n-box{fill:#1d2721;stroke:#3b4a40}.arch .n-box.brand{fill:#24332a;stroke:#7d9f8d}.arch .n-box.store{fill:#111813;stroke:#3b4a40}.arch .n-title{fill:#eef2ed}.arch .n-sub{fill:#acb8af}.arch .n-tag{fill:#aac1ff}.arch .edge{stroke:#839187}.arch .edge.brand{stroke:#9cc5b1}.arch .edge-label{fill:#acb8af}.arch .lane-label{fill:#839187}

.compare-wrap{border-color:var(--line);border-radius:2px;background:var(--line)}.compare th,.compare td{border-color:var(--line)}.compare th{background:#e9eae4;color:var(--mute);font-size:9.5px}.compare td{background:var(--bg2)}.compare .yes,.compare .col-anansi{color:var(--brand)}.compare .feat-anansi td{background:#eef2ff}
.tier-grid{border-color:var(--line)}.tier{border-radius:0;border-color:var(--line);background:var(--bg2)}.tier.featured{border-top:3px solid var(--brand);background:#e8efff;padding-top:28px}.tier-name{color:var(--brand)}.tier-price{font-family:Iowan Old Style,Charter,Georgia,serif;font-weight:600}.tier-cta{border-radius:3px}.tier.featured .tier-cta{background:var(--brand);color:#fff;border-color:var(--brand)}
.closing{background:#151b18;border-color:#151b18}.closing h2{font-family:Iowan Old Style,Charter,Georgia,serif;font-weight:500;letter-spacing:-.06em}.closing p{color:#b6c0b8}.closing .quote{color:#aac1ff}.closing .btn-ghost{border-color:#536159}.closing .btn-ghost:hover{border-color:#c6d0c8;background:#222c26}.closing::before{position:absolute;top:0;left:calc(50% - 20px);width:40px;height:1px;background:#8fa094;content:''}footer{background:#151b18;color:#9ca9a0}footer .footer-row a{color:#dae0da}.waitlist-section{background:var(--bg);padding:96px 0}.waitlist-section h2{font-family:Iowan Old Style,Charter,Georgia,serif;font-weight:500}.waitlist-input{border-radius:3px;background:var(--bg2)}
@media(max-width:920px){.hero-grid{grid-template-columns:1fr;gap:44px}.hero{padding:82px 0}.section{padding:78px 0}.metrics-grid{padding:0 24px}.metrics-grid,.gnav-inner,.container{padding-left:24px;padding-right:24px}.metric:nth-child(1){border-left:0}}
@media(max-width:560px){body{background-image:none}.container,.gnav-inner{padding:0 18px}.hero{padding:68px 0 72px}.hero::before,.section::before{left:18px}.gnav-brand svg{width:24px;height:24px}.gnav-links{gap:5px}.hero-sub{font-size:15.5px}.section h2{font-size:37px}.metrics-grid{padding:0}.metric:nth-child(1){border-left:0}.time-rail{margin-top:28px}.code-body{font-size:11px}.endpoint,.how-block,.tier{padding:23px 20px}}
`;

// 16×16 pixel-perfect spider web. `shape-rendering: crispEdges` disables
// antialiasing, so integer coordinates produce true pixel art that scales
// up without blurring.
// Pixel-art spider web on a 32x32 grid. `shape-rendering: crispEdges` keeps
// each line a hard 1-2px stair-step at any output size — true 8-bit feel.
function SpiderMark({ size = 20, color = "#111827", id }: { size?: number; color?: string; id?: string }) {
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

function CapabilityIcon({ name }: { name: "context" | "history" | "search" | "vectors" }) {
  const common = { fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round" as const, "stroke-linejoin": "round" as const };
  if (name === "context") {
    return <span class="feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 12h6M8 15h4" /></svg></span>;
  }
  if (name === "history") {
    return <span class="feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" {...common}><path d="M5 8V4m0 4h4M5.8 7.2A8 8 0 1 1 4 12" /><path d="M12 8v5l3 2" /></svg></span>;
  }
  if (name === "search") {
    return <span class="feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" {...common}><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4.5 4.5" /></svg></span>;
  }
  return <span class="feature-icon" aria-hidden="true"><svg viewBox="0 0 24 24" {...common}><circle cx="6" cy="7" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="17" r="2" /><path d="m7.8 8.2 2.7 6.4M16.2 8.2l-2.7 6.4M8 7h8" /></svg></span>;
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
          <SpiderMark size={20} color="#111827" id="anansi-logo" />
          Anansi
        </a>
        <div class="gnav-links">
          <a href="/status" class="gnav-status">status</a>
          <a href="#features" class="gnav-link gnav-optional">Product</a>
          <a href="#enterprise" class="gnav-link gnav-optional">Enterprise</a>
          <a href="/docs" class="gnav-link">Docs</a>
          {!WAITLIST_MODE && <a href="/portal/login" class="gnav-link gnav-optional">Portal</a>}
          {WAITLIST_MODE
            ? <a href="#waitlist" class="gnav-cta">Join the beta →</a>
            : <a href="/portal/signup" class="gnav-cta">Create API key</a>}
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

  // Matches the real surface: GET /v1/entities?asOf=&asOfKnowledge=.
  const biTemporalCode = [
    `<span class="c">// Two parameters make the historical question explicit.</span>`,
    ``,
    `<span class="c">// What was true on May 1, based on records held on May 1?</span>`,
    `<span class="k">await</span> memory.<span class="f">listEntities</span>({`,
    `  userId: <span class="s">"user_abc"</span>,`,
    `  asOf: <span class="s">"2026-05-01"</span>,          <span class="c">// valid-time instant</span>`,
    `  asOfKnowledge: <span class="s">"2026-05-01"</span>, <span class="c">// knowledge-time instant</span>`,
    `});`,
    ``,
    `<span class="c">// What was true on May 1, based on records held today?</span>`,
    `<span class="k">await</span> memory.<span class="f">listEntities</span>({ userId: <span class="s">"user_abc"</span>, asOf: <span class="s">"2026-05-01"</span> });`,
  ].join("\n");

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Anansi — Temporal knowledge API for AI applications</title>
        <meta name="description" content="Ingest source data, return synthesized context, and query a history-aware entity graph. Anansi is an open-source temporal knowledge API for AI applications." />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Anansi — Temporal knowledge API for AI applications" />
        <meta property="og:description" content="Ingest source data, return synthesized context, and query a history-aware entity graph. Anansi is an open-source temporal knowledge API for AI applications." />
        <meta property="og:image" content="/public/logo.png" />
        <meta property="og:url" content="https://anansimemory.com" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Anansi — Temporal knowledge API for AI applications" />
        <meta name="twitter:image" content="/public/logo.png" />
        <link rel="icon" href="/public/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/public/logo.png" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        {ANALYTICS_ENABLED && (
          <script defer data-domain="anansimemory.com" src="https://plausible.io/js/script.js"></script>
        )}
      </head>
      <body>
        {WAITLIST_MODE && <BetaBanner />}
        <GlobalNav />

        {/* ── Hero ── */}
        <section class="hero">
<div class="container">
            <div class="hero-grid">
                <div>
                  <div class="kicker">// temporal knowledge api · v0.3.0 · MIT licensed</div>
                  <h1 class="hero-h1">Give AI systems a record, <em>not just a search index</em>.</h1>
                  <p class="hero-sub">Anansi ingests conversations and connected sources, then returns synthesized context, a history-aware entity graph, and source-linked retrieval. Query what was true — and what the system knew — at any point in time.</p>

                  <div class="time-rail" aria-label="Anansi temporal query model">
                    <div class="time-rail-head">
                      <b>Temporal coordinate</b>
                      <span>two independent questions</span>
                    </div>
                    <div class="time-rail-grid">
                      <div class="time-axis">
                        <div class="time-axis-label">valid-time</div>
                        <p>When was a relationship true in the world?</p>
                      </div>
                      <div class="time-axis">
                        <div class="time-axis-label">knowledge-time</div>
                        <p>When was that relationship recorded by the system?</p>
                      </div>
                    </div>
                  </div>

                  <div class="cta-row">
                    {WAITLIST_MODE
                      ? <a href="#waitlist" class="btn-primary">Join the Anansi beta →</a>
                      : <a href="/portal/signup" class="btn-primary">Create an API key</a>}
                    <a href="/docs/api-reference" class="btn-ghost">Explore the API →</a>
                  </div>
                  <div class="hero-footnotes">
                    <span>REST + JSON</span>
                    <span>API + connectors</span>
                    <span>MIT licensed</span>
                  </div>
                </div>

                <div>
                  <div class="code-card">
                    <div class="code-head">
                      <span>GET /v1/entities · temporal query</span>
                      <span class="dim">valid-time + knowledge-time</span>
                    </div>
                    <div class="code-body" dangerouslySetInnerHTML={{ __html: biTemporalCode }} />
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
                <div class="metric-label">synthesis</div>
                <div class="metric-val">context</div>
                <div class="metric-trend dim">static facts + dynamic context</div>
              </div>
              <div class="metric">
                <div class="metric-label">history</div>
                <div class="metric-val">2 axes</div>
                <div class="metric-trend dim">valid-time + knowledge-time</div>
              </div>
              <div class="metric">
                <div class="metric-label">retrieval</div>
                <div class="metric-val">search</div>
                <div class="metric-trend dim">vector · hybrid on Pro+</div>
              </div>
              <div class="metric">
                <div class="metric-label">ingestion</div>
                <div class="metric-val">sources</div>
                <div class="metric-trend dim">API · Slack · connected tools</div>
              </div>
              <div class="metric">
                <div class="metric-label">deletion</div>
                <div class="metric-val">cascade</div>
                <div class="metric-trend dim">memory user + dependent data</div>
              </div>
              <div class="metric">
                <div class="metric-label">deployment</div>
                <div class="metric-val">MIT</div>
                <div class="metric-trend dim">hosted or self-managed</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section class="section" id="how">
          <div class="container">
            <div class="section-label">from source to context</div>
            <h2>From source data to queryable context.</h2>
            <p class="section-sub">Ingestion preserves source material. Background work synthesizes context and relationship history. Retrieval returns the current context your application needs, or historical state when timing matters.</p>

            <div class="how-grid">
              <div class="how-block">
                <h3>The application model</h3>
                <p>Send Anansi the conversations, documents, and events your application already has. It keeps the source chunks, synthesizes stable and changing context, and maintains relationships over time.</p>
                <ol>
                  <li>Ingest a conversation, document, or event</li>
                  <li>Background jobs embed and synthesize the source material</li>
                  <li>Retrieve a profile and relevant chunks for the next request</li>
                  <li>Query relationship history when a past state matters</li>
                </ol>
              </div>
              <div class="how-block tech">
                <h3>What the API preserves</h3>
                <p>Source chunks remain addressable while synthesis writes a versioned profile and a temporal entity graph.</p>
                <ol>
                  <li><b>Ingest path</b> — <span class="mono">POST /v1/ingest</span> → secret redaction + configured PII rules → chunker (~512 tok, 50 overlap, source-aware) → pgvector + Postgres. Embedding and synthesis run through background jobs; the request returns <span class="mono">202</span> after queuing them.</li>
                  <li><b>Synthesis worker</b> — BullMQ job, advisory-locked per user. An LLM pass reads accumulated chunks and writes <span class="mono">static_facts</span> (≤30) + <span class="mono">dynamic_context</span> (≤15) + bi-temporal entity graph.</li>
                  <li><b>Retrieve path</b> — <span class="mono">GET /v1/context</span> → Redis cache (60s TTL) → vector search; plans with hybrid search add parallel BM25 + reciprocal rank fusion → JSON.</li>
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
                <text x="471" y="74" text-anchor="middle" class="n-sub">secrets + PII rules</text>

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
                <text x="629" y="366" text-anchor="middle" class="n-sub">vector · BM25 + RRF (Pro+)</text>

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
            <h2>Built for retrieval — and the context around it.</h2>
            <p class="section-sub">The contract is REST, bearer-token authentication, and JSON. Ingest and context cover the core flow; search and entities expose the raw material and temporal state behind it.</p>
            <div class="endpoints">
              <div class="endpoint">
                <div class="endpoint-row">
                  <span class="endpoint-method method-post">POST</span>
                  <span class="endpoint-path">/v1/ingest</span>
                </div>
                <p>Store a conversation turn, document, note, or meeting transcript. The request queues processing and returns <span class="mono">202</span>; background jobs perform embedding and synthesis.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row">
                  <span class="endpoint-method method-get">GET</span>
                  <span class="endpoint-path">/v1/context</span>
                </div>
                <p>Return synthesized <span class="mono">static</span> facts, <span class="mono">dynamic</span> context, and optional <span class="mono">relevant</span> chunks for the next application request.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row">
                  <span class="endpoint-method method-post">POST</span>
                  <span class="endpoint-path">/v1/search</span>
                </div>
                <p>Search the stored chunks directly. Pro+ combines vector and BM25 retrieval with reciprocal-rank fusion.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row">
                  <span class="endpoint-method method-get">GET</span>
                  <span class="endpoint-path">/v1/entities</span>
                </div>
                <p>Query entity relationships by valid-time and knowledge-time with <span class="mono">asOf</span> and <span class="mono">asOfKnowledge</span>. Pro+.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Product model ── */}
        <section class="section" id="features">
          <div class="container">
            <div class="section-label">the product model</div>
            <h2>More useful than a matching result alone.</h2>
            <p class="section-sub">Anansi stores source chunks, synthesizes current context, and keeps relationship history as a queryable part of the same system.</p>
            <div class="endpoints" style="margin-bottom:14px">
              <div class="endpoint">
                <div class="endpoint-row"><CapabilityIcon name="context" /><span class="endpoint-path">Synthesized context</span></div>
                <p>A background synthesis pass writes stable facts and changing context from accumulated chunks. <span class="mono">GET /v1/context</span> returns both, with relevant chunks when requested.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><CapabilityIcon name="history" /><span class="endpoint-path">Historical entity state</span></div>
                <p>Entity edges track <span class="mono">valid-time</span> (when a relationship was true) and <span class="mono">knowledge-time</span> (when it was recorded). Query either coordinate.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><CapabilityIcon name="search" /><span class="endpoint-path">Direct retrieval</span></div>
                <p>Use <span class="mono">POST /v1/search</span> when your application needs chunks rather than a profile. Search results retain source IDs and metadata.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><CapabilityIcon name="vectors" /><span class="endpoint-path">Portable vector layer</span></div>
                <p>Use Nomic or local Ollama embeddings, or pass a pre-computed <span class="mono">embedding</span> with ingestion. The API stores 768-dimensional vectors.</p>
              </div>
            </div>

            {/* Core ingest/context exchange — public API surface */}
            <div class="code-card">
              <div class="code-head">
                <span>POST /v1/ingest · GET /v1/context</span>
                <span class="dim">REST · JSON · bearer auth</span>
              </div>
              <div class="code-body" dangerouslySetInnerHTML={{ __html: ingestCode }} />
            </div>
          </div>
        </section>

        {/* ── Where it fits ── */}
        <section class="section" id="use-cases">
          <div class="container">
            <div class="section-label">where it fits</div>
            <h2>Use Anansi when context has structure and history.</h2>
            <p class="section-sub">The strongest fit is an application that needs more than a list of similar chunks: it needs current context, source material, or a past state.</p>
            <div class="endpoints">
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Continuity across requests</span></div>
                <p>Use synthesized profiles and relevant chunks to give an AI application the context it needs for the next response.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Connected team sources</span></div>
                <p>Ingest through the API, Slack, Notion, Google Docs, Linear, or a transcript webhook, then retrieve the resulting context from the same API.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Time-sensitive state</span></div>
                <p>Query what was true at a point in time or what had been recorded by then. <span class="mono">DELETE /v1/user</span> removes the memory user and its dependent data.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Decision table ── */}
        <section class="section" id="compare">
          <div class="container">
            <div class="section-label">beyond similarity search</div>
            <h2>The question determines the surface.</h2>
            <p class="section-sub">Similarity search answers one useful question. Anansi also exposes synthesized context and historical entity state through the public API.</p>
            <div class="compare-wrap">
              <table class="compare">
                <thead>
                  <tr>
                    <th>application question</th>
                    <th class="col-anansi">API surface</th>
                    <th>returns</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>What source material matches this request?</td><td class="yes"><span class="mono">POST /v1/search</span></td><td>Stored chunks, source IDs, and metadata</td></tr>
                  <tr class="feat-anansi"><td>What context should the next request carry forward?</td><td class="yes"><span class="mono">GET /v1/context</span></td><td>Static facts, dynamic context, and optional relevant chunks</td></tr>
                  <tr class="feat-anansi"><td>What relationship was true at a prior time?</td><td class="yes"><span class="mono">GET /v1/entities</span></td><td>Entity relationships at <span class="mono">asOf</span> and <span class="mono">asOfKnowledge</span> (Pro+)</td></tr>
                  <tr><td>Which stored items belong to this user or source?</td><td class="yes"><span class="mono">GET /v1/memories</span></td><td>Stored chunks and their source metadata</td></tr>
                </tbody>
              </table>
            </div>
            <p style="color:var(--dim);font-size:12px;margin-top:10px;font-family:'SF Mono',Menlo,monospace">// public surfaces verified in <span class="mono">/v1</span></p>
          </div>
        </section>

        {/* ── Enterprise ── */}
        <section class="section" id="enterprise">
          <div class="container">
            <div class="section-label">enterprise controls</div>
            <h2>Control how knowledge is operated.</h2>
            <p class="section-sub">The Enterprise console provides identity, governance, and administrative controls for the organizations that operate Anansi.</p>
            <div class="endpoints">
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Identity and access</span></div>
                <p>Configure SSO and manage SCIM provisioning tokens. Enterprise routes apply organization permissions to each administrative action.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Governance controls</span></div>
                <p>Manage approval requests and redaction rules from the Enterprise console.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Administrative audit</span></div>
                <p>The Enterprise console records its administrative mutations and provides audit-log and NDJSON export endpoints.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Edition enforcement</span></div>
                <p>Enterprise routes are entitlement-gated; self-hosted Enterprise deployments also require a valid organization-bound license.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Open source ── */}
        <section class="section" id="open-source">
          <div class="container">
            <div class="section-label">open source</div>
            <h2>Run the core data plane yourself.</h2>
            <p class="section-sub">Anansi is MIT-licensed. The repository includes the API, PostgreSQL, Redis, migrations, and deployment configuration rather than an SDK-only client.</p>
            <div class="endpoints">
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Compose services</span></div>
                <p><span class="mono">docker compose up</span> starts the API, PostgreSQL, and Redis services. Configure a model provider separately for embeddings and synthesis.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Local deployment mode</span></div>
                <p>With <span class="mono">DEPLOYMENT_MODE=local</span> and local Ollama for embeddings and synthesis, content-exporting telemetry is disabled and cloud AI providers are rejected at startup.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Choose the vector path</span></div>
                <p>Use Nomic or local Ollama embeddings, or provide pre-computed 768-dimensional embeddings in the ingest request.</p>
              </div>
              <div class="endpoint">
                <div class="endpoint-row"><span class="endpoint-path">Inspect the implementation</span></div>
                <p>Ingestion, retrieval, synthesis, temporal graph modeling, and the public API routes are all present in the repository.</p>
              </div>
            </div>
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
                  <li>Notion, Google Docs, Linear + transcript webhook</li>
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
            <p class="quote">A useful system should retain the source, the context, and the history behind a decision.</p>
            <h2>Build AI on queryable knowledge.</h2>
            <p>Ingest source data, retrieve current context, and query historical entity state through one API.</p>
            <div class="cta-row">
              {WAITLIST_MODE
                ? <a href="#waitlist" class="btn-primary">Join the Anansi beta →</a>
                : <a href="/portal/signup" class="btn-primary">Create an API key</a>}
              <a href="/docs/api-reference" class="btn-ghost">Explore the API →</a>
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
