import { expect, test, type Page } from "@playwright/test";

const user = { id: "user-1", email: "owner@example.test", name: "Ari Owner", avatarUrl: null };
const alpha = { id: "org-alpha", name: "Alpha", slug: "alpha", role: "owner" };
const beta = { id: "org-beta", name: "Beta", slug: "beta", role: "admin" };

type Harness = {
  activeOrg: typeof alpha | typeof beta;
  keys: { id: string; name: string; lastUsedAt: string | null; createdAt: string; scopes: string[] }[];
  invitations: { id: string; email: string; role: string; expiresAt: string }[];
  ingested: string[];
};

function json(body: unknown, status = 200) {
  return { status, contentType: "application/json", body: JSON.stringify(body) };
}

async function installConsoleHarness(page: Page) {
  const state: Harness = { activeOrg: alpha, keys: [], invitations: [], ingested: [] };
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const rawBody = request.postData();
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
    const me = () => ({ user, activeOrganization: state.activeOrg, organizations: [alpha, beta] });

    if (path === "/console/me") return route.fulfill(json(me()));
    if (path === "/console/auth/magic-link" && method === "POST") {
      return route.fulfill(json({ ok: true, devUrl: "http://127.0.0.1:4317/console/auth/verify?token=e2e" }));
    }
    if (path === "/console/organizations/switch" && method === "POST") {
      state.activeOrg = body?.organizationId === beta.id ? beta : alpha;
      return route.fulfill(json({ organization: state.activeOrg }));
    }
    if (path === "/console/organizations/members") {
      return route.fulfill(json({ members: [{ membershipId: "member-1", role: "owner", user: { ...user, status: "active" } }] }));
    }
    if (path === "/console/organizations/invitations") {
      if (method === "POST") {
        const invitation = { id: `invite-${state.invitations.length + 1}`, email: String(body?.email), role: String(body?.role), expiresAt: "2030-01-01T00:00:00.000Z" };
        state.invitations.push(invitation);
        return route.fulfill(json({ invitation, acceptUrl: "http://127.0.0.1:4317/accept-invite?token=e2e" }));
      }
      return route.fulfill(json({ invitations: state.invitations }));
    }
    if (path === "/console/api-keys") {
      if (method === "POST") {
        state.keys.push({ id: `key-${state.keys.length + 1}`, name: String(body?.name), lastUsedAt: null, createdAt: "2026-08-04T00:00:00.000Z", scopes: (body?.scopes as string[]) ?? [] });
        return route.fulfill(json({ key: state.keys.at(-1), secret: "anansi_e2e_secret_shown_once" }));
      }
      return route.fulfill(json({ keys: state.keys }));
    }
    if (path.startsWith("/console/api-keys/") && method === "DELETE") {
      state.keys = state.keys.filter((key) => key.id !== path.split("/").at(-1));
      return route.fulfill(json({ ok: true }));
    }
    if (path === "/v1/ingest" && method === "POST") {
      state.ingested.push(String(body?.content ?? ""));
      return route.fulfill(json({ ok: true, id: "ingest-e2e" }, 201));
    }
    if (path === "/console/search" && method === "POST") {
      const query = String(body?.q ?? "").toLowerCase();
      const results = state.ingested.filter((content) => content.toLowerCase().includes(query)).map((content, i) => ({ id: `search-${i}`, content, score: 0.99, sourceType: "api", createdAt: "2026-08-04T00:00:00.000Z" }));
      return route.fulfill(json({ results }));
    }
    if (path === "/console/usage") return route.fulfill(json({ usage: { plan: "free", month: "August 2026", queries: { used: 0, limit: 100 }, messages: { used: 0, limit: 100 }, channels: { used: 0, limit: 10 }, apiIngest: { used: 0, limit: 100 }, apiContext: { used: 0, limit: 100 } } }));
    if (path === "/console/memory") return route.fulfill(json({ profile: null }));
    if (path === "/console/auth/logout") return route.fulfill(json({ ok: true }));
    await route.continue();
  });
  return state;
}

test("passwordless sign-in requests and exposes the development magic link", async ({ page }) => {
  await page.route("**/console/me", (route) => route.fulfill(json({ error: "unauthorized" }, 401)));
  await page.route("**/console/auth/magic-link", (route) => route.fulfill(json({ ok: true, devUrl: "http://127.0.0.1:4317/console/auth/verify?token=e2e" })));
  await page.goto("/");
  await page.getByPlaceholder("you@company.com").fill("owner@example.test");
  await page.getByRole("button", { name: "Send magic link" }).click();
  await expect(page.getByText("Check your email for a sign-in link.")).toBeVisible();
  await expect(page.getByRole("link", { name: /token=e2e/ })).toBeVisible();
});

test("owner can switch organizations and invite a teammate", async ({ page }) => {
  await installConsoleHarness(page);
  await page.goto("/app");
  await page.getByRole("button", { name: "Alpha" }).click();
  await page.getByRole("button", { name: /Beta.*admin/ }).click();
  await expect(page.getByRole("button", { name: "Beta" })).toBeVisible();
  await page.goto("/app/settings/members");
  await page.getByPlaceholder("teammate@company.com").fill("teammate@example.test");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invited teammate@example.test.")).toBeVisible();
  await expect(page.getByText("Pending invitations (1)")).toBeVisible();
});

test("owner can create and revoke an API key", async ({ page }) => {
  await installConsoleHarness(page);
  await page.goto("/app/integrations");
  await page.getByPlaceholder("Production").fill("E2E integration");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("anansi_e2e_secret_shown_once")).toBeVisible();
  await expect(page.getByText("E2E integration")).toBeVisible();
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("No API keys yet.")).toBeVisible();
});

test("an ingested item is discoverable through the search UI", async ({ page }) => {
  await installConsoleHarness(page);
  await page.goto("/app");
  await page.evaluate(async () => {
    await fetch("/v1/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "Incident commander is Morgan." }) });
  });
  await page.goto("/app/search");
  await page.getByPlaceholder("e.g. incident response owner").fill("incident commander");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("Incident commander is Morgan.")).toBeVisible();
});

