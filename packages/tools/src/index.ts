// anansi-tools — framework-agnostic remember/recall tool definitions.
// Zero dependencies: tool parameters are plain JSON Schema objects, so the same
// pair plugs into the Vercel AI SDK (via jsonSchema()), OpenAI function
// calling / Agents SDK, or any framework that accepts JSON Schema tools.

export interface AnansiToolsConfig {
  apiKey: string;
  userId: string;
  baseUrl?: string;
}

export interface JSONSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** AI SDK-style tool: pass `parameters` through ai's jsonSchema() helper. */
export interface AnansiTool {
  description: string;
  parameters: JSONSchema;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}

export interface OpenAIToolkit {
  /** Pass as the `tools` array on a chat.completions / responses request */
  tools: OpenAIToolDefinition[];
  /** Dispatch a tool call by name with its parsed arguments */
  execute: (name: string, args: Record<string, unknown>) => Promise<string>;
}

const DEFAULT_BASE_URL = "https://anansimemory.com";

const REMEMBER_DESCRIPTION =
  "Save an important fact, preference, or event about the user to long-term memory. " +
  "Use when the user shares durable information worth recalling in future conversations.";

const RECALL_DESCRIPTION =
  "Search the user's long-term memory for facts, preferences, and past context relevant to a query. " +
  "Use before answering questions that may depend on what the user said in earlier sessions.";

const REMEMBER_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    content: {
      type: "string",
      description: "The fact or event to remember, phrased as a standalone statement",
    },
  },
  required: ["content"],
  additionalProperties: false,
};

const RECALL_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description: "What to look up in the user's memory",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

async function apiRequest(
  config: AnansiToolsConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<Record<string, unknown>> {
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
  return (await res.json()) as Record<string, unknown>;
}

async function executeRemember(config: AnansiToolsConfig, args: Record<string, unknown>): Promise<string> {
  const content = args.content;
  if (typeof content !== "string" || !content.trim()) return "Nothing to remember — content was empty.";
  await apiRequest(config, "POST", "/v1/ingest", {
    userId: config.userId,
    content,
    sourceType: "conversation",
  });
  return "Saved to memory.";
}

async function executeRecall(config: AnansiToolsConfig, args: Record<string, unknown>): Promise<string> {
  const query = args.query;
  if (typeof query !== "string" || !query.trim()) return "No query provided.";
  const params = new URLSearchParams({ userId: config.userId, q: query });
  const ctx = (await apiRequest(config, "GET", `/v1/context?${params}`)) as {
    static?: string[];
    dynamic?: string[];
    relevant?: Array<{ content: string }>;
  };

  const lines: string[] = [];
  if (ctx.static?.length) lines.push("Stable facts:", ...ctx.static.map((f) => `- ${f}`));
  if (ctx.dynamic?.length) lines.push("Current context:", ...ctx.dynamic.map((d) => `- ${d}`));
  if (ctx.relevant?.length) lines.push("Relevant history:", ...ctx.relevant.map((r) => `- ${r.content}`));
  return lines.length ? lines.join("\n") : "No memories found for that query.";
}

export function anansiTools(config: AnansiToolsConfig): { remember: AnansiTool; recall: AnansiTool };
export function anansiTools(config: AnansiToolsConfig, options: { format: "openai" }): OpenAIToolkit;
export function anansiTools(
  config: AnansiToolsConfig,
  options?: { format?: "ai-sdk" | "openai" }
): { remember: AnansiTool; recall: AnansiTool } | OpenAIToolkit {
  if (!config.apiKey) throw new Error("anansiTools: apiKey is required");
  if (!config.userId) throw new Error("anansiTools: userId is required");

  if (options?.format === "openai") {
    return {
      tools: [
        { type: "function", function: { name: "remember", description: REMEMBER_DESCRIPTION, parameters: REMEMBER_SCHEMA } },
        { type: "function", function: { name: "recall", description: RECALL_DESCRIPTION, parameters: RECALL_SCHEMA } },
      ],
      execute: async (name, args) => {
        if (name === "remember") return executeRemember(config, args);
        if (name === "recall") return executeRecall(config, args);
        throw new Error(`Unknown Anansi tool: ${name}`);
      },
    };
  }

  return {
    remember: {
      description: REMEMBER_DESCRIPTION,
      parameters: REMEMBER_SCHEMA,
      execute: (args) => executeRemember(config, args),
    },
    recall: {
      description: RECALL_DESCRIPTION,
      parameters: RECALL_SCHEMA,
      execute: (args) => executeRecall(config, args),
    },
  };
}

export default anansiTools;
