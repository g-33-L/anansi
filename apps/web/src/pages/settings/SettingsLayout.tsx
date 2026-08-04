import { NavLink, Outlet } from "react-router-dom";
import { cn, Heading } from "@anansi/ui";

const TABS = [
  { to: "profile", label: "Profile" },
  { to: "members", label: "Members" },
  { to: "teams", label: "Teams" },
  { to: "organization", label: "Organization" },
];

export default function SettingsLayout() {
  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <Heading level={2}>Settings</Heading>
      <div className="mt-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                "relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
