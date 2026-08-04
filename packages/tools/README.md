# anansi-tools

Framework-agnostic `remember` / `recall` memory tools backed by [Anansi](https://github.com/g-33-L/anansi). Zero dependencies — tool parameters are plain JSON Schema, so the same pair works with the Vercel AI SDK, OpenAI function calling, the OpenAI Agents SDK, or any framework that accepts JSON Schema tools.

## Vercel AI SDK

```ts
import { anansiTools } from 'anansi-tools';
import { jsonSchema, tool, generateText } from 'ai';

const { remember, recall } = anansiTools({ apiKey: 'ans_...', userId: 'user_123' });

const result = await generateText({
  model,
  tools: {
    remember: tool({
      description: remember.description,
      inputSchema: jsonSchema(remember.parameters),
      execute: remember.execute,
    }),
    recall: tool({
      description: recall.description,
      inputSchema: jsonSchema(recall.parameters),
      execute: recall.execute,
    }),
  },
  prompt: '...',
});
```

## OpenAI function calling / Agents SDK

```ts
import { anansiTools } from 'anansi-tools';

const toolkit = anansiTools({ apiKey: 'ans_...', userId: 'user_123' }, { format: 'openai' });

// toolkit.tools → pass as the `tools` array on the request
// toolkit.execute(name, parsedArgs) → dispatch a returned tool call
const reply = await toolkit.execute('recall', { query: 'what stack does the user prefer?' });
```

## Options

```ts
anansiTools({
  apiKey: 'ans_...',   // required
  userId: 'user_123',  // required — memory is scoped per user
  baseUrl: 'https://...' // optional, defaults to the hosted Anansi API
});
```
