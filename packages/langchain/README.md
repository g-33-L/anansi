# anansi-langchain

LangChain + LangGraph integration for [Anansi](https://github.com/g-33-L/anansi) memory.

## Retriever

```ts
import { AnansiRetriever } from 'anansi-langchain';

const retriever = new AnansiRetriever({
  apiKey: 'ans_...',
  userId: 'user_123',
  // optional retrieval tuning:
  limit: 10,
  searchMode: 'hybrid',  // 'semantic' | 'hybrid' | 'keyword'
  alpha: 0.7,            // 1 = pure vector, 0 = pure keyword
  threshold: 0.7,
  filters: { metadata: { sourceType: 'conversation' } },
});

const docs = await retriever.invoke('what stack does the user prefer?');
```

## Agent tools

```ts
import { AnansiMemoryTool, AnansiContextTool } from 'anansi-langchain';

const tools = [
  new AnansiMemoryTool({ apiKey: 'ans_...', userId: 'user_123' }),  // "remember"
  new AnansiContextTool({ apiKey: 'ans_...', userId: 'user_123' }), // "recall"
];
```

## LangGraph

```ts
import { Annotation, StateGraph } from '@langchain/langgraph';
import { AnansiMemoryAnnotation, createAnansiMemoryNodes } from 'anansi-langchain/langgraph';

const StateAnnotation = Annotation.Root({
  ...AnansiMemoryAnnotation('user_123', { apiKey: 'ans_...' }),
  messages: Annotation<HumanMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

const { loadMemory, saveMemory } = createAnansiMemoryNodes('user_123', { apiKey: 'ans_...' });

const graph = new StateGraph(StateAnnotation)
  .addNode('loadMemory', loadMemory)   // injects profile into state.anansiContext
  .addNode('agent', agentNode)         // read state.anansiContext in your prompt
  .addNode('saveMemory', saveMemory)   // ingests the latest human message
  .addEdge('__start__', 'loadMemory')
  .addEdge('loadMemory', 'agent')
  .addEdge('agent', 'saveMemory');
```

`@langchain/core` is a peer dependency; `@langchain/langgraph` is optional and only needed for the `/langgraph` subpath.
