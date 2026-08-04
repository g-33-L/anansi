const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

export async function downloadSlackFile(
  urlPrivate: string,
  botToken: string
): Promise<Buffer> {
  const parsed = new URL(urlPrivate);
  if (!parsed.hostname.endsWith(".slack.com")) {
    throw new Error(`Untrusted file URL hostname: ${parsed.hostname}`);
  }

  const res = await fetch(urlPrivate, {
    headers: { Authorization: `Bearer ${botToken}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`Failed to download Slack file: ${res.status} ${res.statusText}`);
  }

  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > MAX_FILE_BYTES) {
    throw new Error(`Slack file too large: ${contentLength} bytes (max ${MAX_FILE_BYTES})`);
  }

  return Buffer.from(await res.arrayBuffer());
}
