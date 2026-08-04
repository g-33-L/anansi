// Provider selection is governed by the deployment config (see config/deployment.ts):
//   inference=local  → Ollama only (cloud keys are ignored)
//   inference=cloud  → Cerebras → GitHub Models → Ollama (today's behavior)
import { getDeploymentConfig, type DeploymentConfig } from "../config/deployment.js";

const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_QUERY_MODEL = process.env.CEREBRAS_QUERY_MODEL ?? "gpt-oss-120b";
const CEREBRAS_SYNTHESIS_MODEL = process.env.CEREBRAS_SYNTHESIS_MODEL ?? "gpt-oss-120b";

const GITHUB_MODELS_URL = "https://models.inference.ai.azure.com/chat/completions";
const GITHUB_QUERY_MODEL = process.env.GITHUB_MODELS_QUERY_MODEL ?? "gpt-4o";
const GITHUB_SYNTHESIS_MODEL = process.env.GITHUB_MODELS_SYNTHESIS_MODEL ?? "gpt-4o";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_LLM_MODEL = process.env.OLLAMA_LLM_MODEL ?? "llama3.1:8b";

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

async function chatOpenAICompat(
  url: string,
  apiKey: string,
  model: string,
  messages: Message[],
  timeoutMs = 60_000,
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new Error(`LLM request to ${url} failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

async function chatOllama(messages: Message[]): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_LLM_MODEL, messages, stream: false }),
    // Local models (esp. larger ones on a laptop) are much slower than hosted APIs.
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    throw new Error(`Ollama chat failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as { message: { content: string } };
  return data.message.content;
}

export type LlmProvider = "cerebras" | "github" | "ollama";

// Pure provider selection. Under local inference, cloud keys are ignored entirely
// (Ollama only) — the enforcement that makes local mode a guarantee, not a default.
export function resolveLlmProvider(
  cfg: Pick<DeploymentConfig, "inference">,
  env: NodeJS.ProcessEnv = process.env
): LlmProvider {
  if (cfg.inference === "local") return "ollama";
  if (env.CEREBRAS_API_KEY) return "cerebras";
  if (env.GITHUB_TOKEN) return "github";
  return "ollama";
}

export async function chat(messages: Message[]): Promise<string> {
  switch (resolveLlmProvider(getDeploymentConfig())) {
    case "cerebras":
      return chatOpenAICompat(CEREBRAS_URL, process.env.CEREBRAS_API_KEY!, CEREBRAS_QUERY_MODEL, messages);
    case "github":
      return chatOpenAICompat(GITHUB_MODELS_URL, process.env.GITHUB_TOKEN!, GITHUB_QUERY_MODEL, messages);
    default:
      return chatOllama(messages);
  }
}

// Synthesis uses a separate model slot so you can route it to a stronger model if needed
export async function chatSynthesis(messages: Message[]): Promise<string> {
  switch (resolveLlmProvider(getDeploymentConfig())) {
    case "cerebras":
      return chatOpenAICompat(CEREBRAS_URL, process.env.CEREBRAS_API_KEY!, CEREBRAS_SYNTHESIS_MODEL, messages);
    case "github":
      return chatOpenAICompat(GITHUB_MODELS_URL, process.env.GITHUB_TOKEN!, GITHUB_SYNTHESIS_MODEL, messages);
    default:
      return chatOllama(messages);
  }
}
