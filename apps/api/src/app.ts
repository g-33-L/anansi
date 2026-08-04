import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { timingSafeEqual, createHmac } from "crypto";
import slackRoutes from "./routes/slack.js";
import { billingRoutes } from "./routes/billing.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { memoryViewRoutes } from "./routes/memory-view.js";
import { landingRoutes } from "./routes/landing.js";
import { docsRoutes } from "./routes/docs/index.js";
import { v1Routes } from "./routes/v1.js";
import { connectorRoutes } from "./routes/connectors.js";
import { consoleRoutes } from "./routes/console/index.js";
import { ssoRoutes } from "./routes/sso.js";
import { scimRoutes } from "./routes/scim.js";
import { correlationId, getCorrelationId } from "./lib/middleware/correlation-id.js";
import { getEmbedStats, EmbeddingProviderUnavailableError, probeEmbeddingProvider } from "./lib/ai/embed.js";
import { captureError } from "./lib/infra/error-reporting.js";
import { getDeploymentConfig } from "./lib/config/deployment.js";
import { readFileSync } from "fs";

// Content-Security-Policy. Third-party analytics (Plausible) is only permitted when
// the deployment mode allows telemetry — under local/air-gapped mode the browser is
// not even allowed to reach it (defense-in-depth on top of not emitting the script).
function buildCsp(): string {
  const analytics = getDeploymentConfig().telemetryAllowed;
  const scriptSrc = `'self' 'unsafe-inline'${analytics ? " https://plausible.io" : ""}`;
  const connectSrc = `'self' https://fonts.googleapis.com${analytics ? " https://plausible.io" : ""}`;
  return (
    `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; ` +
    `font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src ${connectSrc}; frame-ancestors 'none'`
  );
}

// Resolved from package.json because production starts the server directly
// (node dist/index.js), where npm_package_version is not populated.
const API_VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  } catch {
    return process.env.npm_package_version ?? "unknown";
  }
})();

export function createApp() {
  const app = new Hono();

  // Correlation ID — first, so every downstream log/audit/response carries it.
  app.use("*", correlationId);

  // API-Version header — lets clients detect the current API version from any response
  app.use("/v1/*", async (c, next) => {
    await next();
    c.res.headers.set("API-Version", "v1");
  });

  // Security headers on all responses
  app.use("*", async (c, next) => {
    await next();
    c.res.headers.set("X-Content-Type-Options", "nosniff");
    c.res.headers.set("X-Frame-Options", "DENY");
    c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    c.res.headers.set("X-XSS-Protection", "1; mode=block");
    // HSTS — only in production where HTTPS is guaranteed
    if (process.env.NODE_ENV === "production") {
      c.res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }
    // Only set CSP on HTML responses — JSON and binary responses don't need it
    const ct = c.res.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) {
      c.res.headers.set("Content-Security-Policy", buildCsp());
      c.res.headers.set("Cache-Control", "no-store");
    }
  });

  // Structured request logging — every request tagged with path, method, status, duration.
  // workspaceId is intentionally omitted here: the x-workspace-id header is caller-supplied
  // and not authenticated at this middleware level, so logging it would allow log injection.
  // Authenticated routes log workspaceId from their own verified context.
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    console.log(
      JSON.stringify({
        event: "request",
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        durationMs: Date.now() - start,
        correlationId: getCorrelationId(c),
      })
    );
  });

  app.use("/public/*", serveStatic({ root: "./" }));

  app.route("/", landingRoutes);
  app.route("/docs", docsRoutes);
  app.get("/health", (c) => c.json({ status: "ok", version: API_VERSION }));

  // ─── Status page (public, no auth) ─────────────────────────────────────────
  // Server-rendered HTML reporting Postgres, Redis, and queue liveness plus the
  // running API version. Dependency-light: uses the already-open pool and redis
  // client; does not import any business logic.
  app.get("/status", async (c) => {
    const { pool } = await import("./lib/db/index.js");
    const { redis } = await import("./lib/infra/queue.js");
    const version = API_VERSION;

    // Run all checks in parallel; each resolves to an ok/error pair.
    const [pgResult, redisResult] = await Promise.allSettled([
      (async () => {
        const client = await pool.connect();
        try {
          await client.query("SELECT 1");
        } finally {
          client.release();
        }
      })(),
      redis.ping(),
    ]);

    const embed = await probeEmbeddingProvider();

    const pgOk = pgResult.status === "fulfilled";
    const redisOk = redisResult.status === "fulfilled";
    // Queue liveness is inferred from Redis — BullMQ uses the same connection.
    const queueOk = redisOk;

    // The embedding backend counts toward health: without it, ingestion cannot
    // embed and /v1/context cannot search, so reporting "operational" would be
    // false. This is the check whose absence let a broken first-run install
    // present as fully green.
    const allOk = pgOk && redisOk && embed.ok;
    const httpStatus = allOk ? 200 : 503;

    const dot = (ok: boolean) =>
      `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${ok ? "#30d158" : "#ff453a"};margin-right:8px;vertical-align:middle"></span>`;
    const row = (label: string, ok: boolean, detail = "") =>
      `<tr><td style="padding:10px 16px;font-weight:600;color:#f5f5f7">${dot(ok)}${label}</td><td style="padding:10px 16px;color:${ok ? "#30d158" : "#ff453a"}">${ok ? "ok" : "error"}${detail ? `<span style="color:#636366;font-size:.8em;margin-left:8px">${detail}</span>` : ""}</td></tr>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Status — Anansi</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',Inter,sans-serif;background:#1a1a1c;color:#f5f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .box{max-width:480px;width:100%;padding:40px 24px}
    h1{font-size:1.5rem;font-weight:700;margin-bottom:4px}
    .sub{color:#636366;font-size:.85rem;margin-bottom:28px}
    table{width:100%;border-collapse:collapse;background:#232326;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden}
    tr+tr{border-top:1px solid rgba(255,255,255,.06)}
    .version{margin-top:20px;font-size:.75rem;color:#636366;text-align:right}
  </style>
</head>
<body>
  <div class="box">
    <h1>${allOk ? "All systems operational" : "Service degraded"}</h1>
    <p class="sub">Checked ${new Date().toUTCString()}</p>
    <table>
      ${row("Postgres", pgOk)}
      ${row("Redis", redisOk)}
      ${row("Queue", queueOk, "(via Redis)")}
      ${row(`Embeddings (${embed.provider})`, embed.ok, embed.detail)}
    </table>
    <p class="version">API version ${version}</p>
  </div>
</body>
</html>`;

    return c.html(html, httpStatus);
  });

  app.get("/robots.txt", (c) =>
    c.text(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /portal",
        "Disallow: /dashboard",
        "Disallow: /onboarding",
        "Disallow: /memory",
        "Disallow: /connectors",
        "Disallow: /billing",
        "Disallow: /slack",
        "Disallow: /metrics",
        "",
        `Sitemap: ${process.env.APP_URL ?? "https://anansimemory.com"}/sitemap.xml`,
      ].join("\n")
    )
  );

  app.get("/metrics", (c) => {
    const key = process.env.QUERY_API_KEY;
    const provided = c.req.header("authorization");
    if (!key || !provided) return c.json({ error: "Unauthorized" }, 401);
    // Hash both to equal-length digests before comparing — prevents timing oracle via length differences
    const expected = createHmac("sha256", "metrics").update(`Bearer ${key}`).digest();
    const got = createHmac("sha256", "metrics").update(provided).digest();
    if (!timingSafeEqual(expected, got)) return c.json({ error: "Unauthorized" }, 401);
    return c.json({ embed: getEmbedStats() });
  });

  app.route("/slack", slackRoutes);

  app.route("/v1", v1Routes);
  app.route("/connectors", connectorRoutes);
  app.route("/billing", billingRoutes);
  app.route("/onboarding", onboardingRoutes);
  app.route("/dashboard", dashboardRoutes);
  app.route("/memory", memoryViewRoutes);
  app.route("/console", consoleRoutes);
  app.route("/sso", ssoRoutes); // public: IdP-initiated + OIDC callback → session
  app.route("/scim/v2", scimRoutes); // public: SCIM 2.0, per-org bearer token

  // Sitemap — only public-facing pages
  app.get("/sitemap.xml", (c) => {
    const base = process.env.APP_URL ?? "https://anansimemory.com";
    const pages = ["/", "/docs", "/docs/quickstart", "/docs/api-reference", "/docs/landscape", "/docs/faq", "/docs/guides/claude-chatbot", "/docs/guides/voice-agent", "/docs/guides/multi-agent", "/docs/guides/tool-actions", "/docs/guides/onboarding", "/docs/guides/notion", "/docs/guides/meetings", "/docs/guides/entity-graph", "/docs/guides/temporal-memory", "/docs/guides/metadata-filters", "/docs/guides/slack-memory", "/privacy", "/terms"];
    const urls = pages.map((p) => `  <url><loc>${base}${p}</loc></url>`).join("\n");
    return c.text(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`, 200, {
      "Content-Type": "application/xml",
    });
  });

  // 404 handler — catches any route not matched above
  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (accept.includes("application/json") || c.req.path.startsWith("/v1")) {
      return c.json({ error: "Not found" }, 404);
    }
    return c.html(errorPage("404 — Page not found", "The page you're looking for doesn't exist.", "/"), 404);
  });

  // 500 handler — catches unhandled errors thrown in any route
  app.onError((err, c) => {
    const path = new URL(c.req.url).pathname;
    console.error(JSON.stringify({ event: "unhandled_error", path, error: err.message, stack: err.stack?.slice(0, 400) }));
    captureError(err, { path, method: c.req.method });
    const accept = c.req.header("accept") ?? "";
    const wantsJson = accept.includes("application/json") || c.req.path.startsWith("/v1");

    /*
     * A missing embedding backend is a dependency outage, not a bug, and it is
     * the most common first-run failure: `docker compose up` does not start
     * Ollama, so the very first /v1/context call fails. Reporting it as a
     * generic 500 hid both the cause and the fix. 503 is the honest status —
     * the request would succeed once the dependency is up — and it tells
     * clients the call is worth retrying.
     */
    if (err instanceof EmbeddingProviderUnavailableError) {
      if (wantsJson) {
        return c.json({ error: err.publicMessage(), code: "embedding_provider_unavailable" }, 503);
      }
      return c.html(errorPage("Embedding provider unavailable", err.publicMessage(), "/"), 503);
    }

    if (wantsJson) {
      return c.json({ error: "Internal server error" }, 500);
    }
    return c.html(errorPage("Something went wrong", "An unexpected error occurred. Try again in a moment.", "/"), 500);
  });

  return app;
}

function htmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function errorPage(title: string, message: string, backHref: string): string {
  const t = htmlEsc(title);
  const m = htmlEsc(message);
  const h = htmlEsc(backHref);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${t} — Anansi</title>
  <style>
    body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9f9f9;color:#111}
    .box{text-align:center;max-width:420px;padding:40px 24px}
    h1{font-size:1.5rem;font-weight:800;color:#4a154b;margin-bottom:8px}
    p{color:#6b7280;line-height:1.6;margin-bottom:24px}
    a{display:inline-block;background:#4a154b;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:.9rem}
  </style>
</head>
<body>
  <div class="box">
    <h1>${t}</h1>
    <p>${m}</p>
    <a href="${h}">Go home</a>
  </div>
</body>
</html>`;
}
