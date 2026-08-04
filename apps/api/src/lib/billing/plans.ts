export type PlanName = "free" | "pro" | "scale" | "enterprise" | "api";

export interface PlanLimits {
  // Slack-bot quotas (kept for legacy Slack-bot installs)
  maxChannels: number;
  maxMessagesPerMonth: number;
  maxQueriesPerMonth: number;

  // Developer API quotas
  maxIngestCallsPerMonth: number;
  maxContextCallsPerMonth: number;
  maxMemoryUsers: number;

  // Retention — chunks older than this are TTL'd. Infinity = unlimited retention.
  memoryRetentionDays: number;
}

export interface PlanFeatures {
  // Search modes
  hybridSearch: boolean;       // BM25 + vector + RRF (vs vector-only)
  metadataFilters: boolean;    // $gte/$lte/$contains/$and/$or operators on retrieval

  // Memory model features
  entityGraph: boolean;        // /v1/entities + temporal facts in /v1/context
  workspaceContext: boolean;   // scope=workspace synthesis (team-wide profile)
  continuousSynthesis: boolean; // synthesize on every ingest vs hourly batch

  // Integrations
  notionConnector: boolean;
  googleDocsConnector: boolean;
  linearConnector: boolean;
  transcriptWebhook: boolean;
  urlIngestion: boolean;

  // Developer ops
  outboundWebhooks: boolean;   // POST {webhookUrl} on synthesis complete
}

export interface PlanConfig extends PlanLimits, PlanFeatures {
  displayName: string;
  monthlyPriceUsd: number; // 0 for free, -1 for "contact us"
  supportTier: "community" | "email" | "priority";
}

export const PLANS: Record<PlanName, PlanConfig> = {
  free: {
    displayName: "Free",
    monthlyPriceUsd: 0,
    supportTier: "community",

    maxChannels: 2,
    maxMessagesPerMonth: 1_000,
    maxQueriesPerMonth: 50,

    maxIngestCallsPerMonth: 1_000,
    maxContextCallsPerMonth: 500,
    maxMemoryUsers: 10,
    memoryRetentionDays: 7,

    hybridSearch: false,
    metadataFilters: false,
    entityGraph: false,
    workspaceContext: false,
    continuousSynthesis: false,
    notionConnector: false,
    googleDocsConnector: false,
    linearConnector: false,
    transcriptWebhook: false,
    urlIngestion: true,
    outboundWebhooks: false,
  },

  pro: {
    displayName: "Pro",
    monthlyPriceUsd: 19,
    supportTier: "email",

    maxChannels: Infinity,
    maxMessagesPerMonth: 50_000,
    maxQueriesPerMonth: 500,

    maxIngestCallsPerMonth: 25_000,
    maxContextCallsPerMonth: 10_000,
    maxMemoryUsers: Infinity,
    memoryRetentionDays: Infinity,

    hybridSearch: true,
    metadataFilters: true,
    entityGraph: true,
    workspaceContext: true,
    continuousSynthesis: true,
    notionConnector: true,
    googleDocsConnector: true,
    linearConnector: true,
    transcriptWebhook: true,
    urlIngestion: true,
    outboundWebhooks: true,
  },

  scale: {
    displayName: "Scale",
    monthlyPriceUsd: 99,
    supportTier: "priority",

    maxChannels: Infinity,
    maxMessagesPerMonth: 500_000,
    maxQueriesPerMonth: 5_000,

    maxIngestCallsPerMonth: 250_000,
    maxContextCallsPerMonth: 100_000,
    maxMemoryUsers: Infinity,
    memoryRetentionDays: Infinity,

    hybridSearch: true,
    metadataFilters: true,
    entityGraph: true,
    workspaceContext: true,
    continuousSynthesis: true,
    notionConnector: true,
    googleDocsConnector: true,
    linearConnector: true,
    transcriptWebhook: true,
    urlIngestion: true,
    outboundWebhooks: true,
  },

  enterprise: {
    displayName: "Enterprise",
    monthlyPriceUsd: -1,
    supportTier: "priority",

    maxChannels: Infinity,
    maxMessagesPerMonth: Infinity,
    maxQueriesPerMonth: Infinity,

    maxIngestCallsPerMonth: Infinity,
    maxContextCallsPerMonth: Infinity,
    maxMemoryUsers: Infinity,
    memoryRetentionDays: Infinity,

    hybridSearch: true,
    metadataFilters: true,
    entityGraph: true,
    workspaceContext: true,
    continuousSynthesis: true,
    notionConnector: true,
    googleDocsConnector: true,
    linearConnector: true,
    transcriptWebhook: true,
    urlIngestion: true,
    outboundWebhooks: true,
  },

  // Legacy flat $49 tier — kept so any existing subscribers don't break.
  // New signups go to "pro" or "scale" instead.
  api: {
    displayName: "API (legacy)",
    monthlyPriceUsd: 49,
    supportTier: "email",

    maxChannels: 0,
    maxMessagesPerMonth: 0,
    maxQueriesPerMonth: 0,

    maxIngestCallsPerMonth: 10_000,
    maxContextCallsPerMonth: 5_000,
    maxMemoryUsers: 100,
    memoryRetentionDays: Infinity,

    hybridSearch: true,
    metadataFilters: true,
    entityGraph: true,
    workspaceContext: true,
    continuousSynthesis: true,
    notionConnector: true,
    googleDocsConnector: true,
    linearConnector: true,
    transcriptWebhook: true,
    urlIngestion: true,
    outboundWebhooks: true,
  },
};

/*
 * The plan a workspace gets when it has no subscription row.
 *
 * This used to be an unconditional "free", which is correct for the hosted
 * service and actively harmful everywhere else. A self-hoster who created a
 * workspace by any route other than seed-dev-key received the free tier on
 * their own hardware: 1,000 ingests/month, hybrid search off, and — worst — a
 * 7-day `memoryRetentionDays` that the retention worker enforces by hard
 * deleting chunks. A memory engine that silently forgets after a week is not
 * the product, and the accompanying error told them to "upgrade at /portal",
 * which a self-hosted install does not have.
 *
 * Tiers only mean something where an upgrade can actually be purchased, so the
 * hosted deployment is detected by the thing that makes it hosted: Stripe being
 * configured. Everywhere else the default is unlimited. ANANSI_DEFAULT_PLAN
 * overrides both, for anyone who genuinely wants to meter their own install.
 */
export function resolveDefaultPlan(env: NodeJS.ProcessEnv = process.env): PlanName {
  const override = env.ANANSI_DEFAULT_PLAN;
  if (override && override in PLANS) return override as PlanName;
  return env.STRIPE_SECRET_KEY ? "free" : "enterprise";
}

export function getLimits(plan: PlanName): PlanLimits {
  return PLANS[plan];
}

export function getFeatures(plan: PlanName): PlanFeatures {
  return PLANS[plan];
}

export function hasFeature(plan: PlanName, feature: keyof PlanFeatures): boolean {
  return PLANS[plan][feature];
}

export function formatLimit(n: number): string {
  return n === Infinity ? "unlimited" : n.toLocaleString();
}
