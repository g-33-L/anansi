// anansi-ai-sdk — Vercel AI SDK middleware for Anansi memory.
// withAnansi() wraps any LanguageModel: before each call it fetches the user's
// synthesized profile from GET /v1/context and prepends it as a system message;
// after the call it can auto-ingest the user's turn via POST /v1/ingest.
//
// The wrapper is structural (intercepts doGenerate/doStream on the model
// object), so it works with both LanguageModelV1 and V2 implementations
// without a hard dependency on the `ai` package.

export interface WithAnansiOptions {
  apiKey: string;
  userId: string;
  /**
   * profile — inject static+dynamic profile only (no search)
   * query   — inject relevant[] matched against the latest user message
   * full    — both (default)
   */
  mode?: "profile" | "query" | "full";
  /** Auto-ingest each user message as a conversation turn (default false) */
  ingestAfter?: boolean;
  baseUrl?: string;
  /** Tag ingested turns with a session for session-scoped retrieval */
  sessionId?: string;
}

// Minimal structural view of an AI SDK language model — enough to intercept
// calls without depending on `ai` types.
export interface AnansiWrappableModel {
  doGenerate(options: unknown): PromiseLike<unknown>;
  doStream(options: unknown): PromiseLike<unknown>;
}

interface PromptMessage {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

interface ContextResponse {
  static?: string[];
  dynamic?: string[];
  temporal?: Array<{ fact: string; validFrom?: string | null; validUntil?: string | null }>;
  relevant?: Array<{ content: string }>;
}

const DEFAULT_BASE_URL = "https://anansimemory.com";

function resolveBaseUrl(options: WithAnansiOptions): string {
  return (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

// Latest user message text — used as the search query and for auto-ingest.
// Handles both string content and the AI SDK's array-of-parts format.
function extractLatestUserText(prompt: PromptMessage[]): string | undefined {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const message = prompt[i];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      const text = message.content
        .filter((part): part is { type: string; text: string } =>
          typeof part === "object" && part !== null &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string")
        .map((part) => part.text)
        .join("\n");
      if (text) return text;
    }
    return undefined;
  }
  return undefined;
}

function formatContext(ctx: ContextResponse): string {
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
  if (ctx.temporal?.length) {
    if (lines.length > 0) lines.push("");
    lines.push("## User — Timeline");
    ctx.temporal.forEach((t) => {
      const range = t.validUntil ? `${t.validFrom ?? "?"} → ${t.validUntil}` : `since ${t.validFrom ?? "?"}`;
      lines.push(`- ${t.fact} (${range})`);
    });
  }
  if (ctx.relevant?.length) {
    if (lines.length > 0) lines.push("");
    lines.push("## Relevant history");
    ctx.relevant.forEach((r) => lines.push(`- ${r.content}`));
  }
  return lines.join("\n");
}

async function fetchContext(
  options: WithAnansiOptions,
  query: string | undefined
): Promise<string | undefined> {
  const mode = options.mode ?? "full";
  const params = new URLSearchParams({ userId: options.userId });
  if (mode !== "profile" && query) params.set("q", query);

  try {
    const res = await fetch(`${resolveBaseUrl(options)}/v1/context?${params}`, {
      headers: { Authorization: `Bearer ${options.apiKey}` },
    });
    if (!res.ok) {
      console.warn(`[anansi] context fetch failed: ${res.status}`);
      return undefined;
    }
    const ctx = (await res.json()) as ContextResponse;
    // query mode: relevant[] only — drop the profile sections
    const view: ContextResponse = mode === "query" ? { relevant: ctx.relevant } : ctx;
    const formatted = formatContext(view);
    return formatted || undefined;
  } catch (err) {
    console.warn("[anansi] context fetch failed:", err);
    return undefined;
  }
}

// Fire-and-forget — memory writes must never delay or fail the model response
function ingestTurn(options: WithAnansiOptions, content: string): void {
  fetch(`${resolveBaseUrl(options)}/v1/ingest`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: options.userId,
      content,
      sourceType: "conversation",
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    }),
  }).catch((err) => console.warn("[anansi] ingest failed:", err));
}

async function transformCallOptions(
  options: WithAnansiOptions,
  callOptions: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const prompt = callOptions.prompt;
  if (!Array.isArray(prompt)) return callOptions;

  const userText = extractLatestUserText(prompt as PromptMessage[]);
  const contextText = await fetchContext(options, userText);

  if (options.ingestAfter && userText?.trim()) {
    ingestTurn(options, userText);
  }

  if (!contextText) return callOptions;

  const memoryMessage: PromptMessage = {
    role: "system",
    content: `The following is persistent memory about this user from previous sessions:\n\n${contextText}`,
  };
  return { ...callOptions, prompt: [memoryMessage, ...prompt] };
}

/**
 * Wrap an AI SDK language model with Anansi memory.
 *
 * ```ts
 * const model = withAnansi(openai('gpt-4o'), {
 *   apiKey: 'ans_...',
 *   userId: 'user_123',
 *   mode: 'full',
 *   ingestAfter: true,
 * });
 * const result = await generateText({ model, prompt: '...' });
 * ```
 */
export function withAnansi<T extends AnansiWrappableModel>(model: T, options: WithAnansiOptions): T {
  if (!options.apiKey) throw new Error("withAnansi: apiKey is required");
  if (!options.userId) throw new Error("withAnansi: userId is required");

  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop === "doGenerate" || prop === "doStream") {
        return async (callOptions: Record<string, unknown>) => {
          const transformed = await transformCallOptions(options, callOptions ?? {});
          return (target[prop] as (o: unknown) => PromiseLike<unknown>).call(target, transformed);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export default withAnansi;
