# What is Anansi?

Anansi is an open-source memory API for AI applications. It gives any LLM-based product persistent user memory in two API calls: `POST /v1/ingest` to store information, `GET /v1/context` to retrieve a synthesized profile ready to inject into a system prompt.

## The problem

Every AI chatbot, voice agent, and copilot in production has the same memory problem: users repeat themselves every session because the model has no state between calls. Developers currently solve this by dumping raw chat history into the context window, which degrades quality as conversations grow, or by building ad-hoc vector stores that require manual deduplication, ranking, and trimming.

## Why corporate memory matters

Anansi is not just "remember what a user said." It is a structured memory layer that tracks **what you knew and when you knew it**. This matters for:

- **Compliance and audit**: "What did we know on March 3rd?" is a question most memory stores cannot answer because they overwrite facts. Anansi records both when a fact was true in the world and when the system learned it, enabling point-in-time reconstruction.
- **Agent debugging**: When an autonomous agent makes a wrong decision, you can reconstruct the exact state of its knowledge at decision time, not the current state with hindsight.
- **Consistent personalization**: Users build up a profile over time. Anansi synthesizes that profile automatically — static facts, current context, relevant chunks — so developers never have to manually curate memory.

## What Anansi gives you

### Two API calls

```typescript
import AnansiMemory from "anansi-memory";

const memory = new AnansiMemory({ apiKey: process.env.ANANSI_API_KEY });

// Store information
await memory.ingest({
  userId: "user_123",
  content: "User is building a voice agent. Prefers TypeScript. Team of 4.",
  sourceType: "conversation",
});

// Retrieve synthesized context — drop straight into a system prompt
const ctx = await memory.context({ userId: "user_123", q: "what is the user building?" });
const systemPrompt = `You are a helpful assistant.\n\n${memory.formatForPrompt(ctx)}`;
```

### A synthesized profile

The `context()` response is not raw chunks. It is a curated, deduplicated profile:

- **Static facts** (up to 30): stable truths like "Senior engineer at a fintech startup" or "Prefers TypeScript over Python"
- **Dynamic context** (up to 15): current state like "Debugging a webhook deduplication issue this week"
- **Relevant chunks**: hybrid BM25 + semantic search hits for the specific query

No post-processing required on your side.

### A bi-temporal knowledge graph

Every relationship extracted from memory carries two time axes:

- **Valid-time**: when the fact was true in the real world
- **Knowledge-time**: when the system learned it

This lets you answer: "What did we believe about this user last March?" — not just "what is true now."

### MIT licensed and self-hostable

The entire stack runs locally with `docker compose up`. With Ollama for LLM and embeddings, zero external API calls are needed. No vendor lock-in on where your users' memory lives.

## Who Anansi is for

| Audience | Why Anansi fits |
|---|---|
| AI app builders (Claude/GPT wrappers, voice agents, copilots) | Drop-in memory in two API calls, no pipeline to build |
| Compliance and audit teams | Bi-temporal queries reconstruct what was known at any past instant |
| Slack-first teams | First-party Slack app turns the workspace into queryable memory |
| Enterprise teams needing self-hosting | MIT license, runs on local models, no data leaves your infrastructure |

## Pricing

| Plan | Price | Ingest / month | Context / month | Memory users | Retention |
|---|---|---|---|---|---|
| Free | $0 | 1,000 | 500 | 10 | 7 days |
| Pro | $19/mo | 25,000 | 10,000 | Unlimited | Unlimited |
| Scale | $99/mo | 250,000 | 100,000 | Unlimited | Unlimited |
| Enterprise | Contact | Unlimited | Unlimited | Unlimited | Unlimited |

Pro and above unlock hybrid search, metadata filters, the entity graph, workspace-scoped context, connectors, and outbound webhooks.
