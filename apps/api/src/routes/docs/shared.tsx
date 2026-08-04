/** @jsxImportSource hono/jsx */
import { withDoctype } from "../../lib/ui/theme.js";

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
        <button type="button" class="code-copy" data-copy-code aria-label="Copy code example">Copy</button>
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
        <button type="button" class="code-copy" data-copy-code aria-label="Copy response example">Copy</button>
      </div>
      <div class="response-body" dangerouslySetInnerHTML={{ __html: highlight(body.trim(), "json") }} />
    </div>
  );
}

// ─── Documentation system — The Research Lab ─────────────────────────────────
// Paper is used for reading, graphite for operations, and signal blue for the
// single action that moves a developer forward. The dark theme retains that
// hierarchy rather than merely inverting the page.

const css = `
:root{--paper:#f7f6f2;--paper-raised:#fffefa;--paper-muted:#eeece6;--ink:#152033;--ink-soft:#516073;--ink-faint:#7e8997;--line:#dedbd3;--line-strong:#cac6bd;--graphite:#101722;--graphite-2:#172131;--graphite-3:#223044;--code-ink:#dbe7f5;--code-muted:#8291a8;--signal:#1769e0;--signal-strong:#0e54bd;--signal-wash:#e8f0ff;--green:#19724b;--green-wash:#e7f5ed;--amber:#9a5a08;--amber-wash:#fff3de;--red:#b83b38;--red-wash:#fcebea;--display:ui-serif,Georgia,Cambria,'Times New Roman',serif;--body:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--mono:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{min-width:320px;background:var(--paper);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.68;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:var(--signal-strong);text-decoration:none;text-underline-offset:3px}
a:hover{text-decoration:underline}
strong{font-weight:650;color:var(--ink)}
:focus{outline:none}
:focus-visible{outline:3px solid rgba(23,105,224,.34);outline-offset:3px;border-radius:3px}

/* Keyboard access remains immediate, but never interrupts normal reading. */
.skip-link{position:absolute;top:10px;left:12px;z-index:400;transform:translateY(-160%);padding:8px 12px;background:var(--signal);color:#fff;border-radius:5px;font-size:13px;font-weight:700;text-decoration:none;transition:transform .16s ease}
.skip-link:focus{transform:translateY(0)}

/* ── Global command bar ── */
.gnav{position:sticky;top:0;z-index:200;height:58px;background:rgba(16,23,34,.96);border-bottom:1px solid rgba(255,255,255,.12);display:flex;align-items:center;padding:0 24px}
.gnav-inner{width:100%;max-width:1600px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:20px}
.gnav-logo{display:flex;align-items:center;gap:9px;color:#f7f9fc;font-size:15px;font-weight:650;letter-spacing:-.02em;text-decoration:none;white-space:nowrap}
.gnav-logo:hover{text-decoration:none}
.gnav-logo-dot{position:relative;width:17px;height:17px;border:1px solid rgba(255,255,255,.78);border-radius:50%}
.gnav-logo-dot::before,.gnav-logo-dot::after{content:'';position:absolute;background:#6fa8ff}
.gnav-logo-dot::before{width:3px;height:3px;border-radius:50%;left:6px;top:6px}
.gnav-logo-dot::after{width:1px;height:20px;left:7px;top:-3px;opacity:.55}
.gnav-logo-sep{color:#607087;font-weight:400;margin:0 1px}
.gnav-logo .gnav-product{font-family:var(--mono);font-size:11px;color:#9eabc0;font-weight:500;letter-spacing:.08em;text-transform:uppercase}
.gnav-links{display:flex;align-items:center;gap:4px;margin-left:auto}
.gnav-link{padding:7px 10px;color:#aab7c9;font-size:13px;font-weight:500;text-decoration:none}
.gnav-link:hover{color:#fff;text-decoration:none}
.gnav-actions{display:flex;align-items:center;gap:8px}
.docs-search-trigger{display:inline-flex;align-items:center;gap:9px;height:32px;min-width:178px;padding:0 9px 0 11px;border:1px solid rgba(255,255,255,.16);border-radius:5px;background:rgba(255,255,255,.055);color:#b9c5d6;font:500 12px var(--body);cursor:pointer;text-align:left}
.docs-search-trigger:hover{border-color:rgba(151,190,255,.7);background:rgba(255,255,255,.09)}
.docs-search-trigger kbd{margin-left:auto;padding:1px 5px;border:1px solid rgba(255,255,255,.15);border-radius:3px;color:#8392a8;font:10px var(--mono)}
.theme-toggle{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:1px solid rgba(255,255,255,.16);border-radius:5px;background:transparent;color:#cbd6e4;cursor:pointer}
.theme-toggle:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.32)}
.theme-toggle svg{width:15px;height:15px}.theme-toggle .moon{display:none}
.gnav-cta{display:inline-flex;align-items:center;height:32px;padding:0 12px;border-radius:5px;background:#edf4ff;color:#10203a;font-size:12px;font-weight:700;text-decoration:none}
.gnav-cta:hover{background:#fff;text-decoration:none}

/* ── The reading room ── */
.docs-wrap{display:grid;grid-template-columns:272px minmax(0,1fr) 216px;min-height:calc(100vh - 58px)}
.sidebar{position:sticky;top:58px;height:calc(100vh - 58px);overflow-y:auto;padding:28px 14px 56px;background:var(--graphite);border-right:1px solid rgba(255,255,255,.09)}
.sidebar::before{content:'Documentation index';display:block;padding:0 11px 18px;color:#6fa8ff;font:600 10px var(--mono);letter-spacing:.13em;text-transform:uppercase}
.sidebar::-webkit-scrollbar{width:7px}.sidebar::-webkit-scrollbar-thumb{background:#334154;border:2px solid var(--graphite);border-radius:8px}
.sidebar-section{padding:0 0 20px;margin-bottom:19px;border-bottom:1px solid rgba(255,255,255,.08)}
.sidebar-section:last-child{border-bottom:0}
.sidebar-heading{padding:0 11px 6px;color:#8291a8;font:600 10px var(--mono);letter-spacing:.11em;text-transform:uppercase}
.sidebar-links{display:flex;flex-direction:column;gap:1px}
.sidebar-link{position:relative;display:block;padding:6px 11px;border-radius:4px;color:#b7c3d3;font-size:13px;font-weight:450;line-height:1.35;text-decoration:none;transition:background .14s,color .14s}
.sidebar-link:hover{background:rgba(255,255,255,.07);color:#fff;text-decoration:none}
.sidebar-link.active{background:#223553;color:#fff;font-weight:600}
.sidebar-link.active::before{content:'';position:absolute;left:0;top:8px;bottom:8px;width:2px;border-radius:2px;background:#75aaff}

.doc-center{min-width:0;background:var(--paper);background-image:linear-gradient(90deg,rgba(21,32,51,.022) 1px,transparent 1px);background-size:32px 32px}
.doc-content{width:min(100%,812px);min-height:calc(100vh - 58px);margin:0 auto;padding:58px 58px 68px;background:rgba(255,254,250,.94);border-left:1px solid rgba(222,219,211,.48);border-right:1px solid rgba(222,219,211,.48)}
.on-page{padding:56px 18px 48px;background:var(--paper)}
.on-page-sticky{position:sticky;top:84px}
.on-page-heading{padding-bottom:10px;border-bottom:1px solid var(--line);color:var(--ink-faint);font:600 10px var(--mono);letter-spacing:.1em;text-transform:uppercase}
.on-page-links{display:flex;flex-direction:column;padding-top:10px}
.on-page-link{padding:4px 0;color:var(--ink-faint);font-size:12px;line-height:1.45;text-decoration:none}
.on-page-link:hover{color:var(--signal-strong);text-decoration:none}

/* ── Document type ── */
.breadcrumb{display:flex;align-items:center;gap:7px;margin-bottom:26px;color:var(--ink-faint);font:500 11px var(--mono);letter-spacing:.02em}
.breadcrumb a{color:var(--ink-soft);text-decoration:none}.breadcrumb a:hover{color:var(--signal-strong)}
.breadcrumb-sep{color:#b1aea7}
.doc-home-masthead{position:relative;margin:-12px -14px 52px;padding:27px 14px 0;border-bottom:1px solid var(--line)}
.doc-home-masthead .breadcrumb{margin-bottom:19px}.doc-kicker{display:flex;align-items:center;gap:8px;margin-bottom:15px;color:var(--signal-strong);font:700 10px var(--mono);letter-spacing:.12em;text-transform:uppercase}.doc-kicker::before{content:'';width:21px;height:1px;background:currentColor}.doc-home-masthead .page-sub{margin-bottom:28px}.doc-home-index{display:flex;flex-wrap:wrap;gap:8px 18px;padding:11px 0;border-top:1px solid var(--line);color:var(--ink-faint);font:600 10px var(--mono);letter-spacing:.07em;text-transform:uppercase}.doc-home-index span{display:inline-flex;align-items:center;gap:7px}.doc-home-index span::before{content:'·';color:var(--signal);font-size:15px;line-height:0}
.page-title{max-width:720px;margin-bottom:13px;color:var(--ink);font-family:var(--display);font-size:clamp(38px,5vw,56px);font-weight:500;letter-spacing:-.052em;line-height:.98}
.page-sub{max-width:630px;margin-bottom:48px;color:var(--ink-soft);font-size:18px;line-height:1.6;letter-spacing:-.018em}
h2{margin:58px 0 16px;padding-top:35px;border-top:1px solid var(--line);color:var(--ink);font-family:var(--display);font-size:29px;font-weight:500;letter-spacing:-.038em;line-height:1.1;scroll-margin-top:82px}
h2.first{margin-top:0;padding-top:0;border-top:0}
h3{margin:26px 0 8px;color:var(--ink);font-size:16px;font-weight:700;letter-spacing:-.014em;line-height:1.35;scroll-margin-top:82px}
p{margin-bottom:17px;color:#3e4c5e;font-size:16px;line-height:1.72;letter-spacing:-.006em}
ul,ol{margin:0 0 18px;padding-left:22px;color:#3e4c5e}li{margin-bottom:7px;padding-left:3px;font-size:16px;line-height:1.65}li::marker{color:var(--signal)}
code{padding:2px 5px;border:1px solid #d8dce4;border-radius:3px;background:#f0f3f7;color:#243a55;font:500 .82em var(--mono)}

/* ── Graphite code and response workspaces ── */
.code-block,.response{margin:21px 0;border:1px solid #2a3a50;border-radius:7px;background:var(--graphite);box-shadow:0 12px 25px rgba(15,24,37,.12);overflow:hidden}
.code-bar,.response-header{display:flex;align-items:center;min-height:38px;padding:0 13px;border-bottom:1px solid rgba(193,216,247,.12);background:var(--graphite-2);font-size:11px}
.code-bar::before{content:'';width:7px;height:7px;margin-right:9px;border-radius:50%;background:#6fa8ff;box-shadow:12px 0 0 #d4a35a,24px 0 0 #65748a}
.code-lang{margin-left:25px;color:#a7c6f6;font:600 10px var(--mono);letter-spacing:.11em;text-transform:uppercase}
.code-file{margin-left:auto;color:#7f91aa;font:500 11px var(--mono)}
.code-copy{order:4;margin-left:12px;padding:3px 7px;border:1px solid rgba(193,216,247,.2);border-radius:3px;background:transparent;color:#b7cae5;font:600 10px var(--body);cursor:pointer}
.code-copy:hover{border-color:#79acfb;color:#fff}
.code-body,.response-body{padding:18px 20px;overflow-x:auto;color:var(--code-ink);font:13px/1.8 var(--mono);white-space:pre}
.kw{color:#81b5ff}.str{color:#9ed3a5}.fn{color:#e3b576}.prop{color:#91d2d1}.cm{color:#8291a8}.num{color:#e6a5bf}
.response{border-color:#cfd7e2;background:#fbfcfe;box-shadow:none}
.response-header{min-height:34px;background:#f1f5fa;border-bottom-color:#d9e0e9}
.response-header::before{content:'↳';margin-right:7px;color:#5a7190;font:600 14px var(--mono)}
.response-label{color:#66778c;font:600 10px var(--mono);letter-spacing:.08em;text-transform:uppercase}
.status-ok,.status-err{font:700 11px var(--mono)}.status-ok{color:var(--green)}.status-err{color:var(--red)}
.response-body{color:#33485f;font-size:12px;line-height:1.7}

/* ── Notes, navigation cards, and procedures ── */
.callout{display:grid;grid-template-columns:auto minmax(0,1fr);gap:13px;margin:24px 0;padding:15px 17px;border:1px solid;border-radius:5px}
.callout-info{border-color:#bed2f4;background:var(--signal-wash)}.callout-tip{border-color:#b8dec7;background:var(--green-wash)}.callout-warn{border-color:#ecd09c;background:var(--amber-wash)}
.callout-tag{padding-top:2px;font:700 10px var(--mono);letter-spacing:.09em;text-transform:uppercase;white-space:nowrap}.callout-info .callout-tag{color:var(--signal-strong)}.callout-tip .callout-tag{color:var(--green)}.callout-warn .callout-tag{color:var(--amber)}
.callout-body{color:#3e4c5e;font-size:14px;line-height:1.6}.callout-body strong{color:var(--ink)}
.card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:21px 0}
.card{position:relative;display:block;min-height:132px;padding:20px 19px 18px;border:1px solid var(--line);border-radius:5px;background:var(--paper-raised);color:inherit;text-decoration:none;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
.card::before{content:'↗';position:absolute;right:16px;top:14px;color:#a2abb5;font:16px var(--mono);transition:color .16s,transform .16s}
.card:hover{transform:translateY(-2px);border-color:#90b8f3;box-shadow:0 10px 22px rgba(38,65,100,.1);text-decoration:none}.card:hover::before{color:var(--signal);transform:translate(2px,-2px)}
.card h3{margin:0 24px 6px 0;color:var(--ink);font-size:15px}.card p{margin:0;color:var(--ink-soft);font-size:13px;line-height:1.55}
.steps{position:relative;margin:22px 0;border-left:1px solid #bfcbda}
.step{position:relative;display:flex;gap:16px;padding:0 0 24px 21px}.step:last-child{padding-bottom:0}
.step-num{position:absolute;left:-10px;top:0;display:flex;align-items:center;justify-content:center;width:20px;height:20px;border:1px solid #84ade5;border-radius:50%;background:var(--paper-raised);color:var(--signal-strong);font:700 10px var(--mono)}
.step-body h3{margin:0 0 4px;font-size:15px}.step-body p{margin:0;font-size:14px;line-height:1.62}.step code[style]{background:#f0f3f7!important;border-color:#d8dce4!important;color:#243a55!important}

/* ── API reference uses a restrained specimen-sheet treatment. ── */
.endpoint{margin:24px 0;border:1px solid var(--line-strong);border-radius:6px;background:var(--paper-raised);overflow:hidden}
.endpoint-header{display:flex;align-items:center;gap:10px;min-height:54px;padding:0 17px;border-bottom:1px solid var(--line);background:#f4f3ef}
.method{padding:3px 6px;border-radius:3px;font:700 10px var(--mono);letter-spacing:.08em}.method-post{background:#e8f0ff;color:#155bbf}.method-get{background:#e2f4e9;color:#166740}.method-delete{background:#fbe5e4;color:#a93837}
.endpoint-path{color:var(--ink);font:600 14px var(--mono)}
.endpoint-desc{padding:15px 18px;border-bottom:1px solid var(--line);color:var(--ink-soft);font-size:14px;line-height:1.62}
.endpoint-section{padding:17px 18px;overflow-x:auto}.endpoint-section+.endpoint-section{border-top:1px solid var(--line)}
.endpoint-section-label{margin-bottom:10px;color:var(--ink-faint);font:700 10px var(--mono);letter-spacing:.1em;text-transform:uppercase}
.param-table{width:100%;min-width:530px;border-collapse:collapse;font-size:13px}.param-table th{padding:8px 10px;border-bottom:1px solid var(--line-strong);background:#f5f4f0;color:#687587;font:700 10px var(--mono);letter-spacing:.06em;text-align:left;text-transform:uppercase}.param-table td{padding:10px;border-bottom:1px solid #ebe9e3;color:var(--ink-soft);vertical-align:top;line-height:1.55}.param-table tr:last-child td{border-bottom:0}
.param-name{color:#26466d;font:600 12px var(--mono)}.param-type{color:#7656a6;font:500 12px var(--mono)}.param-req,.param-opt{padding:2px 5px;border-radius:3px;font:700 9px var(--mono);letter-spacing:.04em;text-transform:uppercase}.param-req{background:var(--red-wash);color:var(--red)}.param-opt{background:#edf0f3;color:#708094}.param-desc{color:var(--ink-soft)}

/* ── Footer + small screens ── */
.doc-footer{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:70px;padding-top:22px;border-top:1px solid var(--line);color:var(--ink-faint);font-size:12px;line-height:1.5}.doc-footer a{color:var(--ink-soft);text-decoration:none}.doc-footer a:hover{color:var(--signal-strong)}.doc-footer-links{display:flex;gap:16px}
.mobile-nav{display:none;margin-bottom:25px;border:1px solid var(--line-strong);border-radius:5px;background:var(--paper-raised)}.mobile-nav summary{display:flex;align-items:center;justify-content:space-between;padding:12px 13px;color:var(--ink);font-size:13px;font-weight:700;cursor:pointer;list-style:none}.mobile-nav summary::after{content:'+';color:var(--signal);font:18px var(--mono)}.mobile-nav[open] summary::after{content:'−'}.mobile-nav nav{padding:6px 5px 10px;border-top:1px solid var(--line)}.mobile-nav .sidebar-section{margin:0;padding:10px 0;border:0}.mobile-nav .sidebar-heading{color:var(--ink-faint)}.mobile-nav .sidebar-link{color:var(--ink-soft)}.mobile-nav .sidebar-link.active{background:var(--signal-wash);color:var(--signal-strong)}.mobile-nav .sidebar-link.active::before{background:var(--signal)}

/* ── Command search ── */
.docs-search{position:fixed;inset:0;z-index:500;display:none;align-items:flex-start;justify-content:center;padding:11vh 16px;background:rgba(10,16,25,.58);backdrop-filter:blur(4px)}.docs-search.is-open{display:flex}.docs-search-panel{width:min(100%,620px);overflow:hidden;border:1px solid #34465d;border-radius:8px;background:#fdfcf8;box-shadow:0 25px 70px rgba(0,0,0,.35)}.docs-search-input-row{display:flex;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid var(--line);color:#718095}.docs-search-input-row svg{flex:0 0 auto}.docs-search-input{width:100%;border:0;background:transparent;color:var(--ink);font:16px var(--body)}.docs-search-input:focus{outline:0}.docs-search-input::placeholder{color:#95a0ad}.docs-search-close{border:0;background:transparent;color:var(--ink-faint);font:11px var(--mono);cursor:pointer}.docs-search-results{max-height:min(56vh,480px);overflow-y:auto;padding:8px}.docs-search-item{display:block;padding:10px 11px;border-radius:4px;color:var(--ink);text-decoration:none}.docs-search-item:hover{background:var(--signal-wash);text-decoration:none}.docs-search-section{display:block;margin-bottom:2px;color:var(--ink-faint);font:600 10px var(--mono);letter-spacing:.08em;text-transform:uppercase}.docs-search-title{font-size:14px;font-weight:650}.docs-search-empty{padding:22px 12px;color:var(--ink-faint);font-size:13px}.docs-search-footer{display:flex;justify-content:space-between;padding:8px 15px;border-top:1px solid var(--line);color:var(--ink-faint);font:10px var(--mono)}

/* ── Dark theme: a night research terminal, not a colour inversion. ── */
[data-theme="light"] body{background:var(--paper);color:var(--ink)}
[data-theme="light"] .theme-toggle .moon{display:block}[data-theme="light"] .theme-toggle .sun{display:none}
[data-theme="light"] .gnav{background:rgba(16,23,34,.96)}

/* The no-attribute theme is deliberately dense and low-glare for long sessions. */
html:not([data-theme="light"]) body{background:#0e1520;color:#e4eaf3}
html:not([data-theme="light"]) .doc-center,html:not([data-theme="light"]) .on-page{background:#121b28;background-image:none}
html:not([data-theme="light"]) .doc-content{background:#121b28;border-color:#253247}
html:not([data-theme="light"]) .page-title,html:not([data-theme="light"]) h2,html:not([data-theme="light"]) h3,html:not([data-theme="light"]) strong{color:#eef4fb}
html:not([data-theme="light"]) p,html:not([data-theme="light"]) ul,html:not([data-theme="light"]) ol,html:not([data-theme="light"]) .callout-body{color:#bac6d6}
html:not([data-theme="light"]) .breadcrumb a,html:not([data-theme="light"]) .doc-footer a{color:#9eb0c8}
html:not([data-theme="light"]) h2,html:not([data-theme="light"]) .doc-footer,html:not([data-theme="light"]) .on-page-heading{border-color:#29374b}
html:not([data-theme="light"]) .sidebar{background:#0c121b}html:not([data-theme="light"]) .card,html:not([data-theme="light"]) .endpoint,html:not([data-theme="light"]) .mobile-nav{background:#172131;border-color:#344156}
html:not([data-theme="light"]) .card h3,html:not([data-theme="light"]) .endpoint-path{color:#eef4fb}html:not([data-theme="light"]) .card p,html:not([data-theme="light"]) .endpoint-desc,html:not([data-theme="light"]) .param-desc{color:#aebdce}
html:not([data-theme="light"]) .endpoint-header,html:not([data-theme="light"]) .param-table th{background:#1c293a;border-color:#344156}html:not([data-theme="light"]) .endpoint-section,html:not([data-theme="light"]) .endpoint-desc,html:not([data-theme="light"]) .endpoint-header{border-color:#344156}html:not([data-theme="light"]) .param-table td{border-color:#2d3c50;color:#b5c1d1}
html:not([data-theme="light"]) code,html:not([data-theme="light"]) .step code[style]{background:#1c2a3c!important;border-color:#344a68!important;color:#cbe0ff!important}
html:not([data-theme="light"]) .response{border-color:#344156;background:#172131}html:not([data-theme="light"]) .response-header{background:#1c293a;border-color:#344156}html:not([data-theme="light"]) .response-body{color:#c7d6e8}
html:not([data-theme="light"]) .callout-info{background:#182c49;border-color:#345c91}html:not([data-theme="light"]) .callout-tip{background:#143425;border-color:#2d7550}html:not([data-theme="light"]) .callout-warn{background:#3b2c16;border-color:#805e25}html:not([data-theme="light"]) .mobile-nav summary{color:#e6edf6}
html:not([data-theme="light"]) .on-page-link{color:#8294ab}html:not([data-theme="light"]) .on-page-link:hover{color:#8bb8ff}
html:not([data-theme="light"]) .doc-home-masthead{border-color:#29374b}html:not([data-theme="light"]) .doc-home-index{border-color:#29374b}

@media(max-width:1180px){.docs-wrap{grid-template-columns:250px minmax(0,1fr)}.on-page{display:none}.doc-content{max-width:800px}}
@media(max-width:820px){.gnav{height:54px;padding:0 16px}.gnav-links{display:none}.docs-search-trigger{min-width:0;width:32px;padding:0;justify-content:center}.docs-search-trigger span,.docs-search-trigger kbd{display:none}.docs-wrap{display:block;min-height:calc(100vh - 54px)}.sidebar{display:none}.doc-content{min-height:calc(100vh - 54px);padding:31px 22px 52px;border:0}.mobile-nav{display:block}.page-title{font-size:40px}.page-sub{margin-bottom:35px;font-size:16px}h2{margin-top:45px;padding-top:28px;font-size:27px}.card-grid{grid-template-columns:1fr}.doc-footer{flex-direction:column;align-items:flex-start;margin-top:52px}.code-body,.response-body{padding:15px;font-size:12px}.endpoint-section{padding:15px}.docs-search{padding-top:72px}.gnav-cta{display:none}}
@media(max-width:480px){.gnav-logo .gnav-product{display:none}.gnav-actions{gap:6px}.theme-toggle{display:none}.page-title{font-size:36px}.doc-content{padding-left:17px;padding-right:17px}.callout{gap:8px;padding:13px}.callout-tag{font-size:9px}.code-file{display:none}.code-lang{margin-left:25px}.code-copy{margin-left:auto}.doc-footer-links{gap:12px;flex-wrap:wrap}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.skip-link,.sidebar-link,.card,.card::before{transition:none}}
`;

// ─── Components ───────────────────────────────────────────────────────────────

function GlobalNav() {
  return (
    <nav class="gnav">
      <div class="gnav-inner">
        <a href="/" class="gnav-logo">
          <div class="gnav-logo-dot" />
          Anansi<span class="gnav-logo-sep">/</span><span class="gnav-product">docs</span>
        </a>
        <div class="gnav-links">
          <a href="/docs" class="gnav-link">Overview</a>
          <a href="/docs/quickstart" class="gnav-link">Quickstart</a>
          <a href="/docs/api-reference" class="gnav-link">API Reference</a>
          <a href="/" class="gnav-link">← Site</a>
        </div>
        <div class="gnav-actions">
          <button type="button" class="docs-search-trigger" data-docs-search-open aria-haspopup="dialog" aria-controls="docs-search">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.25"/><path d="m10.3 10.3 3.2 3.2" stroke-linecap="round"/></svg>
            <span>Search docs</span><kbd>⌘ K</kbd>
          </button>
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

const themeScript = `
(function(){
  var root = document.documentElement;
  var stored = localStorage.getItem('anansi-docs-theme');
  if (stored === 'dark') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', 'light');

  function attach(){
    var toggle = document.getElementById('theme-toggle');
    function syncTheme(){
      if (!toggle) return;
      var isLight = root.getAttribute('data-theme') === 'light';
      toggle.setAttribute('aria-pressed', String(isLight));
      toggle.setAttribute('aria-label', isLight ? 'Switch to dark theme' : 'Switch to light theme');
    }
    if (toggle) toggle.addEventListener('click', function(){
      if (root.getAttribute('data-theme') === 'light') {
        root.removeAttribute('data-theme');
        localStorage.setItem('anansi-docs-theme', 'dark');
      } else {
        root.setAttribute('data-theme', 'light');
        localStorage.setItem('anansi-docs-theme', 'light');
      }
      syncTheme();
    });
    syncTheme();

    document.querySelectorAll('[data-copy-code]').forEach(function(button){
      button.addEventListener('click', function(){
        var container = button.closest('.code-block, .response');
        var source = container && container.querySelector('.code-body, .response-body');
        if (!source || !navigator.clipboard) return;
        navigator.clipboard.writeText(source.textContent.trim()).then(function(){
          var initial = button.textContent;
          button.textContent = 'Copied';
          setTimeout(function(){ button.textContent = initial; }, 1400);
        });
      });
    });

    var dialog = document.getElementById('docs-search');
    var input = dialog && dialog.querySelector('[data-docs-search-input]');
    var empty = dialog && dialog.querySelector('[data-docs-search-empty]');
    var items = dialog ? Array.prototype.slice.call(dialog.querySelectorAll('[data-docs-search-item]')) : [];
    var priorFocus = null;
    function closeSearch(){
      if (!dialog) return;
      dialog.classList.remove('is-open');
      document.body.style.overflow = '';
      if (priorFocus) priorFocus.focus();
    }
    function filterSearch(){
      if (!input) return;
      var query = input.value.trim().toLowerCase();
      var visible = 0;
      items.forEach(function(item){
        var show = !query || item.getAttribute('data-search').toLowerCase().indexOf(query) !== -1;
        item.hidden = !show;
        if (show) visible++;
      });
      if (empty) empty.hidden = visible !== 0;
    }
    document.querySelectorAll('[data-docs-search-open]').forEach(function(button){
      button.addEventListener('click', function(){
        if (!dialog || !input) return;
        priorFocus = document.activeElement;
        dialog.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        input.value = '';
        filterSearch();
        input.focus();
      });
    });
    if (input) input.addEventListener('input', filterSearch);
    if (dialog) {
      dialog.addEventListener('click', function(event){ if (event.target === dialog) closeSearch(); });
      var close = dialog.querySelector('[data-docs-search-close]');
      if (close) close.addEventListener('click', closeSearch);
    }
    document.addEventListener('keydown', function(event){
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        var open = document.querySelector('[data-docs-search-open]');
        if (open) open.click();
      } else if (event.key === 'Escape' && dialog && dialog.classList.contains('is-open')) {
        closeSearch();
      } else if (event.key === 'Enter' && dialog && dialog.classList.contains('is-open') && document.activeElement === input) {
        var first = items.find(function(item){ return !item.hidden; });
        if (first) first.click();
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})();
`;

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

function DocsSearch() {
  return (
    <div class="docs-search" id="docs-search" role="dialog" aria-modal="true" aria-label="Search documentation">
      <div class="docs-search-panel">
        <div class="docs-search-input-row">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.25"/><path d="m10.3 10.3 3.2 3.2" stroke-linecap="round"/></svg>
          <input class="docs-search-input" type="search" autocomplete="off" placeholder="Search guides and API reference" aria-label="Search documentation" data-docs-search-input />
          <button type="button" class="docs-search-close" data-docs-search-close>ESC</button>
        </div>
        <div class="docs-search-results" data-docs-search-results>
          {DOCS_NAV.map((section) => section.links.map((link) => (
            <a href={link.href} class="docs-search-item" data-docs-search-item data-search={section.section + " " + link.label}>
              <span class="docs-search-section">{section.section}</span>
              <span class="docs-search-title">{link.label}</span>
            </a>
          )))}
          <div class="docs-search-empty" data-docs-search-empty hidden>Nothing in the documentation index matches that search.</div>
        </div>
        <div class="docs-search-footer"><span>Documentation index</span><span>Enter to open</span></div>
      </div>
    </div>
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
    <html lang="en" data-theme="light">
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
        <DocsSearch />
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
