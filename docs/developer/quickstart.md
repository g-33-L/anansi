# Quickstart

Get persistent memory running in your app in under 5 minutes.

## 1. Get an API key

**Self-hosting?** Run the stack and mint a key against your own database — no
account, nothing leaves your machine. See the
[Quickstart in the README](../../README.md#quickstart--self-hosted-about-5-minutes);
the short version is:

```bash
docker compose up -d
docker compose exec api node dist/scripts/seed-dev-key.js you@example.com
```

**Using the hosted service?** Sign up at
[anansimemory.com/portal](https://anansimemory.com/portal) and create an API key.

Either way you end up with a key beginning `ans_`.

> **Self-hosters: set the base URL.** Every client below defaults to the hosted
> API at `https://anansimemory.com`. If you skip this, your calls go to the
> hosted service instead of your own instance — and your local key will not
> authenticate there. The option is `baseUrl` (TypeScript), `base_url` (Python),
> and `ANANSI_BASE_URL` (MCP).

## 2. Install the SDK

```bash
npm install anansi-memory
```

## 3. Two API calls

```typescript
import AnansiMemory from "anansi-memory";

const memory = new AnansiMemory({
  apiKey: process.env.ANANSI_API_KEY,
  // Self-hosted? Point at your own instance. Omit for the hosted service.
  baseUrl: "http://localhost:3000",
});

// 1. Store something
await memory.ingest({
  userId: "user_123",
  content: "User is building a voice agent. Prefers TypeScript. Team of 4.",
  sourceType: "conversation",
});

// 2. Retrieve synthesized context (before your next LLM call)
const ctx = await memory.context({ userId: "user_123", q: "what is the user building?" });
const systemPrompt = `You are a helpful assistant.\n\n${memory.formatForPrompt(ctx)}`;
```

That's it. `ingest` returns `202` immediately — embedding and synthesis run asynchronously on Anansi's side, so it never adds latency to your response path.

## What you get back from `context()`

```json
{
  "static": [
    "Senior engineer at Acme Corp",
    "Prefers TypeScript over Python"
  ],
  "dynamic": [
    "Currently building a voice agent",
    "Last session: debugging BullMQ retry logic"
  ],
  "relevant": [
    { "content": "User mentioned they use BullMQ...", "similarity": 0.94 }
  ],
  "temporal": [],
  "entities": []
}
```

- **`static`** — curated, stable facts (deduplicated by the synthesis worker)
- **`dynamic`** — current state and recent context
- **`relevant`** — raw chunks ranked by hybrid search (when `q` is provided)
- **`temporal`** — bi-temporal facts with valid-time ranges (Pro+)
- **`entities`** — extracted entity graph nodes (Pro+)

`memory.formatForPrompt(ctx)` turns this into a ready-to-inject system prompt block — no post-processing needed.

## Python

```bash
pip install anansi-memory
```

```python
from anansi_memory import AnansiMemory

# Self-hosted? Add base_url="http://localhost:3000". Omit for the hosted service.
memory = AnansiMemory(api_key="ans_...")
memory.ingest(user_id="user_123", content="User prefers dark mode.")
ctx = memory.context(user_id="user_123", q="UI preferences")
print(ctx.format_for_prompt())
```

## MCP (Claude Desktop, Cursor, etc.)

No install needed:

```bash
npx -y anansi-mcp
```

Add to your MCP client config:

```json
{
  "mcpServers": {
    "anansi": {
      "command": "npx",
      "args": ["-y", "anansi-mcp"],
      "env": {
        "ANANSI_API_KEY": "ans_your_key_here",
        "ANANSI_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

See the [SDK reference](sdk-reference.md) for all available methods and options.
- [First Memory: Ingesting and Retrieving User Context](guides/first-memory.md)
- [Temporal Query: Understanding `asOf` and `asOfKnowledge`](guides/temporal-query.md)
- [Source and Evidence Inspection: Raw Memories and Search](guides/source-evidence.md)
- [Connector Ingestion: Integrating External Data Sources](guides/connector-ingestion.md)
- [Safe Production Integration: Best Practices](guides/safe-production-integration.md)
