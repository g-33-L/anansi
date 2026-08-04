export async function postMessage({
  token,
  channel,
  text,
  thread_ts,
}: {
  token: string;
  channel: string;
  text: string;
  thread_ts?: string;
}): Promise<void> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text, thread_ts }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`chat.postMessage failed: ${data.error ?? "unknown"}`);
  }
}

export async function postToResponseUrl(
  url: string,
  payload: { response_type: "ephemeral" | "in_channel"; text: string; replace_original?: boolean }
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`response_url POST failed: ${res.status}`);
  }
}
