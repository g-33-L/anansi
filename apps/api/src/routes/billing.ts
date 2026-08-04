/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { stripe, createCheckoutSession, createPortalSession, handleWebhookEvent } from "../lib/billing/billing.js";
import { db } from "../lib/db/index.js";
import { workspaces } from "../lib/db/schema.js";
import { readSignedCookieValue } from "../lib/utils/crypto.js";
import { TOKENS_CSS, BASE_CSS, THEME_TOGGLE_CSS, THEME_TOGGLE_HTML, THEME_SCRIPT } from "../lib/ui/theme.js";

export const billingRoutes = new Hono();

// Verifies the signed dash_ws cookie maps to a real workspace in the DB.
async function requireDashSession(c: Context): Promise<string | null> {
  const workspaceId = readSignedCookieValue(getCookie(c, "dash_ws"));
  if (!workspaceId) return null;
  const ws = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
    columns: { id: true },
  });
  return ws ? workspaceId : null;
}

// Initiates Stripe checkout — called from dashboard "Upgrade" button (POST to prevent CSRF).
// ?plan=pro (default) | scale | api (legacy)
billingRoutes.post("/checkout", async (c) => {
  const workspaceId = await requireDashSession(c);
  if (!workspaceId) return c.json({ error: "Unauthorized" }, 401);

  const planQ = c.req.query("plan");
  const plan: "pro" | "scale" | "api" =
    planQ === "scale" ? "scale" : planQ === "api" ? "api" : "pro";

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Billing not configured" }, 503);
  }

  try {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const url = await createCheckoutSession(workspaceId, workspace.slackTeamName ?? "", appUrl, plan);
    return c.redirect(url, 302);
  } catch (err) {
    console.error("[billing] checkout error", err);
    return c.json({ error: "Could not create checkout session" }, 500);
  }
});

// Redirects to Stripe Customer Portal for subscription management (POST to prevent CSRF).
billingRoutes.post("/portal", async (c) => {
  const workspaceId = await requireDashSession(c);
  if (!workspaceId) return c.json({ error: "Unauthorized" }, 401);

  const workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.id, workspaceId),
  });
  if (!workspace) return c.json({ error: "Workspace not found" }, 404);

  if (!process.env.STRIPE_SECRET_KEY) {
    return c.json({ error: "Billing not configured" }, 503);
  }

  try {
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const url = await createPortalSession(workspaceId, workspace.slackTeamName ?? "", appUrl);
    return c.redirect(url, 302);
  } catch (err) {
    console.error("[billing] portal error", err);
    return c.json({ error: "Could not create portal session" }, 500);
  }
});

// Success landing page after Stripe checkout — used by Slack dashboard flow.
// Portal flow uses /portal?upgraded=1 directly (set in createCheckoutSession returnTo:"portal").
billingRoutes.get("/success", (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Anansi — Subscription activated</title>
<style>
  ${TOKENS_CSS}
  ${BASE_CSS}
  ${THEME_TOGGLE_CSS}
  body{min-height:100vh;display:grid;place-items:center;padding:24px}
  .receipt{width:min(100%,500px);background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-card);padding:44px 36px;text-align:center}
  .mark{width:42px;height:42px;display:grid;place-items:center;margin:0 auto 20px;border:1px solid var(--ok-border);border-radius:50%;background:var(--ok-soft);color:var(--ok);font-family:var(--font-mono);font-size:1rem}
  .eyebrow{margin-bottom:10px}
  h1{font-family:var(--font-display);font-size:2.15rem;font-weight:600;letter-spacing:-.04em;line-height:1.05;margin-bottom:12px}
  p{color:var(--text-muted);line-height:1.65;margin-bottom:24px}
  .return-link{display:block;margin-top:18px;font-size:.82rem}
  .theme-toggle{position:fixed;top:18px;right:18px;z-index:1}
  @media(max-width:480px){.receipt{padding:34px 22px}h1{font-size:1.85rem}}
</style>
<script>${THEME_SCRIPT}</script>
</head>
<body>
  ${THEME_TOGGLE_HTML}
  <main class="receipt">
    <div class="mark" aria-hidden="true">✓</div>
    <div class="eyebrow">Billing updated</div>
    <h1>Subscription activated</h1>
    <p>Your plan is now active. Head back to your dashboard to start using your new limits.</p>
    <a href="/dashboard" class="btn btn-primary">Back to dashboard</a>
    <a href="/portal" class="return-link">Or go to the developer portal →</a>
  </main>
</body></html>`);
});

// Stripe webhook — raw body required for signature verification.
billingRoutes.post("/webhook", async (c) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[billing] STRIPE_WEBHOOK_SECRET not set");
    return c.json({ error: "Webhook not configured" }, 500);
  }

  const rawBody = await c.req.text();
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "Missing signature" }, 400);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error("[billing] webhook signature verification failed", err);
    return c.json({ error: "Invalid signature" }, 400);
  }

  try {
    await handleWebhookEvent(event);
  } catch (err) {
    // Return 200 to prevent Stripe from retrying events that will permanently fail
    // (e.g. workspace deleted, FK constraint). Log for alerting.
    console.error("[billing] webhook handler error", err);
  }

  return c.json({ received: true });
});
