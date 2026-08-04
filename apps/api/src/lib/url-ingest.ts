// URL ingestion — fetch a URL server-side and extract its text content.
// Used by POST /v1/ingest when the content field is a URL.

import { lookup } from "dns/promises";
import { isIP } from "net";
import { isPrivateAddress, safeFetch } from "./infra/safe-fetch.js";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_FETCH_BYTES = 500 * 1024; // 500 KB
const MAX_REDIRECTS = 3;

export class UrlIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlIngestError";
  }
}

// Content is treated as a URL when the whole (trimmed) value is a single
// http(s) URL — text that merely mentions a URL is ingested as-is.
export function isUrlContent(content: string): boolean {
  const trimmed = content.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (/\s/.test(trimmed)) return false;
  try {
    new URL(trimmed);
    return true;
  } catch {
    return false;
  }
}

// ─── SSRF guard ───────────────────────────────────────────────────────────────
// Blocks loopback, link-local, RFC1918, CGNAT, and ULA targets so an API caller
// can't use the ingest fetcher to probe internal infrastructure. The private-
// address classifier lives in infra/safe-fetch.ts (shared with the connect-time
// IP pin); this is the pre-check that runs before the fetch.

// Exported for reuse by outbound-webhook.ts — same SSRF policy for both
// server-side fetch paths (URL ingestion and webhook delivery).
export async function assertPublicTarget(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlIngestError("Only http:// and https:// URLs are supported");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new UrlIngestError("URL resolves to a private address");
    return;
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw new UrlIngestError("URL resolves to a private address");
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UrlIngestError(`Could not resolve host: ${hostname}`);
  }
  if (addresses.length === 0) throw new UrlIngestError(`Could not resolve host: ${hostname}`);
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UrlIngestError("URL resolves to a private address");
  }
}

// ─── HTML → text ──────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

export function htmlToText(html: string): { text: string; title?: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, " ").trim() : undefined;

  const text = decodeEntities(
    html
      // Drop non-content blocks entirely
      .replace(/<(script|style|noscript|svg|template|head)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Preserve paragraph structure for block-level boundaries
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|blockquote|pre)>/gi, "\n")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, title: title || undefined };
}

// ─── Fetcher ──────────────────────────────────────────────────────────────────

async function readBodyCapped(res: Response): Promise<string> {
  const declared = res.headers.get("content-length");
  if (declared && Number(declared) > MAX_FETCH_BYTES) {
    throw new UrlIngestError("URL content exceeds 500 KB limit");
  }

  if (!res.body) return "";

  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_FETCH_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new UrlIngestError("URL content exceeds 500 KB limit");
    }
    parts.push(value);
  }
  return Buffer.concat(parts).toString("utf-8");
}

export interface UrlContent {
  url: string;
  text: string;
  title?: string;
}

// Fetches a URL and returns its text content. HTML is stripped to plain text;
// other text/* and JSON bodies are returned as-is. Throws UrlIngestError on any
// failure (timeout, non-2xx, oversized body, non-text content, private target).
export async function fetchUrlContent(rawUrl: string): Promise<UrlContent> {
  const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = new URL(rawUrl.trim());

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicTarget(url);

    let res: Response;
    try {
      // Manual redirects so every hop goes through the SSRF guard; safeFetch pins
      // the connection to a re-validated public IP (blocks DNS rebinding).
      res = await safeFetch(url, {
        redirect: "manual",
        signal: deadline,
        headers: { "User-Agent": "AnansiBot/1.0 (+https://anansimemory.com)", Accept: "text/html, text/*;q=0.9, application/json;q=0.8" },
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new UrlIngestError("URL fetch timed out after 10 seconds");
      }
      throw new UrlIngestError(`Could not fetch URL: ${err instanceof Error ? err.message : "network error"}`);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!location) throw new UrlIngestError(`URL returned redirect ${res.status} without a Location header`);
      if (hop === MAX_REDIRECTS) throw new UrlIngestError("URL redirected too many times");
      url = new URL(location, url);
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new UrlIngestError(`URL returned status ${res.status}`);
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
    const isText =
      isHtml || contentType.startsWith("text/") || contentType.includes("application/json") ||
      contentType.includes("application/xml") || contentType === "";
    if (!isText) {
      await res.body?.cancel().catch(() => undefined);
      throw new UrlIngestError(`Unsupported content type: ${contentType.split(";")[0] || "unknown"}`);
    }

    const body = await readBodyCapped(res);
    if (isHtml) {
      const { text, title } = htmlToText(body);
      return { url: url.toString(), text, title };
    }
    return { url: url.toString(), text: body.trim() };
  }

  throw new UrlIngestError("URL redirected too many times");
}
