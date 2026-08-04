// Shared design system for all server-rendered product surfaces:
// portal, Slack dashboard, onboarding, memory view, billing pages.
//
// Landing (landing.tsx) and docs (docs.tsx) are marketing/reading surfaces with
// bespoke treatments; they share the same palette values but keep their own CSS.
//
// Everything here is exported as plain strings so it works both from hono/jsx
// (<style>{TOKENS_CSS + BASE_CSS}</style>) and from template-string pages.

/**
 * Semantic design tokens. Dark is the default; adding data-theme="light" on
 * <html> flips every tokenized surface. Muted text colors are chosen to keep
 * WCAG AA contrast (≥4.5:1) against --bg and --surface.
 */
export const TOKENS_CSS = `
:root{
  --bg:#1a1a1c;
  --surface:#232326;
  --surface-2:#2a2a2e;
  --border:rgba(255,255,255,.08);
  --border-strong:rgba(255,255,255,.16);
  --text:#f5f5f7;
  --text-secondary:#a1a1a6;
  --text-muted:#8e8e93;
  --brand:#c0c0c0;
  --brand-hover:#e8e8e8;
  --brand-contrast:#0e1116;
  --brand-soft:rgba(232,232,232,.12);
  --ok:#30d158;
  --ok-soft:rgba(48,209,88,.1);
  --ok-border:rgba(48,209,88,.2);
  --warn:#ffd60a;
  --warn-soft:rgba(255,214,10,.08);
  --warn-border:rgba(255,214,10,.2);
  --danger:#ff453a;
  --danger-soft:rgba(255,69,58,.1);
  --danger-border:rgba(255,69,58,.3);
  --radius-sm:6px;
  --radius-md:8px;
  --radius-lg:12px;
  --radius-pill:99px;
  --font-sans:-apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text',Inter,'Helvetica Neue',Helvetica,Arial,sans-serif;
  --font-mono:'SF Mono','Fira Code',Menlo,Monaco,'Courier New',monospace;
  --focus-ring:0 0 0 2px var(--bg),0 0 0 4px rgba(192,192,192,.65);
}
[data-theme="light"]{
  --bg:#ffffff;
  --surface:#f5f5f7;
  --surface-2:#ebebee;
  --border:rgba(0,0,0,.1);
  --border-strong:rgba(0,0,0,.2);
  --text:#1d1d1f;
  --text-secondary:#48484a;
  --text-muted:#636366;
  --brand:#1d1d1f;
  --brand-hover:#000000;
  --brand-contrast:#ffffff;
  --brand-soft:rgba(0,0,0,.06);
  --ok:#248a3d;
  --ok-soft:rgba(36,138,61,.08);
  --ok-border:rgba(36,138,61,.25);
  --warn:#b25000;
  --warn-soft:rgba(178,80,0,.08);
  --warn-border:rgba(178,80,0,.25);
  --danger:#d70015;
  --danger-soft:rgba(215,0,21,.06);
  --danger-border:rgba(215,0,21,.3);
  --focus-ring:0 0 0 2px var(--bg),0 0 0 4px rgba(29,29,31,.55);
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
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline;text-underline-offset:3px}
code{font-family:var(--font-mono);background:var(--surface-2);border:1px solid var(--border);padding:1px 5px;border-radius:4px;font-size:.85em;color:var(--text)}

/* Visible keyboard focus everywhere; mouse clicks stay clean via :focus-visible */
:focus{outline:none}
:focus-visible{outline:none;box-shadow:var(--focus-ring);border-radius:var(--radius-sm)}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:none;border-radius:var(--radius-md);font-family:var(--font-sans);font-size:.85rem;font-weight:500;cursor:pointer;padding:8px 18px;transition:background .15s,border-color .15s,color .15s;text-decoration:none}
.btn:hover{text-decoration:none}
.btn-primary{background:var(--brand);color:var(--brand-contrast)}
.btn-primary:hover{background:var(--brand-hover)}
.btn-outline{background:transparent;color:var(--text-secondary);border:1px solid var(--border-strong)}
.btn-outline:hover{border-color:var(--border-strong);color:var(--text)}
.btn-danger{background:transparent;color:var(--danger);border:1px solid var(--danger-border)}
.btn-danger:hover{background:var(--danger-soft)}
.btn-sm{padding:6px 14px;font-size:.78rem;border-radius:var(--radius-sm)}

/* Cards */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px;margin-bottom:16px}
.card-sm{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md);padding:16px;margin-bottom:12px}

/* Form elements */
.label{display:block;font-size:.82rem;font-weight:600;color:var(--text-secondary);margin-bottom:6px}
.label-caps{display:block;font-size:.7rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.input{width:100%;padding:10px 14px;background:var(--surface-2);border:1px solid var(--border-strong);border-radius:var(--radius-md);font-family:var(--font-sans);font-size:.9rem;color:var(--text);transition:border-color .15s}
.input:focus-visible{border-color:var(--brand);box-shadow:none}
.input::placeholder{color:var(--text-muted)}

/* Badges */
.badge{display:inline-block;padding:2px 10px;border-radius:var(--radius-pill);font-size:.72rem;font-weight:600}
.badge-neutral{background:var(--brand-soft);color:var(--text-secondary)}
.badge-brand{background:var(--brand-soft);color:var(--brand)}
.badge-ok{background:var(--ok-soft);color:var(--ok)}
.badge-warn{background:var(--warn-soft);color:var(--warn)}

/* Alerts */
.alert{padding:12px 16px;border-radius:var(--radius-md);font-size:.85rem;margin-bottom:16px;border:1px solid}
.alert-ok{background:var(--ok-soft);color:var(--ok);border-color:var(--ok-border)}
.alert-err{background:var(--danger-soft);color:var(--danger);border-color:var(--danger-border)}
.alert-warn{background:var(--warn-soft);color:var(--warn);border-color:var(--warn-border)}

/* Misc */
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.empty{color:var(--text-muted);font-size:.85rem;padding:12px 0}
.mono{font-family:var(--font-mono)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
`;

/**
 * Theme persistence + toggle wiring. Inject via dangerouslySetInnerHTML —
 * hono/jsx HTML-escapes plain text children, which corrupts inline JS.
 */
export const THEME_SCRIPT = `
(function(){
  var stored = localStorage.getItem('anansi-theme');
  if (stored === 'light') document.documentElement.setAttribute('data-theme', 'light');
  function attach(){
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    function sync(){
      btn.setAttribute('aria-pressed', document.documentElement.getAttribute('data-theme') === 'light' ? 'true' : 'false');
    }
    btn.addEventListener('click', function(){
      if (document.documentElement.getAttribute('data-theme') === 'light') {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('anansi-theme', 'dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('anansi-theme', 'light');
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
.theme-toggle{background:transparent;border:1px solid var(--border-strong);color:var(--text);width:32px;height:32px;border-radius:var(--radius-md);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:border-color .15s,background .15s;flex-shrink:0}
.theme-toggle:hover{border-color:var(--border-strong);background:var(--brand-soft)}
.theme-toggle svg{width:15px;height:15px}
.theme-toggle .moon{display:none}
[data-theme="light"] .theme-toggle .moon{display:block}
[data-theme="light"] .theme-toggle .sun{display:none}
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
