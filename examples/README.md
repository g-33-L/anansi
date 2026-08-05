# Anansi examples

Runnable, minimal templates for the two most common integrations. Each is standalone (its own `package.json`) — copy the folder, add your keys, run.

| Example | ICP | What it shows |
|---|---|---|
| [`claude-chatbot`](./claude-chatbot) | Broad AI-app devs | Add persistent memory to a Claude chatbot in ~20 lines: pull profile -> inject into system prompt -> fire-and-forget ingest. |
| [`voice-agent`](./voice-agent) | **Voice engineers (primary ICP)** | The voice memory pattern for Vapi / Retell / LiveKit: pre-warm the caller's profile on connect, ingest the transcript off the response path. |
| [`mcp-client`](./mcp-client) | MCP & Claude tool users | Connect `anansi-mcp` to Claude Desktop, Claude Code, Cursor, Windsurf, or a custom MCP SDK client. |

## Setup

These examples run standalone once packages are installed.

To run an example:

```bash
cd examples/mcp-client
npm install
ANANSI_API_KEY=ans_... npm start
```

Each example requires:
- `ANANSI_API_KEY`: Your Anansi API key (get a free key at <https://anansimemory.com/portal>)
- `ANTHROPIC_API_KEY`: Your Anthropic API key (for the claude-chatbot example)

The `voice-agent` and `mcp-client` examples use `ANANSI_API_KEY` only.

> These are hand-written reference templates. Run each once against your own keys before relying on it - see each folder's README.
