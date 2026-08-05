# Anansi MCP Client Example

This example demonstrates how to connect and use the Anansi MCP server (`anansi-mcp`) with MCP-compatible clients such as Claude Desktop, Claude Code, Cursor, Windsurf, or a custom Node.js application.

The Model Context Protocol (MCP) server exposes persistent, synthesized memory tools to AI assistants:
- `remember`: Stores a memory fact, preference, note, or conversation excerpt for a specific user ID.
- `recall`: Retrieves synthesized profile facts, current context, and relevant memories for a query.

## Prerequisites

- Node.js >= 20
- An Anansi API key (`ANANSI_API_KEY`). Get a key at https://anansimemory.com/portal (or run against a self-hosted instance).

## Quick Client Configurations

### 1. Claude Desktop

Add the following to your `claude_desktop_config.json`:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "anansi": {
      "command": "npx",
      "args": ["-y", "anansi-mcp"],
      "env": {
        "ANANSI_API_KEY": "ans_your_api_key_here"
      }
    }
  }
}
```

If self-hosting Anansi, add `"ANANSI_BASE_URL": "http://localhost:3000"` to the `env` block.

### 2. Claude Code CLI

Run the following command in your terminal:

```bash
claude mcp add anansi --env ANANSI_API_KEY=ans_your_api_key_here -- npx -y anansi-mcp
```

### 3. Cursor

Add to `.cursor/mcp.json` (project-level) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "anansi": {
      "command": "npx",
      "args": ["-y", "anansi-mcp"],
      "env": {
        "ANANSI_API_KEY": "ans_your_api_key_here"
      }
    }
  }
}
```

### 4. Windsurf

Add the server configuration to `~/.codeium/windsurf/mcp_config.json` using the same structure as Cursor.

## Tool Calls and Output Walkthrough

### Call 1: Remember Tool (`remember`)

Save a durable fact, preference, or context note for a user.

Input arguments:

```json
{
  "userId": "dev-user-1",
  "content": "User prefers TypeScript and strict typing for all API contracts.",
  "sourceType": "note"
}
```

Response output:

```text
Memory saved for dev-user-1 (id: 4f1a2b3c-8d9e-4012-a345-6789abcdef01). It will appear in recall results once synthesis completes (usually a few seconds).
```

### Call 2: Recall Tool (`recall`)

Retrieve synthesized facts and relevant context for a user.

Input arguments:

```json
{
  "userId": "dev-user-1",
  "query": "What language and typing preferences were specified?"
}
```

Response output:

```markdown
## Stable facts
- Prefers TypeScript and strict typing for all API contracts

## Current context
- Configuring MCP integration for development tools

## Relevant memories
- User prefers TypeScript and strict typing for all API contracts.
```

## Programmatic Example Client

This directory includes a runnable Node.js script using `@modelcontextprotocol/sdk` to programmatically spawn `anansi-mcp` over stdio and execute tool calls.

### Running the Example

1. Install dependencies:

```bash
npm install
```

2. Run the script:

```bash
ANANSI_API_KEY=ans_your_key_here npm start
```

If self-hosting an Anansi API instance:

```bash
ANANSI_API_KEY=ans_your_key_here ANANSI_BASE_URL=http://localhost:3000 npm start
```

### Code Structure (`index.mjs`)

The client spawns `npx -y anansi-mcp`, connects stdio transport, lists registered tools, and calls `remember` and `recall`:

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "npx",
  args: ["-y", "anansi-mcp"],
  env: {
    ...process.env,
    ANANSI_API_KEY: process.env.ANANSI_API_KEY,
  },
});

const client = new Client(
  { name: "anansi-mcp-example-client", version: "1.0.0" },
  { capabilities: {} }
);

await client.connect(transport);

// List available tools
const tools = await client.listTools();

// Save memory
await client.callTool({
  name: "remember",
  arguments: {
    userId: "dev-user-1",
    content: "User prefers TypeScript and strict typing for all API contracts.",
  },
});

// Recall memory
const result = await client.callTool({
  name: "recall",
  arguments: {
    userId: "dev-user-1",
    query: "What language preferences were specified?",
  },
});

await client.close();
```
