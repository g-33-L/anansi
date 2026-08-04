# anansi-memory

Persistent memory for AI apps, backed by a **bi-temporal knowledge graph** — every fact carries when it was true *and* when you learned it. Give any LLM app long-term memory in two API calls. MIT-licensed and self-hostable.

```bash
npm install anansi-memory
```

## Usage

```typescript
import AnansiMemory from "anansi-memory";

const memory = new AnansiMemory({ apiKey: process.env.ANANSI_API_KEY });

// Store a conversation turn
await memory.ingest({
  userId: "user_123",
  content: "User is building a voice agent. Prefers TypeScript. Team of 4.",
  sourceType: "conversation",
});

// Before your next LLM call — inject synthesized context into the system prompt
const ctx = await memory.context({ userId: "user_123", q: "what is the user building?" });
const systemPrompt = `You are a helpful assistant.\n\n${memory.formatForPrompt(ctx)}`;
```

`context()` returns a synthesized profile — `static` facts and `dynamic` context arrays that drop straight into a prompt, plus `relevant` chunks when you pass `q`. No chunks to dedupe, rank, or trim yourself.

## API

### `new AnansiMemory(options)`

| Option | Type | Description |
|---|---|---|
| `apiKey` | `string` | Your API key (`ans_...`) |
| `baseUrl` | `string` | Override API base URL (default: `https://anansimemory.com`) |

### `memory.ingest(options)`

Store content in a user's memory. Returns `{ id, queued: true }` (`202` — embedding runs off the request path).

| Option | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | ✓ | Your internal user ID |
| `content` | `string` | ✓ | Text to remember, max 100 KB |
| `sourceType` | `string` | | `conversation`, `document`, `note`, `meeting`, `custom` |
| `sourceId` | `string` | | Idempotency key — re-ingesting the same ID is a no-op |
| `metadata` | `object` | | `title`, `author`, `timestamp`, any custom fields (all filterable) |
| `embedding` | `number[]` | | Pre-computed embedding — skips the internal embedding provider |
| `sessionId` | `string` | | Scope this ingest to a conversation session |
| `agentId` | `string` | | Scope this ingest to a specific agent |

### `memory.context(options)`

Retrieve synthesized memory for a user. Returns `{ static, dynamic, relevant, temporal, entities }`.

| Option | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | ✓ | Your internal user ID |
| `q` | `string` | | Optional query to retrieve relevant chunks |

### `memory.formatForPrompt(ctx)`

Format a context result into a ready-to-inject system-prompt block.

### Also available

```typescript
const results  = await memory.search({ userId, query, searchMode, alpha, limit, filters });
const chunks   = await memory.listMemories({ userId, q, sourceType, limit, offset });
const entities = await memory.listEntities({ userId, asOf, asOfKnowledge }); // bi-temporal point queries
await memory.deleteUser(userId); // GDPR hard-delete
```

`listEntities` accepts `asOf` (the graph as it was **valid** at an instant) and `asOfKnowledge` (the graph **as we knew it** at an instant). The entity graph is a Pro+ feature.

## Handling API Responses

### Error Handling

The Anansi SDK throws an `AnansiError` for non-successful API responses. You can use the `statusCode` property to handle different types of errors programmatically.

```typescript
import AnansiMemory, { AnansiError } from "anansi-memory";

try {
  await memory.ingest({ userId, content });
} catch (err) {
  if (err instanceof AnansiError) {
    console.error(`Anansi API Error (Status ${err.statusCode}): ${err.message}`);
    switch (err.statusCode) {
      case 401:
        // Handle invalid API key
        break;
      case 402:
        // Handle monthly quota exceeded (don't retry)
        break;
      case 429:
        // Handle rate limit exceeded (retry with backoff, e.g., after 60s)
        break;
      case 413:
        // Handle content too large
        break;
      default:
        // Handle other client or server errors
        break;
    }
  }
}
```

### Rate Limiting and Quotas

The API enforces both rate limits (requests per minute) and monthly quotas.
*   **Rate Limits (`429`):** If you exceed the rate limit, the API will return a `429 Too Many Requests` error. The SDK will throw an `AnansiError` with this status code. It is safe to retry these requests after a short delay (e.g., using exponential backoff).
*   **Quotas (`402`):** If your monthly usage quota is exceeded, the API will return a `402 Payment Required` error. These requests should not be retried automatically. Instead, this indicates that you need to upgrade your plan.

### Idempotency

The `ingest` method supports a `sourceId` parameter. You can use this to provide a unique identifier for each piece of content you ingest. If you try to ingest content with a `sourceId` that has already been used, Anansi will recognize it as a duplicate and will not re-ingest the content, effectively making the `ingest` operation idempotent for that `sourceId`. This is useful for preventing duplicate memories from being created due to retries or redundant processing.

```typescript
// If this is called multiple times, the content will only be ingested once.
await memory.ingest({
  userId: "user_123",
  content: "This is a unique piece of information.",
  sourceId: "my-unique-source-id-123",
});
```

### Pagination

The `listMemories` method supports pagination through `limit` and `offset` parameters.

```typescript
const pageSize = 20;
let currentPage = 0;

async function fetchMemoriesPage(page: number) {
  const { memories, total } = await memory.listMemories({
    userId: "user_123",
    limit: pageSize,
    offset: page * pageSize,
  });
  console.log(`Page ${page + 1}: Found ${memories.length} of ${total} total memories.`);
  return memories;
}

// Fetch the first page
const firstPageMemories = await fetchMemoriesPage(currentPage);
```

## Links

- [Developer Portal](https://anansimemory.com/portal)
- [API Docs](https://anansimemory.com/docs)
- [GitHub](https://github.com/g-33-L/anansi)

MIT licensed.
