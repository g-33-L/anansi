# SDK Reference

Anansi ships SDKs for TypeScript/JavaScript, Python, and as an MCP server. All three call the same REST API.

## TypeScript / JavaScript

```bash
npm install anansi-memory
```

```typescript
import AnansiMemory, { AnansiError } from "anansi-memory";

const memory = new AnansiMemory({
  apiKey: "ans_...",           // required
  baseUrl: "https://...",      // optional — defaults to hosted API
});
```

### `memory.ingest(options)`

Store content in a user's memory. Returns `{ id, queued: true }` (`202` — embedding runs off the request path).

| Option | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | Yes | Your internal user ID, max 256 chars |
| `content` | `string` | Yes | Text to remember, max 100 KB |
| `sourceType` | `string` | No | `conversation`, `document`, `meeting`, `note`, `custom` |
| `sourceId` | `string` | No | Idempotency key — re-ingesting the same ID is a no-op |
| `metadata` | `object` | No | `title`, `author`, `timestamp`, any custom fields (all filterable) |
| `embedding` | `number[]` | No | Pre-computed embedding — skips internal embedding provider |
| `sessionId` | `string` | No | Scope to a conversation session |
| `agentId` | `string` | No | Scope to a specific agent |
| `ttl` | `number` | No | Time-to-live in seconds (auto-delete after expiry) |

### `memory.context(options)`

Retrieve synthesized memory for a user.

| Option | Type | Required | Description |
|---|---|---|---|
| `userId` | `string` | Yes | Your internal user ID |
| `q` | `string` | No | Query for relevant chunk retrieval |

Returns:

| Field | Description |
|---|---|
| `static` | `string[]` — curated, stable facts |
| `dynamic` | `string[]` — current state and recent context |
| `relevant` | `{ content, similarity, metadata }[]` — ranked chunks (when `q` is provided) |
| `temporal` | `{ fact, validFrom, validUntil }[]` — bi-temporal facts (Pro+) |
| `entities` | `{ name, type, summary }[]` — extracted entities (Pro+) |

### `memory.formatForPrompt(ctx)`

Formats a context result into a ready-to-inject system prompt block.

### `memory.search(options)`

Raw chunk search without synthesis — useful for custom retrieval pipelines.

| Option | Type | Notes |
|---|---|---|
| `userId` | `string` | Required |
| `query` | `string` | Required, max 2000 chars |
| `searchMode` | `string` | `semantic`, `hybrid` (default), `keyword` |
| `alpha` | `number` | `1.0` = pure vector, `0.0` = pure keyword; omit for RRF merge |
| `limit` | `number` | Max results (default 8, max 50) |
| `filters` | `object` | JSONB metadata filters (`$gte`, `$lte`, `$contains`, `$and`, `$or`) |
| `sessionId` | `string` | Restrict to a session |

### `memory.listMemories(options)`

Paginated list of raw memory chunks. Ranked by hybrid search when `q` is given; otherwise sorted by recency.

### `memory.listEntities(options)`

Bi-temporal entity graph query.

| Option | Type | Description |
|---|---|---|
| `asOf` | `string` | Valid-time snapshot (`YYYY-MM-DD` or ISO 8601) |
| `asOfKnowledge` | `string` | Knowledge-time snapshot |

### `memory.deleteUser(userId)`

GDPR hard-delete. Removes the user and all cascaded child data.

### Error handling

```typescript
import { AnansiError } from "anansi-memory";

try {
  await memory.ingest({ userId, content });
} catch (err) {
  if (err instanceof AnansiError) {
    console.error(err.statusCode, err.message);
    // 401 — invalid API key
    // 402 — monthly quota exceeded
    // 413 — content too large
    // 429 — rate limit (retry after 60s)
  }
}
```

---

## Python

```bash
pip install anansi-memory
```

```python
from anansi_memory import AnansiMemory

memory = AnansiMemory(api_key="ans_...")

memory.ingest(user_id="user_123", content="User prefers dark mode.")
ctx = memory.context(user_id="user_123", q="UI preferences")
print(ctx.format_for_prompt())

# All methods mirror the TypeScript SDK
results = memory.search(user_id="user_123", query="dark mode", search_mode="hybrid")
chunks = memory.list_memories(user_id="user_123", source_type="conversation")
entities = memory.list_entities(user_id="user_123")

# GDPR hard-delete
memory.delete_user(user_id="user_123")
```

### LangChain retriever (stdlib-only)

```python
from anansi_memory.langchain import AnansiRetriever

retriever = AnansiRetriever(api_key="ans_...", user_id="user_123")
docs = retriever.get_relevant_documents("what stack does the user prefer?")
```

---

## MCP Server

No install needed — runs via `npx`:

```bash
npx -y anansi-mcp
```

Requires two environment variables:

| Variable | Required | Description |
|---|---|---|
| `ANANSI_API_KEY` | Yes | Your API key (`ans_...`) |
| `ANANSI_BASE_URL` | No | Override the API endpoint |

### Tools

| Tool | Description |
|---|---|
| `remember` | Store a memory (content + userId + optional sourceType) |
| `recall` | Retrieve synthesized profile (query + userId) |

### Client configs

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "anansi": {
      "command": "npx",
      "args": ["-y", "anansi-mcp"],
      "env": { "ANANSI_API_KEY": "ans_your_key_here" }
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add anansi --env ANANSI_API_KEY=ans_your_key_here -- npx -y anansi-mcp
```

**Cursor** — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "anansi": {
      "command": "npx",
      "args": ["-y", "anansi-mcp"],
      "env": { "ANANSI_API_KEY": "ans_your_key_here" }
    }
  }
}
```

**Windsurf** — add to `~/.codeium/windsurf/mcp_config.json` (same JSON structure).

### Testing

```bash
npx -y @modelcontextprotocol/inspector npx -y anansi-mcp
```
