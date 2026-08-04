// anansi-langchain/langgraph — LangGraph state-machine memory helpers.
//
// AnansiMemoryAnnotation contributes an `anansiContext` channel to a graph's
// state; createAnansiMemoryNodes builds the load (auto-inject) and save
// (auto-ingest) nodes that populate it.

import { Annotation } from "@langchain/langgraph";
import {
  anansiRequest,
  formatContext,
  type AnansiConfig,
  type AnansiContextResponse,
} from "./client.js";

export type { AnansiConfig } from "./client.js";

// Loosely-typed message — works with BaseMessage instances and plain objects
interface MessageLike {
  content?: unknown;
  _getType?: () => string;
  role?: string;
  [key: string]: unknown;
}

function messageText(message: MessageLike | undefined): string | undefined {
  if (!message) return undefined;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    const text = message.content
      .filter((p): p is { type: string; text: string } =>
        typeof p === "object" && p !== null &&
        (p as { type?: unknown }).type === "text" &&
        typeof (p as { text?: unknown }).text === "string")
      .map((p) => p.text)
      .join("\n");
    return text || undefined;
  }
  return undefined;
}

function isHumanMessage(message: MessageLike): boolean {
  const type = message._getType?.() ?? message.role;
  return type === "human" || type === "user";
}

function latestHumanText(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as MessageLike;
    if (isHumanMessage(message)) return messageText(message);
  }
  return undefined;
}

/**
 * State channels for Anansi memory — spread into your Annotation.Root:
 *
 * ```ts
 * const StateAnnotation = Annotation.Root({
 *   ...AnansiMemoryAnnotation('user_123', { apiKey: 'ans_...' }),
 *   messages: Annotation<HumanMessage[]>({ reducer: (a, b) => a.concat(b) }),
 * });
 * ```
 */
export function AnansiMemoryAnnotation(_userId: string, _config: AnansiConfig) {
  return {
    anansiContext: Annotation<string>({
      reducer: (_current, next) => next,
      default: () => "",
    }),
  };
}

export interface AnansiMemoryNodesOptions extends AnansiConfig {
  /** Tag ingested turns with a session for session-scoped retrieval */
  sessionId?: string;
}

/**
 * Graph nodes that drive the `anansiContext` channel:
 *   loadMemory — fetches the user's profile (searched with the latest human
 *                message) and writes it to state.anansiContext
 *   saveMemory — ingests the latest human message as a conversation turn
 *
 * ```ts
 * const { loadMemory, saveMemory } = createAnansiMemoryNodes('user_123', { apiKey: 'ans_...' });
 * graph.addNode('loadMemory', loadMemory).addNode('saveMemory', saveMemory);
 * ```
 */
export function createAnansiMemoryNodes(userId: string, options: AnansiMemoryNodesOptions) {
  if (!options.apiKey) throw new Error("createAnansiMemoryNodes: apiKey is required");
  if (!userId) throw new Error("createAnansiMemoryNodes: userId is required");
  const config: AnansiConfig = { apiKey: options.apiKey, baseUrl: options.baseUrl };

  return {
    loadMemory: async (state: Record<string, unknown>): Promise<{ anansiContext: string }> => {
      const params = new URLSearchParams({ userId });
      const query = latestHumanText(state.messages);
      if (query) params.set("q", query);
      try {
        const ctx = await anansiRequest<AnansiContextResponse>(config, "GET", `/v1/context?${params}`);
        return { anansiContext: formatContext(ctx) };
      } catch (err) {
        console.warn("[anansi] loadMemory failed:", err);
        return { anansiContext: "" };
      }
    },

    saveMemory: async (state: Record<string, unknown>): Promise<Record<string, never>> => {
      const content = latestHumanText(state.messages);
      if (content?.trim()) {
        try {
          await anansiRequest(config, "POST", "/v1/ingest", {
            userId,
            content,
            sourceType: "conversation",
            ...(options.sessionId ? { sessionId: options.sessionId } : {}),
          });
        } catch (err) {
          console.warn("[anansi] saveMemory failed:", err);
        }
      }
      return {};
    },
  };
}
