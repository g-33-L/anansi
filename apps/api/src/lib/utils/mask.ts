// Masks PII (emails, client IPs) before it is written to stdout logs.
// Log lines must never contain a full email address or IP — mask at the
// call site with these helpers rather than logging the raw value.

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/;

/**
 * Masks an email address for logging: keeps the first character of the
 * local part and the full domain, replaces the rest with `***`.
 *
 * `alice@example.com` → `a***@example.com`
 *
 * Anything that doesn't look like an email (empty, no `@`) collapses to
 * `"***"` so a malformed value can never leak through unmasked.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Masks a client IP for logging. IPv4 keeps the first two octets and
 * masks the rest: `203.0.113.4` → `203.0.*.*`. Anything that isn't a
 * plain IPv4 address (IPv6, "unknown", garbage) collapses to `"***"`.
 */
export function maskIp(ip: string): string {
  const match = IPV4_PATTERN.exec(ip);
  if (!match) return "***";
  return `${match[1]}.${match[2]}.*.*`;
}
