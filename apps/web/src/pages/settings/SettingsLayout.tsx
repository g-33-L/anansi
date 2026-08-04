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
    <div className="lab-page lab-page--narrow lab-settings">
      <header className="lab-page-header">
        <p className="lab-page-overline">Workspace controls</p>
        <Heading level={2}>Settings</Heading>
      </header>
      <div className="lab-settings-tabs">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                "lab-settings-tab",
                isActive
                  ? "lab-active"
                  : ""
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
