import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY environment variable is required");
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
  }
  return buf;
}

// Returns base64(iv + authTag + ciphertext)
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Ciphertext too short — data may be corrupt");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8"
  );
}

// HMAC-SHA256 for CSRF state signing — uses a dedicated key, separate from the AES key
export function signState(state: string): string {
  const key = process.env.CSRF_SIGNING_KEY;
  if (!key) throw new Error("CSRF_SIGNING_KEY environment variable is required");
  return crypto.createHmac("sha256", key).update(state).digest("hex");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Signs an opaque value (e.g. a workspace id) so it can be stored in a cookie
// without being forgeable. Format: `<value>.<hmac>`. Uses CSRF_SIGNING_KEY so the
// signing key is separate from the AES ENCRYPTION_KEY.
export function signCookieValue(value: string): string {
  const key = process.env.CSRF_SIGNING_KEY;
  if (!key) throw new Error("CSRF_SIGNING_KEY environment variable is required");
  const mac = crypto.createHmac("sha256", key).update(value).digest("hex");
  return `${value}.${mac}`;
}

// Verifies a value produced by signCookieValue. Returns the original value, or
// null if the cookie is missing, malformed, or the signature doesn't match.
export function readSignedCookieValue(signed: string | undefined | null): string | null {
  if (!signed) return null;
  const key = process.env.CSRF_SIGNING_KEY;
  if (!key) return null;
  const sep = signed.lastIndexOf(".");
  if (sep === -1) return null;
  const value = signed.slice(0, sep);
  const mac = signed.slice(sep + 1);
  const expected = crypto.createHmac("sha256", key).update(value).digest("hex");
  if (!timingSafeEqual(mac, expected)) return null;
  return value;
}

// Short-lived HMAC token for the post-OAuth onboarding redirect (10-min TTL).
// Prevents unauthenticated access to /onboarding without a DB table.
// Uses CSRF_SIGNING_KEY (not ENCRYPTION_KEY) — AES keys must not be used as HMAC keys.
const INSTALL_TOKEN_TTL_MS = 10 * 60 * 1000;

export function generateInstallToken(workspaceId: string): string {
  const key = process.env.CSRF_SIGNING_KEY;
  if (!key) throw new Error("CSRF_SIGNING_KEY environment variable is required");
  const ts = Date.now().toString();
  const mac = crypto
    .createHmac("sha256", key)
    .update(`install:${workspaceId}:${ts}`)
    .digest("hex");
  return Buffer.from(JSON.stringify({ w: workspaceId, ts, mac })).toString(
    "base64url"
  );
}

export function verifyInstallToken(token: string): string | null {
  try {
    const key = process.env.CSRF_SIGNING_KEY;
    if (!key) return null;
    const { w: workspaceId, ts, mac } = JSON.parse(
      Buffer.from(token, "base64url").toString()
    );
    const expected = crypto
      .createHmac("sha256", key)
      .update(`install:${workspaceId}:${ts}`)
      .digest("hex");
    if (!timingSafeEqual(mac, expected)) return null;
    if (Date.now() - parseInt(ts, 10) > INSTALL_TOKEN_TTL_MS) return null;
    return workspaceId as string;
  } catch {
    return null;
  }
}
