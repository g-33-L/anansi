// Shared design system for all server-rendered product surfaces:
// portal, Slack dashboard, onboarding, memory view, billing pages.
//
// Landing (landing.tsx) and docs (docs.tsx) are marketing/reading surfaces with
// bespoke treatments; they share the same palette values but keep their own CSS.
//
// Everything here is exported as plain strings so it works both from hono/jsx
// (<style>{TOKENS_CSS + BASE_CSS}</style>) and from template-string pages.

/**
 * Semantic design tokens for the server-rendered product surfaces. Field paper
 * is the default reading environment; adding data-theme="dark" creates the
 * graphite analysis environment. Muted text colors are chosen to keep WCAG AA
 * contrast (≥4.5:1) against --bg and --surface.
 */
export const TOKENS_CSS = `
:root{
  --bg:#f6f5f0;
  --surface:#ffffff;
  --surface-2:#edede7;
  --surface-raised:#ffffff;
  --border:#deded5;
  --border-strong:#c3c5c1;
  --text:#151b24;
  --text-secondary:#43505d;
  --text-muted:#667085;
  --brand:#315ef4;
  --brand-hover:#2449cf;
  --brand-contrast:#ffffff;
  --brand-soft:#e8edff;
  --ok:#237a5a;
  --ok-soft:#e7f4ed;
  --ok-border:#afdbc5;
  --warn:#9a5a08;
  --warn-soft:#fbf1db;
  --warn-border:#e7cc91;
  --danger:#b42318;
  --danger-soft:#fcebe9;
  --danger-border:#efb7b2;
  --radius-sm:4px;
  --radius-md:6px;
  --radius-lg:10px;
  --radius-pill:999px;
  --font-display:Iowan Old Style,'Palatino Linotype','Book Antiqua',Georgia,serif;
  --font-sans:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --font-mono:'JetBrains Mono','SF Mono',ui-monospace,Menlo,Monaco,Consolas,monospace;
  --focus-ring:0 0 0 3px rgba(49,94,244,.28);
  --shadow-card:0 1px 2px rgba(21,27,36,.04),0 8px 24px rgba(21,27,36,.035);
}
[data-theme="dark"]{
  --bg:#0f1622;
  --surface:#151e2b;
  --surface-2:#1c2838;
  --surface-raised:#202d3d;
  --border:#2b3a4d;
  --border-strong:#40526a;
  --text:#eef3f8;
  --text-secondary:#bec9d5;
  --text-muted:#8e9caf;
  --brand:#8ea8ff;
  --brand-hover:#b5c6ff;
  --brand-contrast:#101827;
  --brand-soft:#1b2c5a;
  --ok:#75cba2;
  --ok-soft:#123d31;
  --ok-border:#25634f;
  --warn:#f2c56a;
  --warn-soft:#4b3917;
  --warn-border:#775a22;
  --danger:#f4a49d;
  --danger-soft:#482323;
  --danger-border:#75423e;
  --focus-ring:0 0 0 3px rgba(142,168,255,.42);
  --shadow-card:0 1px 2px rgba(0,0,0,.24),0 14px 30px rgba(0,0,0,.14);
}
`;

/**
 * Base element + component styles shared by product surfaces.
 * Class names intentionally match the vocabulary already used across routes
 * (.btn, .card, .input, .badge, .alert, .empty) so migration is mechanical.
 */
export const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:var(--font-sans);background:var(--bg);color:var(--text);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;line-height:1.6}
a{color:var(--brand);text-decoration-thickness:1px;text-underline-offset:3px}
a:hover{color:var(--brand-hover)}
code{font-family:var(--font-mono);background:var(--surface-2);border:1px solid var(--border);padding:1px 5px;border-radius:3px;font-size:.84em;color:var(--text)}

/* Visible keyboard focus everywhere; mouse clicks stay clean via :focus-visible */
:focus{outline:none}
:focus-visible{outline:none;box-shadow:var(--focus-ring);border-radius:var(--radius-sm)}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid transparent;border-radius:var(--radius-md);font-family:var(--font-sans);font-size:.81rem;font-weight:650;letter-spacing:.01em;cursor:pointer;padding:9px 15px;transition:background .16s,border-color .16s,color .16s,transform .16s;line-height:1.2;text-decoration:none}
.btn:hover{text-decoration:none}
.btn:active{transform:translateY(1px)}
.btn-primary{background:var(--brand);color:var(--brand-contrast)}
.btn-primary:hover{background:var(--brand-hover)}
.btn-outline{background:var(--surface);color:var(--text-secondary);border-color:var(--border-strong)}
.btn-outline:hover{border-color:var(--brand);color:var(--brand);background:var(--brand-soft)}
.btn-danger{background:transparent;color:var(--danger);border:1px solid var(--danger-border)}
.btn-danger:hover{background:var(--danger-soft)}
.btn-sm{padding:6px 10px;font-size:.72rem;border-radius:var(--radius-sm)}

/* Cards */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:24px;margin-bottom:16px}
.card-sm{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);box-shadow:0 1px 1px rgba(21,27,36,.025);padding:16px;margin-bottom:12px}

/* Form elements */
.label{display:block;font-size:.82rem;font-weight:650;color:var(--text-secondary);margin-bottom:6px}
.label-caps{display:block;font-family:var(--font-mono);font-size:.66rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.input{width:100%;padding:10px 12px;background:var(--surface);border:1px solid var(--border-strong);border-radius:var(--radius-md);font-family:var(--font-sans);font-size:.9rem;color:var(--text);transition:border-color .15s,box-shadow .15s}
.input:focus-visible{border-color:var(--brand);box-shadow:var(--focus-ring)}
.input::placeholder{color:var(--text-muted)}

/* Badges */
.badge{display:inline-flex;align-items:center;padding:3px 7px;border:1px solid currentColor;border-radius:var(--radius-sm);font-family:var(--font-mono);font-size:.64rem;font-weight:650;letter-spacing:.04em;line-height:1.2;text-transform:uppercase}
.badge-neutral{background:var(--brand-soft);color:var(--text-secondary)}
.badge-brand{background:var(--brand-soft);color:var(--brand)}
.badge-ok{background:var(--ok-soft);color:var(--ok)}
.badge-warn{background:var(--warn-soft);color:var(--warn)}

/* Alerts */
.alert{padding:11px 13px;border-radius:var(--radius-md);font-size:.84rem;margin-bottom:16px;border:1px solid;line-height:1.5}
.alert-ok{background:var(--ok-soft);color:var(--ok);border-color:var(--ok-border)}
.alert-err{background:var(--danger-soft);color:var(--danger);border-color:var(--danger-border)}
.alert-warn{background:var(--warn-soft);color:var(--warn);border-color:var(--warn-border)}

/* Misc */
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.empty{color:var(--text-muted);font-size:.85rem;padding:12px 0}
.mono{font-family:var(--font-mono)}
.eyebrow{font-family:var(--font-mono);font-size:.66rem;font-weight:650;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)}
.reading-title{font-family:var(--font-display);font-weight:600;letter-spacing:-.035em}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (prefers-reduced-motion:reduce){html{scroll-behavior:auto}.btn{transition:none}}
`;

/**
 * Theme persistence + toggle wiring. Inject via dangerouslySetInnerHTML —
 * hono/jsx HTML-escapes plain text children, which corrupts inline JS.
 */
export const THEME_SCRIPT = `
(function(){
  var stored = localStorage.getItem('anansi-theme');
  if (stored === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  function attach(){
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    function sync(){
      btn.setAttribute('aria-pressed', document.documentElement.getAttribute('data-theme') === 'dark' ? 'true' : 'false');
    }
    btn.addEventListener('click', function(){
      if (document.documentElement.getAttribute('data-theme') === 'dark') {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('anansi-theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('anansi-theme', 'dark');
      }
      sync();
    });
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})();
`;

/** Sun/moon toggle button. Pair with THEME_SCRIPT and the .theme-toggle CSS below. */
export const THEME_TOGGLE_HTML = `
<button class="theme-toggle" id="theme-toggle" aria-label="Toggle light or dark theme" title="Toggle light/dark">
  <svg class="sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>
  <svg class="moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z"/></svg>
</button>`;

export const THEME_TOGGLE_CSS = `
.theme-toggle{background:var(--surface);border:1px solid var(--border-strong);color:var(--text);width:34px;height:34px;border-radius:var(--radius-md);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:border-color .15s,background .15s,transform .15s;flex-shrink:0}
.theme-toggle:hover{border-color:var(--border-strong);background:var(--brand-soft)}
.theme-toggle:active{transform:translateY(1px)}
.theme-toggle svg{width:15px;height:15px}
.theme-toggle .sun{display:none}
[data-theme="dark"] .theme-toggle .moon{display:none}
[data-theme="dark"] .theme-toggle .sun{display:block}
`;

/**
 * Copy-to-clipboard wiring for buttons with data-copy-target="#selector".
 * Falls back silently when the Clipboard API is unavailable (non-HTTPS).
 * Inject via dangerouslySetInnerHTML.
 */
export const COPY_SCRIPT = `
(function(){
  function attach(){
    document.querySelectorAll('[data-copy-target]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var el = document.querySelector(btn.getAttribute('data-copy-target'));
        if (!el || !navigator.clipboard) return;
        navigator.clipboard.writeText(el.textContent.trim()).then(function(){
          var prev = btn.textContent;
          btn.textContent = 'Copied ✓';
          btn.setAttribute('aria-live', 'polite');
          setTimeout(function(){ btn.textContent = prev; }, 1600);
        });
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach);
  else attach();
})();
`;

/**
 * Prefix a rendered JSX tree with the HTML5 doctype. hono/jsx omits it,
 * which puts browsers in quirks mode. Only for synchronous component trees.
 */
export function withDoctype(el: { toString(): string | Promise<string> }): string {
  const html = el.toString();
  if (typeof html !== "string") {
    throw new Error("withDoctype: async components are not supported");
  }
  return "<!DOCTYPE html>" + html;
}

/** Escape a string for interpolation into HTML text or attribute values. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
