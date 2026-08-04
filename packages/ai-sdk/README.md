# anansi-ai-sdk

Vercel AI SDK middleware for [Anansi](https://github.com/g-33-L/anansi) memory. Wrap any language model — before each request the user's synthesized profile is injected as a system message; optionally each user turn is auto-ingested back into memory.

```ts
import { withAnansi } from 'anansi-ai-sdk';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

const model = withAnansi(openai('gpt-4o'), {
  apiKey: 'ans_...',
  userId: 'user_123',
  mode: 'full',       // 'profile' | 'query' | 'full'
  ingestAfter: true,  // auto-ingest conversation turns
});

const result = await generateText({ model, prompt: 'What stack should I use?' });
```

## Modes

| mode | behavior |
|---|---|
| `profile` | inject the synthesized static + dynamic profile only (no search) |
| `query` | search memory with the latest user message and inject `relevant[]` only |
| `full` | both (default) |

## Options

- `apiKey` (required) — Anansi API key
- `userId` (required) — memory is scoped per user
- `mode` — see above, default `full`
- `ingestAfter` — fire-and-forget ingest of each user message, default `false`
- `sessionId` — tag ingested turns for session-scoped retrieval
- `baseUrl` — defaults to the hosted Anansi API

Works with both `LanguageModelV1` and `LanguageModelV2` models — the wrapper intercepts `doGenerate`/`doStream` structurally, so `ai` is only an optional peer dependency.
