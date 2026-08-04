# Framework Integrations

Anansi ships first-party packages for the most common AI frameworks.

## Vercel AI SDK (`anansi-ai-sdk`)

Middleware that wraps any Vercel AI SDK model — before each request, the user's synthesized profile is injected as a system message. Optionally auto-ingests each user turn.

```bash
npm install anansi-ai-sdk
```

```typescript
import { withAnansi } from "anansi-ai-sdk";
import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

const model = withAnansi(openai("gpt-4o"), {
  apiKey: "ans_...",
  userId: "user_123",
  mode: "full",        // "profile" | "query" | "full" (default: "full")
  ingestAfter: true,   // auto-ingest each user message (default: false)
});

const result = await generateText({
  model,
  prompt: "What stack should I use?",
});
```

### Modes

| Mode | Behavior |
|---|---|
| `profile` | Inject synthesized static + dynamic profile only (no search) |
| `query` | Search memory with the latest user message, inject `relevant[]` only |
| `full` | Both (default) |

### Options

| Option | Type | Required | Description |
|---|---|---|---|
| `apiKey` | `string` | Yes | Anansi API key |
| `userId` | `string` | Yes | Memory is scoped per user |
| `mode` | `string` | No | `profile`, `query`, or `full` (default: `full`) |
| `ingestAfter` | `boolean` | No | Auto-ingest conversation turns (default: `false`) |
| `sessionId` | `string` | No | Tag ingested turns for session-scoped retrieval |
| `baseUrl` | `string` | No | Defaults to hosted Anansi API |

Works with both `LanguageModelV1` and `LanguageModelV2` models. `ai` is an optional peer dependency.

---

## LangChain + LangGraph (`anansi-langchain`)

Retriever, agent tools, and LangGraph memory nodes.

```bash
npm install anansi-langchain
```

### Retriever

```typescript
import { AnansiRetriever } from "anansi-langchain";

const retriever = new AnansiRetriever({
  apiKey: "ans_...",
  userId: "user_123",
  limit: 10,
  searchMode: "hybrid",  // "semantic" | "hybrid" | "keyword"
  alpha: 0.7,            // 1 = pure vector, 0 = pure keyword
  threshold: 0.7,
  filters: { metadata: { sourceType: "conversation" } },
});

const docs = await retriever.invoke("what stack does the user prefer?");
```

### Agent tools

```typescript
import { AnansiMemoryTool, AnansiContextTool } from "anansi-langchain";

const tools = [
  new AnansiMemoryTool({ apiKey: "ans_...", userId: "user_123" }),  // "remember"
  new AnansiContextTool({ apiKey: "ans_...", userId: "user_123" }), // "recall"
];
```

### LangGraph

```typescript
import { Annotation, StateGraph } from "@langchain/langgraph";
import { AnansiMemoryAnnotation, createAnansiMemoryNodes } from "anansi-langchain/langgraph";

const StateAnnotation = Annotation.Root({
  ...AnansiMemoryAnnotation("user_123", { apiKey: "ans_..." }),
  messages: Annotation<HumanMessage[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
});

const { loadMemory, saveMemory } = createAnansiMemoryNodes("user_123", {
  apiKey: "ans_...",
});

const graph = new StateGraph(StateAnnotation)
  .addNode("loadMemory", loadMemory)   // injects profile into state.anansiContext
  .addNode("agent", agentNode)         // read state.anansiContext in your prompt
  .addNode("saveMemory", saveMemory)   // ingests the latest human message
  .addEdge("__start__", "loadMemory")
  .addEdge("loadMemory", "agent")
  .addEdge("agent", "saveMemory");
```

`@langchain/core` is a peer dependency. `@langchain/langgraph` is optional (only needed for the `/langgraph` subpath).

---

## Framework-agnostic tools (`anansi-tools`)

Zero-dependency `remember` / `recall` tools in both AI SDK and OpenAI tool-call formats. Works with any framework that accepts JSON Schema tools.

```bash
npm install anansi-tools
```

### Vercel AI SDK

```typescript
import { anansiTools } from "anansi-tools";
import { jsonSchema, tool, generateText } from "ai";

const { remember, recall } = anansiTools({ apiKey: "ans_...", userId: "user_123" });

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
  prompt: "...",
});
```

### OpenAI function calling / Agents SDK

```typescript
import { anansiTools } from "anansi-tools";

const toolkit = anansiTools(
  { apiKey: "ans_...", userId: "user_123" },
  { format: "openai" },
);

// toolkit.tools — pass as the `tools` array on the request
// toolkit.execute(name, parsedArgs) — dispatch a returned tool call
const reply = await toolkit.execute("recall", {
  query: "what stack does the user prefer?",
});
```

---

## Examples

Runnable templates in the [`examples/`](https://github.com/g-33-L/anansi/tree/main/examples) directory:

| Example | What it shows |
|---|---|
| [`claude-chatbot`](https://github.com/g-33-L/anansi/tree/main/examples/claude-chatbot) | Add persistent memory to a Claude chatbot in ~20 lines |
| [`voice-agent`](https://github.com/g-33-L/anansi/tree/main/examples/voice-agent) | Voice memory pattern for Vapi / Retell / LiveKit — pre-warm on connect, ingest off the response path |
