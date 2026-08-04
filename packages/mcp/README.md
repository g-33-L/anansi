# anansi-mcp

MCP server for [Anansi](https://github.com/g-33-L/anansi) — persistent, **synthesized** memory for any MCP client: Claude Desktop, Claude Code, Cursor, Windsurf, and anything else that speaks the Model Context Protocol.

Unlike raw vector-search memory, Anansi runs a synthesis pass over everything you store and returns a curated profile — stable facts, current context, and relevant memories — ready to use directly.

## Quick start

```bash
npx -y anansi-mcp
```

That's it — no install step. The server reads its configuration from two environment variables:

| Variable | Required | Description |
|---|---|---|
| `ANANSI_API_KEY` | yes | Your Anansi API key (`ans_...`) — create one in the [developer portal](https://anansimemory.com/portal) |
| `ANANSI_BASE_URL` | no | Override the API endpoint (defaults to the hosted Anansi API) |

## Setup

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "anansi": {
      "command": "npx",
      "args": ["-y", "anansi-mcp"],
      "env": {
        "ANANSI_API_KEY": "ans_your_key_here"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add anansi --env ANANSI_API_KEY=ans_your_key_here -- npx -y anansi-mcp
```

### Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "anansi": {
      "command": "npx",
      "args": ["-y", "anansi-mcp"],
      "env": {
        "ANANSI_API_KEY": "ans_your_key_here"
      }
    }
  }
}
```

### Windsurf

Add the same block to `~/.codeium/windsurf/mcp_config.json`.

## Tools

### `remember`

Save a memory. Content is chunked, embedded, and synthesized into the user's profile asynchronously.

| Argument | Type | Required | Description |
|---|---|---|---|
| `content` | string | yes | The memory to store — a fact, preference, note, or conversation excerpt |
| `userId` | string | yes | Stable identifier for the user this memory belongs to |
| `sourceType` | `conversation` \| `document` \| `note` \| `meeting` \| `custom` | no | What kind of content this is (default: `conversation`) |

### `recall`

Retrieve the synthesized profile for a user: stable facts, current context, and the memories most relevant to the query.

| Argument | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | What you want to know — used for relevance search |
| `userId` | string | yes | Stable identifier for the user whose memory to retrieve |

Example output:

```markdown
## Stable facts
- Prefers TypeScript over Python
- Senior engineer at a fintech startup

## Current context
- Debugging a webhook system this week

## Relevant memories
- Mentioned the webhook retries fail silently when Redis is saturated
```

## Development

```bash
pnpm install
pnpm --filter anansi-mcp build
ANANSI_API_KEY=ans_... node packages/mcp/dist/index.js
```

The server speaks MCP over stdio. Test it interactively with the [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx -y @modelcontextprotocol/inspector npx -y anansi-mcp
```

## License

MIT
