// Lightweight error reporting: posts to Sentry's HTTP envelope API directly,
// with no SDK import overhead. Falls back silently if SENTRY_DSN is not set.
// Set SENTRY_DSN in env to enable. Set SENTRY_ENVIRONMENT to tag events (default: production).

import { getDeploymentConfig } from "../config/deployment.js";

const DSN = process.env.SENTRY_DSN;
const ENVIRONMENT = process.env.SENTRY_ENVIRONMENT ?? "production";
const RELEASE = process.env.npm_package_version ?? "unknown";

interface SentryDsnParts {
  key: string;
  host: string;
  projectId: string;
}

function parseDsn(dsn: string): SentryDsnParts | null {
  try {
    const url = new URL(dsn);
    const key = url.username;
    const host = url.hostname;
    const projectId = url.pathname.replace("/", "");
    if (!key || !host || !projectId) return null;
    return { key, host, projectId };
  } catch {
    return null;
  }
}

function buildEnvelopeUrl(parts: SentryDsnParts): string {
  return `https://${parts.host}/api/${parts.projectId}/envelope/`;
}

function buildEnvelopePayload(err: Error, context?: Record<string, unknown>): string {
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const now = Math.floor(Date.now() / 1000);

  const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: DSN });

  const itemHeader = JSON.stringify({ type: "event" });

  const event = JSON.stringify({
    event_id: eventId,
    timestamp: now,
    platform: "node",
    environment: ENVIRONMENT,
    release: RELEASE,
    level: "error",
    exception: {
      values: [
        {
          type: err.name ?? "Error",
          value: err.message,
          stacktrace: {
            frames: parseStack(err.stack ?? ""),
          },
        },
      ],
    },
    ...(context ? { extra: context } : {}),
  });

  return `${header}\n${itemHeader}\n${event}`;
}

function parseStack(stack: string): Array<{ filename: string; function: string; lineno?: number; colno?: number }> {
  return stack
    .split("\n")
    .slice(1) // drop the first line (the error message)
    .slice(0, 20) // cap at 20 frames
    .map((line) => {
      const m = line.trim().match(/at (.+?) \((.+?):(\d+):(\d+)\)/) ??
                line.trim().match(/at (.+?):(\d+):(\d+)/);
      if (!m) return { filename: line.trim(), function: "<unknown>" };
      if (m.length === 5) {
        return { function: m[1], filename: m[2], lineno: parseInt(m[3], 10), colno: parseInt(m[4], 10) };
      }
      return { function: "<anonymous>", filename: m[1], lineno: parseInt(m[2], 10), colno: parseInt(m[3], 10) };
    });
}

export function captureError(err: Error, context?: Record<string, unknown>): void {
  // Telemetry can carry content (error messages, stack, extra context) off-box, so
  // it is disabled whenever the deployment mode forbids content-exporting telemetry.
  if (!DSN || !getDeploymentConfig().telemetryAllowed) return;

  const parts = parseDsn(DSN);
  if (!parts) {
    console.error("[sentry] Invalid SENTRY_DSN — skipping error report");
    return;
  }

  const envelope = buildEnvelopePayload(err, context);
  const url = buildEnvelopeUrl(parts);

  // Fire-and-forget: error reporting must never crash the server
  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=anansi/1.0, sentry_key=${parts.key}`,
    },
    body: envelope,
  }).catch((e) => {
    console.error("[sentry] Delivery failed:", (e as Error).message);
  });
}

export function captureMessage(message: string, level: "info" | "warning" | "error" = "info"): void {
  if (!DSN || !getDeploymentConfig().telemetryAllowed) return;

  const parts = parseDsn(DSN);
  if (!parts) return;

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const header = JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: DSN });
  const itemHeader = JSON.stringify({ type: "event" });
  const event = JSON.stringify({
    event_id: eventId,
    timestamp: Math.floor(Date.now() / 1000),
    platform: "node",
    environment: ENVIRONMENT,
    release: RELEASE,
    level,
    message,
  });

  fetch(buildEnvelopeUrl(parts), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=anansi/1.0, sentry_key=${parts.key}`,
    },
    body: `${header}\n${itemHeader}\n${event}`,
  }).catch(() => {});
}
