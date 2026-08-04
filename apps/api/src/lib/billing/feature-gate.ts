import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { subscriptions } from "../db/schema.js";
import { hasFeature, resolveDefaultPlan, type PlanName, type PlanFeatures } from "./plans.js";

export async function getPlanForWorkspace(workspaceId: string): Promise<PlanName> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.workspaceId, workspaceId),
    columns: { plan: true },
  });
  return (sub?.plan as PlanName | undefined) ?? resolveDefaultPlan();
}

export interface FeatureGateError {
  error: string;
  upgrade: PlanName;
  feature: keyof PlanFeatures;
}

/*
 * "/portal" only exists on the hosted service. Pointing a self-hoster at a page
 * their install does not serve turns a feature gate into a dead end, so the
 * remedy named here has to match the deployment: buy an upgrade, or set the
 * env var that governs your own install.
 */
export function buildUpgradeError(
  feature: keyof PlanFeatures,
  label: string,
  env: NodeJS.ProcessEnv = process.env
): FeatureGateError {
  const hosted = Boolean(env.STRIPE_SECRET_KEY);
  return {
    error: hosted
      ? `${label} requires the Pro plan — upgrade at /portal to unlock.`
      : `${label} is not enabled for this workspace's plan. On a self-hosted install, set ANANSI_DEFAULT_PLAN=enterprise (the default when Stripe is not configured) or assign the workspace a plan.`,
    upgrade: "pro",
    feature,
  };
}

export function gateFeature(
  plan: PlanName,
  feature: keyof PlanFeatures,
  label: string
): FeatureGateError | null {
  if (hasFeature(plan, feature)) return null;
  return buildUpgradeError(feature, label);
}
