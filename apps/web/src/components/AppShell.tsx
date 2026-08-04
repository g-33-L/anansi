/*
 * Authenticated app chrome: sidebar (grouped nav) + top bar (org switcher, ⌘K,
 * theme, user menu) + routed <Outlet/>. See NAVIGATION.md §2.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button, CommandPalette, cn, useTheme, type CommandAction } from "@anansi/ui";
import { useSession } from "../lib/session.js";
import { consoleApi } from "../lib/api.js";
import { NAV, NAV_GROUPS } from "../lib/nav.js";

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="lab-brand-mark" aria-hidden="true">
      <svg width={compact ? "15" : "16"} height={compact ? "15" : "16"} viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="3.3" stroke="currentColor" strokeWidth="1.25" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function NavGlyph({ label }: { label: string }) {
  const shared = { fill: "none", stroke: "currentColor", strokeLinecap: "round" as const, strokeLinejoin: "round" as const, strokeWidth: 1.6 };
  const paths: Record<string, ReactNode> = {
    Overview: <><rect x="3" y="3" width="10" height="10" rx="2" {...shared} /><path d="M5.5 8h5M8 5.5v5" {...shared} /></>,
    Search: <><circle cx="7" cy="7" r="3.8" {...shared} /><path d="m10 10 3 3" {...shared} /></>,
    Chat: <><path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h5A2.5 2.5 0 0 1 13 4.5v4A2.5 2.5 0 0 1 10.5 11H7l-3 3v-3.4A2.5 2.5 0 0 1 3 8.5z" {...shared} /></>,
    Memory: <><path d="M8 2.3a5.7 5.7 0 1 0 0 11.4A5.7 5.7 0 0 0 8 2.3Z" {...shared} /><path d="M5.8 8.3c.6-1.8 3.8-1.8 4.4 0M6.3 5.9h.01M9.7 5.9h.01" {...shared} /></>,
    Timeline: <><path d="M3 3v10M3 8h3l2-3 2 5 3-3" {...shared} /><circle cx="3" cy="3" r="1" fill="currentColor" /></>,
    Graph: <><circle cx="4" cy="8" r="1.5" {...shared} /><circle cx="12" cy="4" r="1.5" {...shared} /><circle cx="12" cy="12" r="1.5" {...shared} /><path d="m5.3 7.2 5.4-2.4M5.3 8.8l5.4 2.4" {...shared} /></>,
    Facts: <><path d="M4 2.5h6.5L13 5v8.5H4z" {...shared} /><path d="M10.5 2.5V5H13M6 8h5M6 10.5h4" {...shared} /></>,
    Relationships: <><circle cx="4" cy="5" r="1.5" {...shared} /><circle cx="12" cy="11" r="1.5" {...shared} /><path d="m5.2 6.1 5.6 3.8" {...shared} /></>,
    Procedures: <><path d="M4 3h8M4 8h8M4 13h8" {...shared} /><path d="m2.5 3 .5.5 1-1M2.5 8 .5.5 1-1M2.5 13 .5.5 1-1" {...shared} /></>,
    People: <><circle cx="8" cy="5.1" r="2.3" {...shared} /><path d="M3.7 13c.6-2.3 2-3.4 4.3-3.4s3.7 1.1 4.3 3.4" {...shared} /></>,
    Sources: <><path d="M3 4.5 8 2l5 2.5v7L8 14l-5-2.5z" {...shared} /><path d="M3 4.5 8 7l5-2.5M8 7v7" {...shared} /></>,
    Connectors: <><path d="M5.5 5.5 3.8 7.2a2.3 2.3 0 0 0 3.3 3.3l1.4-1.4M10.5 10.5l1.7-1.7a2.3 2.3 0 0 0-3.3-3.3L7.5 6.9" {...shared} /></>,
    "API Keys": <><circle cx="6.2" cy="8" r="2.7" {...shared} /><path d="M8.9 8H14M11.5 8v2M13 8v1.5" {...shared} /></>,
    "API Explorer": <><path d="m6 3-4 5 4 5M10 3l4 5-4 5" {...shared} /></>,
    Usage: <><path d="M3 12.5a5 5 0 0 1 10 0" {...shared} /><path d="m8 8 2.6-1.5" {...shared} /><path d="M3 13.5h10" {...shared} /></>,
    Billing: <><rect x="2.5" y="4" width="11" height="8" rx="1.5" {...shared} /><path d="M2.5 7h11M5 10h2" {...shared} /></>,
    Settings: <><circle cx="8" cy="8" r="2.2" {...shared} /><path d="M8 2.3v1.3M8 12.4v1.3M13.7 8h-1.3M3.6 8H2.3M12 4l-.9.9M4.9 11.1 4 12M12 12l-.9-.9M4.9 4.9 4 4" {...shared} /></>,
    "Feature Flags": <><path d="M4 3v10M4 4h7l-1 2 1 2H4" {...shared} /></>,
  };
  return <svg viewBox="0 0 16 16" className="lab-nav-icon" aria-hidden="true">{paths[label] ?? paths.Overview}</svg>;
}

function OrgSwitcher() {
  const { me, refresh } = useSession();
  const [open, setOpen] = useState(false);
  if (!me) return null;

  async function switchTo(id: string) {
    await consoleApi.switchOrganization(id);
    setOpen(false);
    await refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="lab-org-trigger"
        aria-expanded={open}
      >
        <span className="lab-org-emblem" aria-hidden>{(me.activeOrganization?.name ?? "A").slice(0, 1).toUpperCase()}</span>
        <span className="lab-org-name">{me.activeOrganization?.name ?? "Select organization"}</span>
        <svg viewBox="0 0 16 16" className="lab-org-chevron" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="lab-popover absolute z-20 mt-2 w-64 border border-border bg-popover p-1">
            {me.organizations.map((o) => (
              <button
                key={o.id}
                onClick={() => switchTo(o.id)}
                className={cn(
                  "lab-popover-option flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-sm hover:bg-accent",
                  o.id === me.activeOrganization?.id && "bg-accent"
                )}
              >
                <span className="truncate">{o.name}</span>
                <span className="text-xs text-muted-foreground">{o.role}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function UserMenu() {
  const { me, logout } = useSession();
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const label = me.user.name || me.user.email;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="lab-avatar"
        aria-label="Account menu"
      >
        {label.slice(0, 1)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="lab-user-menu absolute right-0 z-20 mt-2 w-60 border border-border bg-popover p-1">
            <div className="px-2 py-1.5 text-sm">
              <p className="truncate font-medium">{me.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
            </div>
            <div className="my-1 border-t border-border" />
            <Link to="/app/settings/profile" onClick={() => setOpen(false)} className="block rounded-md px-2.5 py-2 text-sm hover:bg-accent">
              Settings
            </Link>
            <button onClick={() => void logout()} className="block w-full rounded-md px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10">
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="lab-theme-button">
      {theme === "dark" ? (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 1.3v1.4M8 13.3v1.4M1.3 8h1.4M13.3 8h1.4M3.3 3.3l1 1M11.7 11.7l1 1M3.3 12.7l1-1M11.7 4.3l1-1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M13.2 10.2A5.6 5.6 0 0 1 5.8 2.8 5.6 5.6 0 1 0 13.2 10.2Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
      )}
    </Button>
  );
}

export default function AppShell() {
  const navigate = useNavigate();
  const { logout } = useSession();
  const { toggle } = useTheme();
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const actions: CommandAction[] = useMemo(
    () => [
      ...NAV.map((n) => ({ id: `nav:${n.to}`, label: n.label, hint: n.group || "Go", onSelect: () => navigate(n.to) })),
      { id: "theme", label: "Toggle theme", hint: "Action", onSelect: toggle },
      { id: "logout", label: "Sign out", hint: "Action", onSelect: () => void logout() },
    ],
    [navigate, toggle, logout]
  );

  return (
    <div className="lab-shell">
      <aside className="lab-sidebar">
        <Link to="/app" className="lab-brand" aria-label="Anansi workspace home">
          <BrandMark />
          <span>
            <span className="lab-brand-wordmark block">Anansi</span>
            <span className="lab-brand-subtitle block">Knowledge Lab</span>
          </span>
        </Link>
        <nav className="lab-sidebar-nav" aria-label="Workspace navigation">
          {NAV_GROUPS.map((group) => {
            const items = NAV.filter((n) => n.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group || "root"} className="lab-sidebar-section">
                {group && (
                  <p className="lab-sidebar-label">{group}</p>
                )}
                {items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === "/app"}
                    className={({ isActive }) =>
                      cn(
                        "lab-sidebar-link",
                        isActive && "lab-active"
                      )
                    }
                  >
                    <NavGlyph label={n.label} />
                    <span>{n.label}</span>
                    {!n.backed && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">soon</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="lab-sidebar-footer">
          <div className="lab-sidebar-status"><span className="lab-status-light" aria-hidden="true" />Workspace controls online</div>
        </div>
      </aside>

      <div className="lab-main">
        <header className="lab-topbar">
          <details className="lab-mobile-nav">
            <summary><BrandMark compact /> Menu</summary>
            <nav className="lab-mobile-panel" aria-label="Mobile workspace navigation">
              {NAV_GROUPS.map((group) => {
                const items = NAV.filter((n) => n.group === group);
                if (!items.length) return null;
                return <div key={group || "root"} className="lab-mobile-group">
                  {group && <p className="lab-sidebar-label">{group}</p>}
                  {items.map((n) => <NavLink key={n.to} to={n.to} end={n.to === "/app"} className={({ isActive }) => cn("lab-mobile-link", isActive && "lab-active")}><NavGlyph label={n.label} />{n.label}</NavLink>)}
                </div>;
              })}
            </nav>
          </details>
          <div className="lab-context">
            <p className="lab-context-kicker">Workspace</p>
            <p className="lab-context-title">Operational knowledge</p>
          </div>
          <div className="lab-tools">
            <OrgSwitcher />
            <Button variant="outline" size="sm" onClick={() => setCmdOpen(true)} className="lab-command-button">
              <span className="text-muted-foreground">Command</span>
              <kbd>⌘K</kbd>
            </Button>
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} actions={actions} placeholder="Search or jump to…" />
    </div>
  );
}
