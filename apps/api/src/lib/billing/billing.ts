/*
 * Anansi Enterprise Edition — licensed under LICENSE-EE, not MIT.
 * See /LICENSE-EE at the repo root. Production use requires a commercial
 * license; evaluation, self-hosted non-production use, and contributions
 * are permitted under LICENSE-EE terms.
 */

import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { subscriptions } from "../db/schema.js";
import type { PlanName } from "./plans.js";
import { captureMessage } from "../infra/error-reporting.js";

// Our subscription_status enum (schema.ts) — Stripe has more statuses than we
// store, so every incoming status is normalized into one of these.
export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "incomplete";

// Statuses that RETAIN paid entitlement. `past_due` is included deliberately:
// this is the dunning grace window. Stripe retries the failed invoice on its
// configured schedule; we keep the customer on their paid plan during those
// retries instead of cutting them off on the first failed charge. When retries
// are exhausted Stripe fires a subscription.updated with a terminal status
// (canceled/unpaid), which drops entitlement here and downgrades to free.
const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

// Map any Stripe status onto our enum. Also fixes a latent bug: statuses Stripe
// can send but our enum doesn't list (unpaid, incomplete_expired, paused) would
// otherwise violate the pg enum on insert.
export function normalizeStripeStatus(status: string): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "canceled":
    case "incomplete":
      return status;
    case "unpaid":              // dunning retries exhausted — treat as canceled
    case "paused":              // access paused — not entitled
      return "canceled";
    case "incomplete_expired":  // initial payment never completed
      return "incomplete";
    default:                    // unknown/future status → safe default (not entitled)
      return "canceled";
  }
}

// Resolve the plan a Stripe subscription maps to. Non-entitled statuses always
// resolve to "free"; entitled ones map by price id (falling back to "pro").
export function resolvePlanFromStripe(status: string, priceId: string | undefined): PlanName {
  if (!ENTITLED_STATUSES.has(status)) return "free";
  if (priceId && priceId === process.env.STRIPE_API_PRICE_ID) return "api";
  if (priceId && priceId === process.env.STRIPE_SCALE_PRICE_ID) return "scale";
  return "pro";
}

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    _stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
  }
  return _stripe;
}

// Convenience alias for webhook signature verification — stripe object is needed
// at call sites that already guard on STRIPE_WEBHOOK_SECRET being set.
export const stripe = {
  webhooks: {
    constructEvent: (payload: string, sig: string, secret: string) =>
      getStripe().webhooks.constructEvent(payload, sig, secret),
  },
};

export async function getOrCreateCustomer(
  workspaceId: string,
  workspaceName: string
): Promise<string> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.workspaceId, workspaceId),
  });

  if (sub?.stripeCustomerId) return sub.stripeCustomerId;

  const customer = await getStripe().customers.create({
    name: workspaceName,
    metadata: { workspaceId },
  });

  await db
    .insert(subscriptions)
    .values({ workspaceId, stripeCustomerId: customer.id, plan: "free" })
    .onConflictDoUpdate({
      target: subscriptions.workspaceId,
      set: { stripeCustomerId: customer.id, updatedAt: new Date() },
    });

  return customer.id;
}

export async function createCheckoutSession(
  workspaceId: string,
  workspaceName: string,
  appUrl: string,
  plan: "pro" | "scale" | "api" = "pro",
  returnTo: "dashboard" | "portal" = "dashboard"
): Promise<string> {
  const priceId =
    plan === "api"   ? process.env.STRIPE_API_PRICE_ID
    : plan === "scale" ? process.env.STRIPE_SCALE_PRICE_ID
    : process.env.STRIPE_PRO_PRICE_ID;
  if (!priceId) throw new Error(`STRIPE_${plan.toUpperCase()}_PRICE_ID not configured`);

  const customerId = await getOrCreateCustomer(workspaceId, workspaceName);
  const cancelUrl = returnTo === "portal" ? `${appUrl}/portal` : `${appUrl}/dashboard`;
  const successUrl = returnTo === "portal"
    ? `${appUrl}/portal?upgraded=1&session_id={CHECKOUT_SESSION_ID}`
    : `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`;

  const session = await getStripe().checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { workspaceId },
    subscription_data: { trial_period_days: 14 },
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL — check your Price configuration");
  return session.url;
}

export async function createPortalSession(
  workspaceId: string,
  workspaceName: string,
  appUrl: string,
  returnTo: "dashboard" | "portal" = "dashboard"
): Promise<string> {
  const customerId = await getOrCreateCustomer(workspaceId, workspaceName);
  const returnUrl = returnTo === "portal" ? `${appUrl}/portal` : `${appUrl}/dashboard`;

  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const workspaceId = session.metadata?.workspaceId;
      if (!workspaceId || !session.subscription) return;

      const sub = await getStripe().subscriptions.retrieve(session.subscription as string);
      await upsertSubscription(workspaceId, sub);
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const workspaceId = sub.metadata?.workspaceId
        ?? await findWorkspaceByCustomer(sub.customer as string);
      if (!workspaceId) return;
      await upsertSubscription(workspaceId, sub);
      break;
    }

    // Dunning visibility — a charge failed and the subscription is now (or will
    // soon be) past_due. We do NOT downgrade here: the customer keeps their plan
    // through Stripe's retry window (see ENTITLED_STATUSES). Surface it so ops
    // can watch dunning and, if desired, reach out before Stripe gives up.
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const workspaceId = customerId ? await findWorkspaceByCustomer(customerId) : null;
      if (!workspaceId) return;
      const attempt = (invoice as { attempt_count?: number }).attempt_count;
      captureMessage(
        `[billing] payment failed for workspace ${workspaceId} (invoice ${invoice.id}, attempt ${attempt ?? "?"}) — in dunning grace window, plan retained`,
        "warning"
      );
      break;
    }

    // Trial ending soon — informational hook (e.g. a reminder email could fire here).
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      const workspaceId = sub.metadata?.workspaceId
        ?? await findWorkspaceByCustomer(sub.customer as string);
      if (!workspaceId) return;
      captureMessage(`[billing] trial ending soon for workspace ${workspaceId} (subscription ${sub.id})`, "info");
      break;
    }
  }
}

async function findWorkspaceByCustomer(customerId: string): Promise<string | null> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.stripeCustomerId, customerId),
  });
  return sub?.workspaceId ?? null;
}

async function upsertSubscription(
  workspaceId: string,
  sub: Stripe.Subscription
): Promise<void> {
  const item = sub.items.data[0];
  const priceId = item?.price.id;
  // past_due keeps its paid plan (dunning grace); terminal statuses → free.
  const plan: PlanName = resolvePlanFromStripe(sub.status, priceId);
  const status = normalizeStripeStatus(sub.status);
  // Stripe v22+ moved current_period_end off the Subscription onto each
  // SubscriptionItem. Read it from the item so dashboards ("renews on …") have
  // a real value instead of NULL. Guard the access — some events omit it.
  const periodEndUnix = (item as { current_period_end?: number } | undefined)?.current_period_end;
  const currentPeriodEnd = typeof periodEndUnix === "number" ? new Date(periodEndUnix * 1000) : null;

  await db
    .insert(subscriptions)
    .values({
      workspaceId,
      stripeCustomerId: sub.customer as string,
      stripeSubscriptionId: sub.id,
      plan,
      status,
      currentPeriodEnd,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: subscriptions.workspaceId,
      set: {
        stripeCustomerId: sub.customer as string,
        stripeSubscriptionId: sub.id,
        plan,
        status,
        currentPeriodEnd,
        updatedAt: new Date(),
      },
    });
}
