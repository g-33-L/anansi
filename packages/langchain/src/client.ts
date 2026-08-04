// Minimal Anansi HTTP client shared by the retriever, tools, and graph nodes.

export interface AnansiConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface AnansiContextResponse {
  static?: string[];
  dynamic?: string[];
  temporal?: Array<{ fact: string; validFrom?: string | null; validUntil?: string | null }>;
  relevant?: Array<{ content: string; similarity: number; metadata: Record<string, unknown> }>;
}

export interface AnansiSearchHit {
  content: string;
  score: number;
  sourceId: string;
  metadata: Record<string, unknown>;
}

const DEFAULT_BASE_URL = "https://anansimemory.com";

export async function anansiRequest<T>(
  config: AnansiConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<T> {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    let message = `Anansi API error ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {}
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function formatContext(ctx: AnansiContextResponse): string {
  const lines: string[] = [];
  if (ctx.static?.length) {
    lines.push("## User — Stable facts");
    ctx.static.forEach((f) => lines.push(`- ${f}`));
  }
  if (ctx.dynamic?.length) {
    if (lines.length > 0) lines.push("");
    lines.push("## User — Current context");
    ctx.dynamic.forEach((d) => lines.push(`- ${d}`));
  }
  if (ctx.relevant?.length) {
    if (lines.length > 0) lines.push("");
    lines.push("## Relevant history");
    ctx.relevant.forEach((r) => lines.push(`- ${r.content}`));
  }
  return lines.join("\n");
}
