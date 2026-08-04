/*
 * Product app root. SessionProvider bootstraps /console/me; the Gate shows the
 * login screen when unauthenticated and the full app shell when signed in.
 * Data-surface routes are generated from the nav config as honest scaffolds until
 * their /console BFF endpoints ship.
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Spinner, ThemeProvider } from "@anansi/ui";
import { SessionProvider, useSession } from "./lib/session.js";
import { NAV } from "./lib/nav.js";
import AppShell from "./components/AppShell.js";
import LoginPage from "./pages/LoginPage.js";
import OverviewPage from "./pages/OverviewPage.js";
import SurfacePage, { type Surface } from "./pages/SurfacePage.js";
import ChatPage from "./pages/ChatPage.js";
import SettingsLayout from "./pages/settings/SettingsLayout.js";
import ProfilePage from "./pages/settings/ProfilePage.js";
import MembersPage from "./pages/settings/MembersPage.js";
import TeamsPage from "./pages/settings/TeamsPage.js";
import OrganizationPage from "./pages/settings/OrganizationPage.js";
import SearchPage from "./pages/SearchPage.js";
import MemoryPage from "./pages/MemoryPage.js";
import UsagePage from "./pages/UsagePage.js";
import ApiKeysPage from "./pages/ApiKeysPage.js";
import FirstRunSetupPage from "./pages/FirstRunSetupPage.js";
import { hasCompletedFirstRun } from "./lib/first-run.js";

const SURFACE_DESCRIPTIONS: Record<string, string> = {
  "/app/search": "Hybrid search across your organization's memory.",
  "/app/chat": "Ask questions grounded in your company's memory.",
  "/app/memory": "Browse synthesized profiles and the raw chunks behind them.",
  "/app/timeline": "The bi-temporal record — what was learned, and when.",
  "/app/graph": "The entity knowledge graph.",
  "/app/facts": "Cited, trust-tiered claims from the ledger.",
  "/app/relationships": "How people, orgs, projects, and tech relate over time.",
  "/app/procedures": "Extracted, versioned operational skills.",
  "/app/people": "The people your memory is about.",
  "/app/sources": "Everything you've ingested, grouped by source.",
  "/app/connectors": "Sync Slack, Notion, Google Docs, and Linear.",
  "/app/integrations": "Outbound webhooks, MCP, and SDK access.",
  "/app/api-explorer": "Interactively call the /v1 API.",
  "/app/usage": "Ingest and query volume against your plan's limits.",
  "/app/billing": "Plan, invoices, and payment method.",
};

const DEDICATED_ROUTES = new Set([
  "/app",
  "/app/search",
  "/app/chat",
  "/app/memory",
  "/app/usage",
  "/app/integrations",
  "/app/settings",
]);

function HomeRoute() {
  const { me } = useSession();
  const organizationId = me?.activeOrganization?.id;
  // Every newly authenticated browser is sent through setup once per org. The
  // server still creates the default organization during magic-link verification;
  // this page turns that valid but empty install into a verified working tenant.
  if (organizationId && !hasCompletedFirstRun(organizationId)) {
    return <Navigate to="/app/setup" replace />;
  }
  return <OverviewPage />;
}

function AuthedApp() {
  return (
    <Routes>
      <Route path="/app" element={<AppShell />}>
        <Route index element={<HomeRoute />} />
        <Route path="setup" element={<FirstRunSetupPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="organization" element={<OrganizationPage />} />
        </Route>
        <Route path="search" element={<SearchPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="memory" element={<MemoryPage />} />
        <Route path="usage" element={<UsagePage />} />
        <Route path="integrations" element={<ApiKeysPage />} />
        {NAV.filter((n) => !DEDICATED_ROUTES.has(n.to)).map((n) => (
          <Route
            key={n.to}
            path={n.to.replace("/app/", "")}
            element={<SurfacePage title={n.label} description={SURFACE_DESCRIPTIONS[n.to] ?? ""} surface={n.to.replace("/app/", "") as Surface} />}
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/app" replace />} />
    </Routes>
  );
}

function Gate() {
  const { me, loading } = useSession();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }
  return me ? <AuthedApp /> : <LoginPage />;
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <SessionProvider>
          <Gate />
        </SessionProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
