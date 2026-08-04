/** @jsxImportSource hono/jsx */
import { THEME_SCRIPT, withDoctype } from "../../lib/ui/theme.js";

export const APP_URL = process.env.APP_URL ?? "https://anansimemory.com";

// ─── Syntax highlighting ──────────────────────────────────────────────────────

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(code: string, lang: string): string {
  const e = esc(code);
  if (lang === "json") {
    return e
      .replace(/"([^"]+)"(\s*:)/g, '<span class="prop">"$1"</span>$2')
      .replace(/:\s*"([^"]*)"/g, ': <span class="str">"$1"</span>')
      .replace(/:\s*(\d+\.?\d*)/g, ': <span class="num">$1</span>')
      .replace(/:\s*(true|false|null)/g, ': <span class="kw">$1</span>');
  }
  if (lang === "typescript" || lang === "javascript") {
    return e
      .replace(/(\/\/[^\n]*)/g, '<span class="cm">$1</span>')
      .replace(/\b(const|let|var|async|await|function|return|export|import|from|if|else|new|class|extends|throw|type|interface|string|boolean|number|void|any)\b/g, '<span class="kw">$1</span>')
      .replace(/&lt;T&gt;/g, '&lt;<span class="fn">T</span>&gt;')
      .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="str">$1</span>')
      .replace(/(`(?:[^`\\]|\\.)*`)/gs, '<span class="str">$1</span>')
      .replace(/('(?:[^'\\]|\\.)*')/g, '<span class="str">$1</span>')
      .replace(/\b(\d+)\b(?!;)/g, '<span class="num">$1</span>');
  }
  if (lang === "shell") {
    return e
      .replace(/(curl|sleep|export|echo)\b/g, '<span class="kw">$1</span>')
      .replace(/("(?:[^"\\]|\\.)*")/g, '<span class="str">$1</span>')
      .replace(/(#[^\n]*)/g, '<span class="cm">$1</span>');
  }
  return e;
}

export function CodeBlock({ lang, file, code }: { lang: string; file?: string; code: string }) {
  return (
    <div class="code-block">
      <div class="code-bar">
        <span class="code-lang">{lang}</span>
        {file && <span class="code-file">{file}</span>}
      </div>
      <div class="code-body" dangerouslySetInnerHTML={{ __html: highlight(code.trim(), lang) }} />
    </div>
  );
}

export function Response({ status, body }: { status: number; body: string }) {
  const ok = status < 400;
  return (
    <div class="response">
      <div class="response-header">
        <span class={ok ? "status-ok" : "status-err"}>{status}</span>
        <span class="response-label">{ok ? "Response" : "Error"}</span>
      </div>
      <div class="response-body" dangerouslySetInnerHTML={{ __html: highlight(body.trim(), "json") }} />
    </div>
  );
}

// ─── Docs theme — grey to differentiate from landing ─────────────────────────
// Palette: #1a1a1c page · #141416 sidebar · #232326 card/code · #2c2c2e header
// Text: #f5f5f7 primary · #a1a1a6 secondary · #636366 muted
// Accent: #c0c0c0 (silver) · Borders: rgba(255,255,255,.08)

const css = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','SF Pro Icons',Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;background:#1a1a1c;color:#f5f5f7;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;line-height:1.47;font-size:17px}
a{color:#c0c0c0;text-decoration:none}
a:hover{text-decoration:underline}
strong{font-weight:600}

/* ── Skip link — visible only on keyboard focus ── */
.skip-link{position:absolute;left:-9999px;top:0;z-index:300;background:#c0c0c0;color:#0e1116;padding:8px 16px;border-radius:0 0 8px 0;font-size:13px;font-weight:600;text-decoration:none}
.skip-link:focus{left:0}

/* ── Global nav ── */
.gnav{position:sticky;top:0;z-index:200;height:44px;background:rgba(0,0,0,.92);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid rgba(255,255,255,.1);display:flex;align-items:center;padding:0 22px}
.gnav-inner{width:100%;max-width:1440px;margin:0 auto;display:flex;align-items:center;justify-content:space-between}
.gnav-logo{font-size:17px;font-weight:600;color:#f5f5f7;letter-spacing:-0.374px;text-decoration:none;display:flex;align-items:center;gap:6px;flex-shrink:0}
.gnav-logo-dot{width:7px;height:7px;background:#c0c0c0;border-radius:50%;flex-shrink:0}
.gnav-logo:hover{text-decoration:none}
.gnav-logo-sep{color:rgba(255,255,255,.3);font-weight:300;margin:0 2px}
.gnav-links{display:flex;align-items:center;gap:20px}
.gnav-link{font-size:12px;font-weight:400;color:rgba(255,255,255,.6);letter-spacing:-0.01em;text-decoration:none;transition:color .12s}
.gnav-link:hover{color:#fff;text-decoration:none}
.gnav-cta{font-size:12px;font-weight:400;letter-spacing:-0.01em;color:#0e1116;background:#c0c0c0;padding:6px 16px;border-radius:980px;text-decoration:none;transition:background .15s}
.gnav-cta:hover{background:#e8e8e8;text-decoration:none}

/* ── Docs layout ── */
.docs-wrap{display:flex;min-height:calc(100vh - 44px)}

/* ── Left sidebar ── */
.sidebar{width:232px;flex-shrink:0;padding:24px 0 64px;border-right:1px solid rgba(255,255,255,.08);position:sticky;top:44px;height:calc(100vh - 44px);overflow-y:auto;background:#141416}
.sidebar::-webkit-scrollbar{width:3px}
.sidebar::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:2px}
.sidebar-section{margin-bottom:24px;padding:0 12px}
.sidebar-heading{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#48484a;margin-bottom:6px;padding:0 10px}
.sidebar-links{display:flex;flex-direction:column;gap:1px}
.sidebar-link{display:block;padding:6px 10px;border-radius:6px;font-size:14px;font-weight:400;letter-spacing:-0.224px;color:#98989d;transition:all .1s;text-decoration:none}
.sidebar-link:hover{background:rgba(255,255,255,.06);color:#f5f5f7;text-decoration:none}
.sidebar-link.active{background:rgba(232,232,232,.15);color:#c0c0c0;font-weight:500}
.sidebar-link.active:hover{text-decoration:none}

/* ── Center content ── */
.doc-center{flex:1;min-width:0;display:flex;justify-content:center;background:#1a1a1c}
.doc-content{width:100%;max-width:720px;padding:40px 48px 100px}

/* ── Right on-this-page ── */
.on-page{width:196px;flex-shrink:0;padding:40px 0 64px 0;background:#1a1a1c}
.on-page-sticky{position:sticky;top:60px}
.on-page-heading{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#48484a;margin-bottom:10px;padding:0 16px}
.on-page-links{display:flex;flex-direction:column;gap:2px;padding:0 8px}
.on-page-link{display:block;padding:4px 8px;border-radius:4px;font-size:12px;letter-spacing:-0.12px;color:#636366;text-decoration:none;transition:color .1s;line-height:1.4}
.on-page-link:hover{color:#c0c0c0;text-decoration:none}

/* ── Breadcrumb ── */
.breadcrumb{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:400;letter-spacing:-0.12px;color:#636366;margin-bottom:20px}
.breadcrumb a{color:#636366;text-decoration:none}
.breadcrumb a:hover{color:#c0c0c0}
.breadcrumb-sep{color:#3a3a3c}

/* ── Page title ── */
.page-title{font-size:clamp(28px,4vw,40px);font-weight:600;line-height:1.1;letter-spacing:0;color:#f5f5f7;margin-bottom:10px}
.page-sub{font-size:17px;font-weight:400;line-height:1.47;letter-spacing:-0.374px;color:#98989d;margin-bottom:40px;max-width:520px}

/* ── Body typography ── */
h2{font-size:21px;font-weight:600;line-height:1.19;letter-spacing:0.231px;color:#f5f5f7;margin:40px 0 10px;padding-top:40px;border-top:1px solid rgba(255,255,255,.08);scroll-margin-top:80px}
h2.first{border-top:none;padding-top:0;margin-top:0}
h3{font-size:17px;font-weight:600;line-height:1.24;letter-spacing:-0.374px;color:#f5f5f7;margin:20px 0 6px;scroll-margin-top:80px}
p{color:#c7c7cc;font-size:17px;font-weight:400;line-height:1.47;letter-spacing:-0.374px;margin-bottom:14px}
ul,ol{color:#c7c7cc;padding-left:20px;margin-bottom:14px}
li{font-size:17px;font-weight:400;line-height:1.47;letter-spacing:-0.374px;margin-bottom:6px}
code{font-family:'SF Mono','Fira Code','Cascadia Code',monospace;background:#232326;border:1px solid rgba(255,255,255,.1);padding:2px 6px;border-radius:5px;font-size:.82em;color:#f5f5f7}

/* ── Code blocks — grey bg like Apple Developer Docs ── */
.code-block{background:#232326;border-radius:10px;overflow:hidden;margin:16px 0;border:1px solid rgba(255,255,255,.1)}
.code-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:#2c2c2e;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px}
.code-lang{color:#c0c0c0;font-weight:600;letter-spacing:.06em;text-transform:uppercase;font-family:'SF Mono','Fira Code',monospace}
.code-file{color:#636366;font-family:'SF Mono','Fira Code',monospace}
.code-body{padding:18px 20px;font-family:'SF Mono','Fira Code',monospace;font-size:13px;line-height:1.85;overflow-x:auto;color:#e5e5ea;white-space:pre}
.kw{color:#fc5fa3}.str{color:#fc6a5d}.fn{color:#5dd8ff}.prop{color:#41a1c0}.cm{color:#6c7986}.num{color:#d9c97c}

/* ── Callouts ── */
.callout{display:flex;gap:12px;padding:14px 18px;border-radius:8px;margin:18px 0;border:1px solid;border-left-width:3px}
.callout-info{background:rgba(232,232,232,.1);border-color:rgba(232,232,232,.2);border-left-color:#c0c0c0}
.callout-tip{background:rgba(48,209,88,.08);border-color:rgba(48,209,88,.18);border-left-color:#30d158}
.callout-warn{background:rgba(255,159,10,.08);border-color:rgba(255,159,10,.18);border-left-color:#ff9f0a}
.callout-tag{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;flex-shrink:0;margin-top:3px;white-space:nowrap}
.callout-info .callout-tag{color:#c0c0c0}
.callout-tip .callout-tag{color:#30d158}
.callout-warn .callout-tag{color:#ff9f0a}
.callout-body{font-size:14px;font-weight:400;line-height:1.43;letter-spacing:-0.224px}
.callout-info .callout-body{color:#c7d8f7}
.callout-tip .callout-body{color:#b8f0c8}
.callout-warn .callout-body{color:#f7e0b8}

/* ── Cards ── */
.card-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:20px 0}
.card{background:#232326;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:20px;transition:border-color .15s;display:block;text-decoration:none}
.card:hover{border-color:rgba(232,232,232,.5);text-decoration:none}
.card h3{font-size:14px;font-weight:600;letter-spacing:-0.224px;color:#f5f5f7;margin:0 0 5px}
.card p{font-size:12px;font-weight:400;letter-spacing:-0.12px;color:#636366;line-height:1.5;margin:0}

/* ── Steps ── */
.steps{display:flex;flex-direction:column;gap:0;margin:20px 0}
.step{display:flex;gap:16px;padding:18px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.step:last-child{border-bottom:none}
.step-num{width:28px;height:28px;border-radius:50%;flex-shrink:0;background:rgba(232,232,232,.15);color:#c0c0c0;font-weight:600;font-size:12px;display:flex;align-items:center;justify-content:center;margin-top:2px;border:1.5px solid rgba(232,232,232,.3)}
.step-body h3{font-size:14px;font-weight:600;letter-spacing:-0.224px;color:#f5f5f7;margin:0 0 4px}
.step-body p{font-size:14px;font-weight:400;line-height:1.43;letter-spacing:-0.224px;color:#98989d;margin:0}

/* ── API endpoints ── */
.endpoint{background:#232326;border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:hidden;margin:20px 0}
.endpoint-header{display:flex;align-items:center;gap:10px;padding:12px 18px;border-bottom:1px solid rgba(255,255,255,.06);background:#2c2c2e}
.method{font-family:'SF Mono','Fira Code',monospace;font-size:11px;font-weight:600;padding:3px 8px;border-radius:5px;letter-spacing:.05em;text-transform:uppercase}
.method-post{background:rgba(232,232,232,.2);color:#c0c0c0}
.method-get{background:rgba(48,209,88,.15);color:#30d158}
.method-delete{background:rgba(255,69,58,.15);color:#ff453a}
.endpoint-path{font-family:'SF Mono','Fira Code',monospace;font-size:14px;color:#f5f5f7;font-weight:600}
.endpoint-desc{font-size:14px;font-weight:400;line-height:1.43;letter-spacing:-0.224px;color:#98989d;padding:12px 18px;border-bottom:1px solid rgba(255,255,255,.06)}
.endpoint-section{padding:14px 18px}
.endpoint-section+.endpoint-section{border-top:1px solid rgba(255,255,255,.06)}
.endpoint-section-label{font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#636366;margin-bottom:8px}
.param-table{width:100%;border-collapse:collapse;font-size:14px}
.param-table th{text-align:left;padding:6px 10px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#636366;border-bottom:1px solid rgba(255,255,255,.08)}
.param-table td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top}
.param-table tr:last-child td{border-bottom:none}
.param-name{font-family:'SF Mono','Fira Code',monospace;color:#c0c0c0;font-size:13px}
.param-type{color:#bf5af2;font-family:'SF Mono','Fira Code',monospace;font-size:12px}
.param-req{color:#ff453a;font-size:11px;font-weight:600;background:rgba(255,69,58,.15);padding:1px 6px;border-radius:3px}
.param-opt{color:#636366;font-size:11px;background:rgba(255,255,255,.08);padding:1px 6px;border-radius:3px}
.param-desc{color:#98989d;letter-spacing:-0.224px}

/* ── Response ── */
.response{background:#232326;border-radius:10px;overflow:hidden;margin:10px 0;border:1px solid rgba(255,255,255,.1)}
.response-header{padding:7px 14px;background:#2c2c2e;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px;color:#636366;display:flex;align-items:center;gap:8px}
.response-label{color:#636366}
.status-ok{color:#30d158;font-weight:600;font-family:monospace}
.status-err{color:#ff453a;font-weight:600;font-family:monospace}
.response-body{padding:12px 16px;font-family:'SF Mono','Fira Code',monospace;font-size:13px;line-height:1.7;color:#e5e5ea;white-space:pre}

/* ── Footer ── */
.doc-footer{padding:28px 48px;border-top:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:400;letter-spacing:-0.12px;color:#636366}
.doc-footer a{color:#636366;text-decoration:none}
.doc-footer a:hover{color:#c0c0c0}
.doc-footer-links{display:flex;gap:20px}

/* ── Mobile nav (collapsible; replaces the sidebar below 768px) ── */
.mobile-nav{display:none;margin-bottom:24px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:#141416}
.mobile-nav summary{cursor:pointer;padding:12px 16px;font-size:14px;font-weight:600;color:#f5f5f7;list-style:none;display:flex;align-items:center;justify-content:space-between}
.mobile-nav summary::after{content:'+';color:#98989d;font-size:16px}
.mobile-nav[open] summary::after{content:'−'}
.mobile-nav nav{padding:4px 4px 12px;border-top:1px solid rgba(255,255,255,.08)}
[data-theme="light"] .mobile-nav{background:#f8f6f9;border-color:rgba(0,0,0,.08)}
[data-theme="light"] .mobile-nav summary{color:#1d1320}

/* ── Mobile ── */
@media(max-width:1024px){.on-page{display:none}}
@media(max-width:768px){
  .sidebar{display:none}
  .mobile-nav{display:block}
  .doc-content{padding:28px 20px 60px}
  .card-grid{grid-template-columns:1fr}
  .gnav-links{display:none}
  .doc-footer{padding:20px;flex-direction:column;gap:8px;text-align:center}
}

/* ── Theme toggle button ── */
.theme-toggle{background:transparent;border:1px solid rgba(255,255,255,.14);color:#f5f5f7;width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;margin-right:10px;transition:border-color .15s, background .15s;flex-shrink:0}
.theme-toggle:hover{border-color:rgba(255,255,255,.32);background:rgba(255,255,255,.04)}
.theme-toggle svg{width:15px;height:15px}
.theme-toggle .moon{display:none}
.theme-toggle .sun{display:block}
[data-theme="light"] .theme-toggle{border-color:rgba(0,0,0,.14);color:#1d1320}
[data-theme="light"] .theme-toggle:hover{border-color:rgba(0,0,0,.32);background:rgba(0,0,0,.04)}
[data-theme="light"] .theme-toggle .moon{display:block}
[data-theme="light"] .theme-toggle .sun{display:none}

/* ── Light-theme overrides ── */
[data-theme="light"] body{background:#ffffff;color:#1d1320}
[data-theme="light"] a{color:#1d1320}
[data-theme="light"] .gnav{background:rgba(255,255,255,.84);border-bottom:1px solid rgba(0,0,0,.08)}
[data-theme="light"] .gnav-logo{color:#1d1320}
[data-theme="light"] .gnav-logo-sep,[data-theme="light"] .gnav-logo span{color:rgba(29,19,32,.45) !important}
[data-theme="light"] .gnav-logo-dot{background:#1d1320}
[data-theme="light"] .gnav-link{color:#6b5e72}
[data-theme="light"] .gnav-link:hover{color:#1d1320}
[data-theme="light"] .gnav-cta{background:#1d1320;color:#fff}
[data-theme="light"] .gnav-cta:hover{background:#000000}
[data-theme="light"] .sidebar{background:#f8f6f9;border-right-color:rgba(0,0,0,.08)}
[data-theme="light"] .sidebar-heading{color:#a092ab}
[data-theme="light"] .sidebar-link{color:#6b5e72}
[data-theme="light"] .sidebar-link:hover{background:rgba(0,0,0,.04);color:#1d1320}
[data-theme="light"] .sidebar-link.active{background:rgba(102,35,109,.10);color:#1d1320}
[data-theme="light"] .doc-center,[data-theme="light"] .on-page{background:#ffffff}
[data-theme="light"] .on-page-heading{color:#a092ab}
[data-theme="light"] .on-page-link{color:#8a808f}
[data-theme="light"] .on-page-link:hover{color:#1d1320}
[data-theme="light"] .breadcrumb,[data-theme="light"] .breadcrumb a{color:#8a808f}
[data-theme="light"] .breadcrumb a:hover{color:#1d1320}
[data-theme="light"] .breadcrumb-sep{color:#c8c0cf}
[data-theme="light"] .page-title{color:#1d1320}
[data-theme="light"] .page-sub{color:#6b5e72}
[data-theme="light"] h2,[data-theme="light"] h3{color:#1d1320;border-top-color:rgba(0,0,0,.08) !important}
[data-theme="light"] p,[data-theme="light"] ul,[data-theme="light"] ol{color:#3a3140}
[data-theme="light"] code{background:#f3f0f5;border-color:rgba(0,0,0,.08);color:#1d1320}
[data-theme="light"] .code-block{background:#f3f0f5;border-color:rgba(0,0,0,.08)}
[data-theme="light"] .code-header{background:#ebe6ee;border-bottom-color:rgba(0,0,0,.08);color:#6b5e72}
[data-theme="light"] .code-block pre,[data-theme="light"] .code-block code{color:#1d1320 !important;background:transparent !important}
[data-theme="light"] .callout{background:#f8f6f9;border-color:rgba(0,0,0,.08)}
[data-theme="light"] .callout strong,[data-theme="light"] .callout-body strong{color:#1d1320}
[data-theme="light"] .doc-footer{border-top-color:rgba(0,0,0,.08);color:#8a808f}
[data-theme="light"] .doc-footer a{color:#6b5e72}
[data-theme="light"] table,[data-theme="light"] th,[data-theme="light"] td{border-color:rgba(0,0,0,.08) !important;color:#3a3140}
[data-theme="light"] th{background:#f3f0f5 !important;color:#1d1320}
[data-theme="light"] tr:nth-child(2n) td{background:#fbfafc}
`;

// ─── Components ───────────────────────────────────────────────────────────────

function GlobalNav() {
  return (
    <nav class="gnav">
      <div class="gnav-inner">
        <a href="/" class="gnav-logo">
          <div class="gnav-logo-dot" />
          Anansi<span class="gnav-logo-sep">/</span><span style="color:rgba(245,245,247,.4);font-weight:300">docs</span>
        </a>
        <div class="gnav-links">
          <a href="/docs" class="gnav-link">Overview</a>
          <a href="/docs/quickstart" class="gnav-link">Quickstart</a>
          <a href="/docs/api-reference" class="gnav-link">API Reference</a>
          <a href="/" class="gnav-link">← Site</a>
        </div>
        <div style="display:flex;align-items:center">
          <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" title="Toggle light/dark">
            <svg class="sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>
            <svg class="moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z"/></svg>
          </button>
          <a href="/portal/login" class="gnav-cta">Get API Key</a>
        </div>
      </div>
    </nav>
  );
}

const themeScript = THEME_SCRIPT;

const DOCS_NAV = [
    { section: "Getting Started", links: [
      { label: "Overview", href: "/docs" },
      { label: "Quickstart", href: "/docs/quickstart" },
      { label: "Landscape", href: "/docs/landscape" },
      { label: "FAQ", href: "/docs/faq" },
    ]},
    { section: "API Reference", links: [
      { label: "Authentication", href: "/docs/api-reference" },
      { label: "POST /v1/ingest", href: "/docs/api-reference#ingest" },
      { label: "POST /v1/ingest/batch", href: "/docs/api-reference#batch" },
      { label: "GET /v1/context", href: "/docs/api-reference#context" },
      { label: "GET /v1/entities", href: "/docs/api-reference#entities" },
      { label: "POST /v1/search", href: "/docs/api-reference#search" },
      { label: "DELETE /v1/memory", href: "/docs/api-reference#delete" },
      { label: "GET /v1/ledger", href: "/docs/api-reference#ledger" },
      { label: "GET /v1/ledger/divergences", href: "/docs/api-reference#ledger-divergences" },
      { label: "GET /v1/ledger/timeline", href: "/docs/api-reference#ledger-timeline" },
    ]},
    { section: "Concepts", links: [
      { label: "Entity graph", href: "/docs/guides/entity-graph" },
      { label: "Temporal memory", href: "/docs/guides/temporal-memory" },
      { label: "Metadata filters", href: "/docs/guides/metadata-filters" },
    ]},
    { section: "Guides", links: [
      { label: "Claude chatbot", href: "/docs/guides/claude-chatbot" },
      { label: "Voice agent", href: "/docs/guides/voice-agent" },
      { label: "Multi-agent", href: "/docs/guides/multi-agent" },
      { label: "Tool & action memory", href: "/docs/guides/tool-actions" },
      { label: "Onboarding", href: "/docs/guides/onboarding" },
      { label: "Notion connector", href: "/docs/guides/notion" },
      { label: "Meeting transcripts", href: "/docs/guides/meetings" },
      { label: "Slack memory", href: "/docs/guides/slack-memory" },
    ]},
];

function NavSections({ active }: { active: string }) {
  return (
    <>
      {DOCS_NAV.map((s) => (
        <div class="sidebar-section">
          <div class="sidebar-heading">{s.section}</div>
          <div class="sidebar-links">
            {s.links.map((l) => (
              <a
                href={l.href}
                class={`sidebar-link${active === l.href ? " active" : ""}`}
                aria-current={active === l.href ? "page" : undefined}
              >{l.label}</a>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function Sidebar({ active }: { active: string }) {
  return (
    <nav class="sidebar" aria-label="Documentation">
      <NavSections active={active} />
    </nav>
  );
}

// Mobile-only collapsible nav — the sidebar is hidden below 768px, so this is
// the only way to move between doc pages on a phone.
function MobileNav({ active }: { active: string }) {
  return (
    <details class="mobile-nav">
      <summary>Documentation menu</summary>
      <nav aria-label="Documentation">
        <NavSections active={active} />
      </nav>
    </details>
  );
}

function OnThisPage({ links }: { links: { label: string; href: string }[] }) {
  if (!links.length) return <div class="on-page" />;
  return (
    <aside class="on-page">
      <div class="on-page-sticky">
        <div class="on-page-heading">On this page</div>
        <div class="on-page-links">
          {links.map((l) => (
            <a href={l.href} class="on-page-link">{l.label}</a>
          ))}
        </div>
      </div>
    </aside>
  );
}

export function layout(active: string, onPage: { label: string; href: string }[], content: any) {
  return withDoctype(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Anansi Docs — Memory API for AI apps</title>
        <meta name="description" content="Documentation for Anansi: persistent, synthesized memory for any LLM. Two API calls, any model." />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Anansi Docs — Memory API for AI apps" />
        <meta property="og:description" content="Synthesized memory for any LLM. Static facts + dynamic context, ready to inject into your system prompt." />
        <meta property="og:image" content="/public/logo.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:image" content="/public/logo.png" />
        <link rel="icon" href="/public/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/public/logo.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700&display=swap" />
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a href="#main-content" class="skip-link">Skip to content</a>
        <GlobalNav />
        <div class="docs-wrap">
          <Sidebar active={active} />
          <div class="doc-center">
            <main class="doc-content" id="main-content">
              <MobileNav active={active} />
              {content}
              <footer class="doc-footer">
                <div>© {new Date().getFullYear()} Anansi · Built by <a href="https://www.linkedin.com/in/jibrilsuleiman" target="_blank" rel="noopener noreferrer">Jibril Suleiman</a></div>
                <div class="doc-footer-links">
                  <a href="/portal/login">Portal</a>
                  <a href="/">Homepage</a>
                  <a href="/health">Status</a>
                </div>
              </footer>
            </main>
          </div>
          <OnThisPage links={onPage} />
        </div>
      </body>
    </html>
  );
}

