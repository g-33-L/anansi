// SSRF-safe fetch with a connection-time IP pin.
//
// The hostname pre-check (assertPublicTarget in url-ingest.ts) resolves+vets a
// host BEFORE fetch, but global fetch then does its OWN DNS resolution — a
// short-TTL attacker domain can answer "public" during the check and "private"
// (127.0.0.1, 169.254.169.254, RFC1918) during the connect (DNS rebinding).
//
// safeFetch closes that window: it routes fetch through an undici dispatcher
// whose custom `lookup` re-validates every resolved address and refuses the
// connection if any is private. undici connects to exactly the address this
// lookup returns, so the validated IP IS the connected IP — no second, unchecked
// resolution. The pre-check still runs first (defense in depth); this backstops
// the residual TOCTOU. See BUG_AUDIT M3.

import { Agent } from "undici";
import { lookup as dnsLookup, type LookupAddress } from "dns";
import { isIP } from "net";

// ─── Private-address classification ───────────────────────────────────────────
// (Lives here, the lowest layer, so url-ingest and outbound-webhook can share it
// without an import cycle through the fetch helper.)

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) return true; // fail closed
  const [a, b] = octets;
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) // 192.168/16
  );
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpv4(ip);
  const lower = ip.toLowerCase();
  // IPv4-mapped IPv6, dotted form (::ffff:10.0.0.1)
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  // IPv4-mapped IPv6, canonical hex form (::ffff:a00:1) — WHATWG URL parsing
  // normalizes the dotted form to this, so checking only the dotted spelling
  // lets e.g. https://[::ffff:127.0.0.1]/ through as "public"
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
  }
  return (
    lower === "::" ||
    lower === "::1" || // loopback
    lower.startsWith("fc") || lower.startsWith("fd") || // ULA fc00::/7
    lower.startsWith("fe8") || lower.startsWith("fe9") ||
    lower.startsWith("fea") || lower.startsWith("feb") // link-local fe80::/10
  );
}

// ─── Connection-time revalidating lookup ──────────────────────────────────────

interface LookupOpts { all?: boolean; family?: number; [k: string]: unknown }
type LookupCb = (
  err: NodeJS.ErrnoException | null,
  address?: string | LookupAddress[],
  family?: number
) => void;

// Matches Node's dns.lookup signature (the shape undici's connector calls). We
// force `all` at resolution so every returned address is checked, then answer in
// whichever shape the caller requested.
export function revalidatingLookup(hostname: string, options: LookupOpts, callback: LookupCb): void {
  dnsLookup(hostname, { verbatim: true, ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as LookupAddress[];
    for (const a of list) {
      if (isPrivateAddress(a.address)) {
        const e = new Error(`Blocked: ${hostname} resolved to private address ${a.address} (SSRF)`) as NodeJS.ErrnoException;
        e.code = "ESSRFBLOCKED";
        return callback(e);
      }
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

// Built once. If construction ever fails, safeFetch falls back to plain fetch —
// the hostname pre-check still protects; we just lose the connect-time pin.
let pinnedAgent: Agent | null | undefined;
function getPinnedAgent(): Agent | null {
  if (pinnedAgent !== undefined) return pinnedAgent;
  try {
    pinnedAgent = new Agent({ connect: { lookup: revalidatingLookup as never } });
  } catch (err) {
    console.warn("[safe-fetch] pinned dispatcher unavailable; using plain fetch:", (err as Error).message);
    pinnedAgent = null;
  }
  return pinnedAgent;
}

// Drop-in fetch that pins the connection to a re-validated public IP. Callers
// should STILL run their hostname pre-check first (protocol/host allow-listing);
// this only closes the check→connect rebinding gap.
export function safeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const dispatcher = getPinnedAgent();
  if (!dispatcher) return fetch(input, init);
  return fetch(input, { ...init, dispatcher } as unknown as RequestInit);
}
