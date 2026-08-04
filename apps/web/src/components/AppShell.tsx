/*
 * Authenticated app chrome: sidebar (grouped nav) + top bar (org switcher, ⌘K,
 * theme, user menu) + routed <Outlet/>. See NAVIGATION.md §2.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Button, CommandPalette, cn, useTheme, type CommandAction } from "@anansi/ui";
import { useSession } from "../lib/session.js";
import { consoleApi } from "../lib/api.js";
import { NAV, NAV_GROUPS } from "../lib/nav.js";

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
        className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
      >
        <span className="inline-block size-4 rounded-sm bg-primary" aria-hidden />
        <span className="max-w-40 truncate font-medium">{me.activeOrganization?.name ?? "Select org"}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute z-20 mt-1 w-60 rounded-md border border-border bg-popover p-1 shadow-md">
            {me.organizations.map((o) => (
              <button
                key={o.id}
                onClick={() => switchTo(o.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent",
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
        className="flex size-8 items-center justify-center rounded-full bg-muted text-sm font-medium uppercase text-foreground"
        aria-label="Account menu"
      >
        {label.slice(0, 1)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-md">
            <div className="px-2 py-1.5 text-sm">
              <p className="truncate font-medium">{me.user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
            </div>
            <div className="my-1 border-t border-border" />
            <Link to="/app/settings/profile" onClick={() => setOpen(false)} className="block rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
              Settings
            </Link>
            <button onClick={() => void logout()} className="block w-full rounded-sm px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10">
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
    <Button variant="ghost" size="sm" onClick={toggle} aria-label="Toggle theme">
      {theme === "dark" ? "Light" : "Dark"}
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
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <span className="inline-block size-5 rounded-sm bg-primary" aria-hidden />
          <Link to="/app" className="font-semibold tracking-tight">Anansi</Link>
        </div>
        <nav className="flex-1 overflow-y-auto p-3">
          {NAV_GROUPS.map((group) => {
            const items = NAV.filter((n) => n.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group || "root"} className="mb-4">
                {group && (
                  <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{group}</p>
                )}
                {items.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === "/app"}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors",
                        isActive ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )
                    }
                  >
                    <span>{n.label}</span>
                    {!n.backed && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">soon</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border px-4">
          <OrgSwitcher />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCmdOpen(true)} className="gap-2">
              <span className="text-muted-foreground">Search</span>
              <kbd className="rounded border border-border bg-muted px-1 text-[10px]">⌘K</kbd>
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
