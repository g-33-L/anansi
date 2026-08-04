import { assertPublicTarget } from "../url-ingest.js";
import { safeFetch } from "./safe-fetch.js";

const MAX_RETRIES = 3;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECT_HOPS = 3;

// Same SSRF policy as URL ingestion: resolve DNS and verify every address is
// public, rather than pattern-matching the hostname (a hostname check alone is
// bypassed by any domain the caller points at a private IP). Resolution happens
// once per delivery, immediately before the fetch — the residual rebinding
// window between check and fetch is accepted for now.
export async function assertSafeWebhookUrl(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid webhook URL`);
  }
  if (url.protocol !== "https:") throw new Error("Webhook URL must use https");
  await assertPublicTarget(url);
}

export interface WebhookPayload {
  event: "memory.updated";
  workspaceId: string;
  memoryUserId?: string;
  version: number;
  synthesizedAt: string;
}

// POSTs the payload with redirects followed manually (same pattern as
// fetchUrlContent in url-ingest.ts): the default `redirect: "follow"` would let
// a registered public https URL 3xx-redirect the delivery to an internal
// address AFTER the pre-check passed. Every redirect target is re-validated
// against the same SSRF policy (https + public target) before it is fetched,
// capped at MAX_REDIRECT_HOPS. The payload is re-POSTed on each hop.
async function postWithSafeRedirects(rawUrl: string, body: string): Promise<Response> {
  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  let url = new URL(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    // Hop 0 (the registered URL) is validated by fireWebhook before any attempt;
    // redirect targets are attacker-influenced and must pass the same checks.
    if (hop > 0) await assertSafeWebhookUrl(url.toString());

    const res = await safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      redirect: "manual",
      signal: deadline,
    });

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      // 3xx without a Location can't be followed — return it as the final
      // (non-ok) response so the retry loop treats it as a failed delivery.
      if (!location) return res;
      if (hop === MAX_REDIRECT_HOPS) throw new Error("Webhook redirected too many times");
      url = new URL(location, url);
      continue;
    }

    return res;
  }

  // Unreachable — every loop iteration returns or throws by the last hop.
  throw new Error("Webhook redirected too many times");
}

// Delivers an outbound webhook with exponential backoff. Fire-and-forget safe.
export async function fireWebhook(url: string, payload: WebhookPayload): Promise<void> {
  await assertSafeWebhookUrl(url);
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await postWithSafeRedirects(url, body);
      if (res.ok) return;
      console.warn(`[webhook] ${url} responded ${res.status} (attempt ${attempt + 1})`);
    } catch (err) {
      console.warn(`[webhook] ${url} fetch failed (attempt ${attempt + 1}):`, err);
    }
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); // 1s, 2s, 4s
    }
  }
  console.error(`[webhook] Failed to deliver to ${url} after ${MAX_RETRIES} attempts`);
}
