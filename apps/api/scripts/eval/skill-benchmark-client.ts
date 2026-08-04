import {
  SKILL_EXTRACTION_SYSTEM_PROMPT,
  buildSkillExtractionUserPrompt,
  parseSkillExtractionResponse,
} from '../../src/lib/ai/skill-extraction-prompt.js';
import type { ExtractedProcedure } from '../../src/lib/ai/skill-extraction.js';

export type BenchmarkProvider = 'ollama' | 'cerebras' | 'gemini' | 'claude';
export type BenchmarkModel = { provider: BenchmarkProvider; name: string };
type Message = { role: 'system' | 'user'; content: string };
export type BenchmarkClient = { model: BenchmarkModel; complete(messages: Message[]): Promise<string> };
type FetchLike = typeof fetch;

// One shared output-token ceiling for every provider so no model is handicapped
// by a smaller budget. Sized well above the largest fixture procedure.
export const BENCHMARK_MAX_OUTPUT_TOKENS = 2048;

// How each provider is constrained to emit JSON. All but Claude expose a native
// structured-output flag; the Anthropic Messages API (version 2023-06-01) has no
// response_format, so we use the standard assistant-prefill technique instead.
export function structuredOutputMode(provider: BenchmarkProvider): string {
  switch (provider) {
    case 'ollama': return "native (format: 'json')";
    case 'cerebras': return "native (response_format: json_object)";
    case 'gemini': return "native (responseMimeType: application/json)";
    case 'claude': return "assistant prefill '{' (no native JSON mode in Messages API 2023-06-01)";
  }
}

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required for this benchmark provider.`);
  return value;
}

async function requestJson(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new Error(`Benchmark LLM request failed: ${response.status} ${await response.text()}`);
  return response.json();
}

// Benchmark-only transports. Production provider selection and extraction are not changed.
// Every provider runs at temperature 0, the shared token ceiling, and JSON-constrained output.
export function createBenchmarkClient(model: BenchmarkModel, env: NodeJS.ProcessEnv = process.env, fetchImpl: FetchLike = fetch): BenchmarkClient {
  const jsonHeaders = { 'Content-Type': 'application/json' };
  switch (model.provider) {
    case 'ollama': {
      const baseUrl = env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
      return { model, async complete(messages) {
        const data = await requestJson(fetchImpl, `${baseUrl}/api/chat`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ model: model.name, messages, stream: false, format: 'json', options: { temperature: 0, num_predict: BENCHMARK_MAX_OUTPUT_TOKENS } }), signal: AbortSignal.timeout(300_000) }) as { message?: { content?: string } };
        return data.message?.content ?? '';
      } };
    }
    case 'cerebras': {
      const apiKey = required('CEREBRAS_API_KEY', env);
      return { model, async complete(messages) {
        const data = await requestJson(fetchImpl, 'https://api.cerebras.ai/v1/chat/completions', { method: 'POST', headers: { ...jsonHeaders, Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: model.name, messages, temperature: 0, max_tokens: BENCHMARK_MAX_OUTPUT_TOKENS, response_format: { type: 'json_object' } }), signal: AbortSignal.timeout(60_000) }) as { choices?: Array<{ message?: { content?: string } }> };
        return data.choices?.[0]?.message?.content ?? '';
      } };
    }
    case 'gemini': {
      const apiKey = required('GEMINI_API_KEY', env);
      return { model, async complete(messages) {
        const system = messages.find((message) => message.role === 'system')?.content ?? '';
        const contents = messages.filter((message) => message.role !== 'system').map((message) => ({ role: 'user', parts: [{ text: message.content }] }));
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.name)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const data = await requestJson(fetchImpl, url, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0, maxOutputTokens: BENCHMARK_MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' } }), signal: AbortSignal.timeout(60_000) }) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
      } };
    }
    case 'claude': {
      const apiKey = required('ANTHROPIC_API_KEY', env);
      return { model, async complete(messages) {
        const system = messages.find((message) => message.role === 'system')?.content ?? '';
        const userMessages = messages.filter((message) => message.role !== 'system');
        // Prefill an opening brace to force a JSON object, the Messages-API
        // equivalent of the other providers' native JSON mode. The prefill is not
        // echoed back, so we re-prepend it before handing off to the shared parser.
        const requestMessages = [...userMessages, { role: 'assistant', content: '{' }];
        const data = await requestJson(fetchImpl, 'https://api.anthropic.com/v1/messages', { method: 'POST', headers: { ...jsonHeaders, 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: model.name, max_tokens: BENCHMARK_MAX_OUTPUT_TOKENS, temperature: 0, system, messages: requestMessages }), signal: AbortSignal.timeout(60_000) }) as { content?: Array<{ type?: string; text?: string }> };
        const text = data.content?.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('') ?? '';
        return `{${text}`;
      } };
    }
  }
}

export async function extractWithBenchmarkClient(client: BenchmarkClient, input: { domain: string; chunks: Array<{ id: string; text: string }> }): Promise<ExtractedProcedure | { refused: true; reason: string }> {
  const ids = new Set(input.chunks.map((chunk) => chunk.id));
  const messages: Message[] = [{ role: 'system', content: SKILL_EXTRACTION_SYSTEM_PROMPT }, { role: 'user', content: buildSkillExtractionUserPrompt(input.chunks) }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = parseSkillExtractionResponse(await client.complete(messages), ids);
    if (parsed) return parsed;
  }
  return { skillName: input.domain, steps: [] };
}

export function benchmarkModelsFromEnv(env: NodeJS.ProcessEnv = process.env): BenchmarkModel[] {
  const providers = (env.SKILL_BENCHMARK_PROVIDERS ?? 'ollama').split(',').map((value) => value.trim()).filter(Boolean);
  const names: Partial<Record<BenchmarkProvider, string>> = { ollama: env.OLLAMA_LLM_MODEL ?? 'llama3.1:8b', cerebras: env.CEREBRAS_SYNTHESIS_MODEL ?? 'gpt-oss-120b', gemini: env.GEMINI_SKILL_BENCHMARK_MODEL ?? 'gemini-2.5-flash', claude: env.CLAUDE_SKILL_BENCHMARK_MODEL ?? 'claude-sonnet-4-20250514' };
  return providers.map((provider) => {
    if (!(provider in names)) throw new Error(`Unknown benchmark provider ${provider}. Use ollama, cerebras, gemini, or claude.`);
    return { provider: provider as BenchmarkProvider, name: names[provider as BenchmarkProvider]! };
  });
}
