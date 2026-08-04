// Launch config gate — validates production configuration before a deploy is
// trusted. Run against the environment the API will boot with:
//
//   pnpm --filter @anansi/api preflight                 (local .env via tsx --env-file)
//   railway run pnpm --filter @anansi/api preflight     (against Railway service env)
//
// Exit codes: 0 = ready, 1 = one or more FAIL findings. WARNs never fail the
// gate but are printed so launch-day misconfig is a conscious choice, not a
// surprise. Checks are env-shape only (no network calls) so the gate is fast
// and safe to run anywhere — deep connectivity is covered by /status after boot.
//
// Keep this list in sync with REQUIRED_ENV in src/index.ts and
// .env.railway.template — this script is the enforcement half of that template.

type Level = "FAIL" | "WARN" | "OK";

interface Finding {
  level: Level;
  name: string;
  detail: string;
}

const findings: Finding[] = [];
const env = process.env;
const isProd = env.NODE_ENV === "production";

function fail(name: string, detail: string): void {
  findings.push({ level: "FAIL", name, detail });
}
function warn(name: string, detail: string): void {
  findings.push({ level: "WARN", name, detail });
}
function ok(name: string, detail = ""): void {
  findings.push({ level: "OK", name, detail });
}

function present(name: string): boolean {
  return typeof env[name] === "string" && env[name]!.trim() !== "";
}

function isPlaceholder(value: string): boolean {
  return /<.*>|your-|changeme|placeholder|xxxx/i.test(value);
}

function requireVar(name: string, hint: string): void {
  if (!present(name)) return fail(name, `missing — ${hint}`);
  if (isPlaceholder(env[name]!)) return fail(name, `still a template placeholder — ${hint}`);
  ok(name);
}

// ─── Core secrets (REQUIRED_ENV in src/index.ts) ─────────────────────────────

requireVar("DATABASE_URL", "Postgres connection string");
requireVar("REDIS_URL", "Redis connection string");
requireVar("QUERY_API_KEY", "protects /metrics; openssl rand -base64 32");
requireVar("CSRF_SIGNING_KEY", "cookie/state signing; openssl rand -base64 32");

// Key hygiene — these two must exist AND be independent key material.
if (present("ENCRYPTION_KEY")) {
  const key = env.ENCRYPTION_KEY!;
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    fail("ENCRYPTION_KEY", "must be exactly 64 hex chars (32 bytes) — openssl rand -hex 32");
  } else if (/^0+1?$/.test(key)) {
    fail("ENCRYPTION_KEY", "is a known test/dummy value — generate a real key");
  } else {
    ok("ENCRYPTION_KEY");
  }
} else {
  fail("ENCRYPTION_KEY", "missing — openssl rand -hex 32");
}

if (present("API_KEY_HMAC_SECRET")) {
  const secret = env.API_KEY_HMAC_SECRET!;
  if (secret.length < 32) {
    fail("API_KEY_HMAC_SECRET", `only ${secret.length} chars — use at least 32 (openssl rand -base64 32)`);
  } else if (secret === env.ENCRYPTION_KEY) {
    fail("API_KEY_HMAC_SECRET", "identical to ENCRYPTION_KEY — HMAC and AES keys must be independent");
  } else if (secret === env.CSRF_SIGNING_KEY) {
    fail("API_KEY_HMAC_SECRET", "identical to CSRF_SIGNING_KEY — key material must be independent");
  } else {
    ok("API_KEY_HMAC_SECRET");
  }
} else {
  fail("API_KEY_HMAC_SECRET", "missing — openssl rand -base64 32");
}

// ─── App URL ─────────────────────────────────────────────────────────────────

if (!present("APP_URL")) {
  fail("APP_URL", "missing — Stripe redirects, webhooks, and sitemap all derive from it");
} else {
  const url = env.APP_URL!;
  if (isProd && !url.startsWith("https://")) fail("APP_URL", `"${url}" is not https — required in production`);
  else if (isPlaceholder(url) || url.includes("your-railway-url")) fail("APP_URL", "still the template placeholder");
  else ok("APP_URL", url);
}

// ─── LLM provider chain (src/index.ts refuses to boot without one) ──────────

if (present("CEREBRAS_API_KEY")) ok("LLM provider", "Cerebras (primary)");
else if (present("GITHUB_TOKEN")) {
  ok("LLM provider", "GitHub Models");
} else if (present("OLLAMA_BASE_URL")) {
  (isProd ? fail : ok)("LLM provider", "Ollama only — local synthesis quality is unvalidated; not a production provider");
} else {
  fail("LLM provider", "none configured — set CEREBRAS_API_KEY (or GITHUB_TOKEN / OLLAMA_BASE_URL); the API exits at boot without one");
}

if (!present("NOMIC_API_KEY")) {
  (isProd ? warn : ok)("NOMIC_API_KEY", "unset — embeddings fall back to Ollama, which is not reachable from Railway");
} else {
  ok("NOMIC_API_KEY");
}

// ─── Portal auth (Supabase) — signup/login is the revenue front door ────────

for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!present(name) || isPlaceholder(env[name] ?? "")) {
    (isProd ? fail : warn)(name, "missing — /portal signup/login (and therefore all self-serve revenue) is dead without it");
  } else {
    ok(name);
  }
}

// ─── Stripe (billing) ────────────────────────────────────────────────────────

if (!present("STRIPE_SECRET_KEY")) {
  (isProd ? fail : warn)("STRIPE_SECRET_KEY", "missing — checkout returns 503; no paid plans");
} else {
  const key = env.STRIPE_SECRET_KEY!;
  if (isProd && key.startsWith("sk_test_")) fail("STRIPE_SECRET_KEY", "TEST-mode key in production — real customers cannot pay");
  else if (!/^(sk|rk)_(live|test)_/.test(key)) fail("STRIPE_SECRET_KEY", "does not look like a Stripe secret key");
  else ok("STRIPE_SECRET_KEY", key.startsWith("sk_live_") ? "live mode" : "test mode");
}

if (present("STRIPE_SECRET_KEY")) {
  if (!present("STRIPE_WEBHOOK_SECRET")) {
    (isProd ? fail : warn)("STRIPE_WEBHOOK_SECRET", "missing — subscription events are never applied; plans stay 'free' after payment");
  } else if (!env.STRIPE_WEBHOOK_SECRET!.startsWith("whsec_")) {
    fail("STRIPE_WEBHOOK_SECRET", "does not look like a webhook signing secret (whsec_…)");
  } else {
    ok("STRIPE_WEBHOOK_SECRET");
  }

  for (const name of ["STRIPE_PRO_PRICE_ID", "STRIPE_SCALE_PRICE_ID"]) {
    if (!present(name) || !env[name]!.startsWith("price_") || isPlaceholder(env[name]!)) {
      (isProd ? fail : warn)(name, "missing/invalid — that plan's checkout throws at runtime");
    } else {
      ok(name);
    }
  }

  if (!present("STRIPE_INGEST_METER_EVENT_NAME") || !present("STRIPE_CONTEXT_METER_EVENT_NAME")) {
    warn("Stripe meters", "meter event names unset — usage is tracked locally but never reported to Stripe (no overage revenue)");
  } else {
    ok("Stripe meters");
  }
}

// ─── Observability ───────────────────────────────────────────────────────────

if (!present("SENTRY_DSN")) {
  (isProd ? fail : warn)("SENTRY_DSN", "unset — captureError() is a silent no-op; production errors are invisible (launch blocker B2)");
} else {
  ok("SENTRY_DSN", env.SENTRY_ENVIRONMENT ? `environment=${env.SENTRY_ENVIRONMENT}` : "SENTRY_ENVIRONMENT defaults to 'production'");
}

// ─── Owner account ───────────────────────────────────────────────────────────

if (!present("FOUNDER_EMAIL")) {
  (isProd ? fail : warn)("FOUNDER_EMAIL", "unset — owner enterprise bypass is inactive (index.ts warns at boot)");
} else {
  ok("FOUNDER_EMAIL");
}

// ─── Slack (all-or-nothing, mirrors src/index.ts conditional requirement) ────

const slackVars = ["SLACK_SIGNING_SECRET", "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"];
const slackSet = slackVars.filter(present);
if (slackSet.length > 0 && slackSet.length < slackVars.length) {
  fail("Slack config", `partial — ${slackSet.length}/3 set; the API exits at boot when Slack is half-configured`);
} else if (slackSet.length === slackVars.length) {
  ok("Slack config", "fully configured");
} else {
  ok("Slack config", "not configured (Slack integration disabled — fine)");
}

// ─── Connectors (pairs must be complete or absent) ──────────────────────────

for (const [label, a, b] of [
  ["Notion connector", "NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"],
  ["Google Docs connector", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
] as const) {
  const set = [a, b].filter(present).length;
  if (set === 1) warn(label, "half-configured — worker will be silently disabled");
  else ok(label, set === 2 ? "enabled" : "disabled");
}

// ─── Report ──────────────────────────────────────────────────────────────────

const failCount = findings.filter((f) => f.level === "FAIL").length;
const warnCount = findings.filter((f) => f.level === "WARN").length;
const pad = Math.max(...findings.map((f) => f.name.length));

console.log(`\nAnansi preflight — NODE_ENV=${env.NODE_ENV ?? "(unset)"}\n`);
for (const f of findings) {
  const icon = f.level === "FAIL" ? "✗" : f.level === "WARN" ? "!" : "✓";
  console.log(`  ${icon} ${f.level.padEnd(4)} ${f.name.padEnd(pad)}  ${f.detail}`);
}
console.log(`\n${failCount} failure(s), ${warnCount} warning(s)`);

if (failCount > 0) {
  console.log("\nNOT READY — fix the failures above before deploying.\n");
  process.exit(1);
}
console.log(warnCount > 0 ? "\nREADY (with warnings — review them deliberately).\n" : "\nREADY.\n");
