/*
 * Correlation-ID middleware (Phase 8, ADR-0006). Every request gets a stable id,
 * echoed in the `X-Correlation-Id` response header and readable via
 * getCorrelationId(c). Operator audit events and (where wired) worker jobs carry
 * it, so an operator can trace an action across HTTP → queue → log without shell
 * access. An inbound `X-Correlation-Id` is honored (client/proxy tracing) but
 * length-capped to prevent log injection / unbounded values.
 */
import crypto from "crypto";
import type { Context, Next } from "hono";

const HEADER = "x-correlation-id";
const MAX_LEN = 128;
const SAFE = /^[A-Za-z0-9._:-]+$/;

export async function correlationId(c: Context, next: Next): Promise<void> {
  const inbound = c.req.header(HEADER);
  const id =
    inbound && inbound.length <= MAX_LEN && SAFE.test(inbound)
      ? inbound
      : crypto.randomUUID();
  c.set("correlationId", id);
  c.res.headers.set("X-Correlation-Id", id);
  await next();
  // Some handlers replace c.res; make sure the header survives.
  if (!c.res.headers.get("X-Correlation-Id")) c.res.headers.set("X-Correlation-Id", id);
}

export function getCorrelationId(c: Context): string | null {
  return (c.get("correlationId") as string | undefined) ?? null;
}
