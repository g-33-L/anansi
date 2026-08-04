# anansi-memory

Persistent memory for AI apps, backed by a **bi-temporal knowledge graph** — every fact carries when it was true *and* when you learned it. Give any LLM app long-term memory in two API calls. MIT-licensed and self-hostable.

```bash
pip install anansi-memory
```

## Usage

```python
from anansi_memory import AnansiMemory

memory = AnansiMemory(api_key="ans_...")

# Store a conversation turn
memory.ingest(
    user_id="user_123",
    content="User is building a voice agent. Prefers TypeScript. Team of 4.",
    source_type="conversation",
)

# Before your next LLM call — inject synthesized context into the system prompt
ctx = memory.context(user_id="user_123", q="what is the user building?")
system_prompt = f"You are a helpful assistant.\n\n{ctx.format_for_prompt()}"
```

`context()` returns a synthesized profile — `static` facts and `dynamic` context that drop straight into a prompt, plus `relevant` chunks when you pass `q`. No chunks to dedupe, rank, or trim yourself.

## API

### `AnansiMemory(api_key, base_url=None)`

| Param | Type | Description |
|---|---|---|
| `api_key` | `str` | Your API key (`ans_...`) |
| `base_url` | `str` | Override API base URL (default: `https://anansimemory.com`) |

### `memory.ingest(user_id, content, source_type=None, source_id=None, metadata=None, embedding=None, session_id=None, agent_id=None)`

Store content in a user's memory. Returns `IngestResult(id, queued=True)`.

| Param | Type | Required | Description |
|---|---|---|---|
| `user_id` | `str` | ✓ | Your internal user ID |
| `content` | `str` | ✓ | Text to remember, max 100 KB |
| `source_type` | `str` | | `"conversation"`, `"document"`, `"note"`, `"meeting"`, `"custom"` |
| `source_id` | `str` | | Idempotency key — re-ingesting the same ID is a no-op |
| `metadata` | `dict` | | `title`, `author`, `timestamp`, any custom fields |

### `memory.context(user_id, q=None, as_of=None, as_of_knowledge=None)`

Retrieve synthesized memory for a user. Returns `ContextResult(static, dynamic, relevant, ...)`. Pass `as_of` / `as_of_knowledge` for a bi-temporal point-in-time view (Pro+).

### Also available

```python
results  = memory.search(user_id="user_123", query="dark mode", search_mode="hybrid")
chunks   = memory.list_memories("user_123", source_type="conversation")
entities = memory.list_entities("user_123", as_of="2026-05-01", as_of_knowledge="2026-05-01")
memory.delete_user("user_123")  # GDPR hard-delete

# LangChain-compatible retriever (no langchain dependency required)
from anansi_memory.langchain import AnansiRetriever
retriever = AnansiRetriever(api_key="ans_...", user_id="user_123")
docs = retriever.get_relevant_documents("what stack does the user prefer?")
```

`list_entities` accepts `as_of` (the graph as it was **valid** at an instant) and `as_of_knowledge` (the graph **as we knew it** at an instant). The entity graph is a Pro+ feature.

## Handling API Responses

### Error Handling

The Anansi SDK raises an `AnansiError` for non-successful API responses. You can use the `status_code` attribute to handle different types of errors programmatically.

```python
from anansi_memory import AnansiMemory, AnansiError
import time

try:
    memory.ingest(user_id=user_id, content=content)
except AnansiError as e:
    print(f"Anansi API Error (Status {e.status_code}): {e.args[0]}")
    if e.status_code == 401:
        # Handle invalid API key
        pass
    elif e.status_code == 402:
        # Handle monthly quota exceeded (don't retry)
        pass
    elif e.status_code == 429:
        # Handle rate limit exceeded (retry with backoff)
        time.sleep(60)
    elif e.status_code == 413:
        # Handle content too large
        pass
    else:
        # Handle other client or server errors
        pass
```

### Rate Limiting and Quotas

The API enforces both rate limits (requests per minute) and monthly quotas.
*   **Rate Limits (`429`):** If you exceed the rate limit, the API will return a `429 Too Many Requests` error. The SDK will raise an `AnansiError` with this status code. It is safe to retry these requests after a short delay (e.g., using exponential backoff).
*   **Quotas (`402`):** If your monthly usage quota is exceeded, the API will return a `402 Payment Required` error. These requests should not be retried automatically. Instead, this indicates that you need to upgrade your plan.

### Idempotency

The `ingest` method supports a `source_id` parameter. You can use this to provide a unique identifier for each piece of content you ingest. If you try to ingest content with a `source_id` that has already been used, Anansi will recognize it as a duplicate and will not re-ingest the content, effectively making the `ingest` operation idempotent for that `source_id`. This is useful for preventing duplicate memories from being created due to retries or redundant processing.

```python
# If this is called multiple times, the content will only be ingested once.
memory.ingest(
    user_id="user_123",
    content="This is a unique piece of information.",
    source_id="my-unique-source-id-123",
)
```

### Pagination

The `list_memories` method supports pagination through `limit` and `offset` parameters. It returns a tuple of `(memories, total)`.

```python
page_size = 20
current_page = 0
total_memories = 0

while True:
    memories, total = memory.list_memories(
        user_id="user_123",
        limit=page_size,
        offset=current_page * page_size,
    )
    if not memories:
        break
    
    total_memories = total
    print(f"Page {current_page + 1}: Found {len(memories)} of {total} total memories.")
    current_page += 1

print(f"Finished paginating through all {total_memories} memories.")
```

## Requirements

Python 3.9+. No external dependencies — uses stdlib `urllib` only.

## Links

- [Developer Portal](https://anansimemory.com/portal)
- [API Docs](https://anansimemory.com/docs)
- [GitHub](https://github.com/g-33-L/anansi)

MIT licensed.
