import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const messages = [{ role: 'system' as const, content: 'system' }, { role: 'user' as const, content: 'user' }];
const benchmarkClientUrl = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/eval/skill-benchmark-client.ts')).href;
const TOKENS = 2048;
function fakeFetch(body: unknown) { return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })); }

describe('benchmark LLM clients', () => {
  it.each([
    ['ollama', { message: { content: '{}' } }, '{}', { OLLAMA_BASE_URL: 'http://ollama.test' }, (body: any) => expect(body).toMatchObject({ format: 'json', options: { temperature: 0, num_predict: TOKENS } })],
    ['cerebras', { choices: [{ message: { content: '{}' } }] }, '{}', { CEREBRAS_API_KEY: 'key' }, (body: any) => expect(body).toMatchObject({ temperature: 0, max_tokens: TOKENS, response_format: { type: 'json_object' } })],
    ['gemini', { candidates: [{ content: { parts: [{ text: '{}' }] } }] }, '{}', { GEMINI_API_KEY: 'key' }, (body: any) => expect(body.generationConfig).toMatchObject({ temperature: 0, maxOutputTokens: TOKENS, responseMimeType: 'application/json' })],
    ['claude', { content: [{ type: 'text', text: '}' }] }, '{}', { ANTHROPIC_API_KEY: 'key' }, (body: any) => {
      expect(body).toMatchObject({ temperature: 0, max_tokens: TOKENS });
      expect(body.messages.at(-1)).toEqual({ role: 'assistant', content: '{' });
    }],
  ] as const)('uses shared deterministic + token settings for %s', async (provider, response, expected, env, assertBody) => {
    const { createBenchmarkClient } = await import(benchmarkClientUrl);
    const fetchImpl = fakeFetch(response);
    const client = createBenchmarkClient({ provider, name: 'test-model' }, env, fetchImpl as typeof fetch);
    // Claude prefills '{' and re-prepends it, so a '}' continuation reconstructs '{}'.
    await expect(client.complete(messages)).resolves.toBe(expected);
    assertBody(JSON.parse(fetchImpl.mock.calls[0][1].body));
  });

  it('shares one output-token ceiling across every provider', async () => {
    const { BENCHMARK_MAX_OUTPUT_TOKENS } = await import(benchmarkClientUrl);
    expect(BENCHMARK_MAX_OUTPUT_TOKENS).toBe(TOKENS);
  });
});
