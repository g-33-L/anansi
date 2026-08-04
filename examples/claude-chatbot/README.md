# Claude Chatbot with Memory

A terminal chatbot that remembers a user across runs, using Anansi for persistent memory and Anthropic's Claude for the AI response.

## Prerequisites

*   **Node.js:** v18 or later.
*   **Anansi API Key:** Get a free key from the [Anansi Developer Portal](https://anansimemory.com/portal).
*   **Anthropic API Key:** Get a key from the [Anthropic Console](https://console.anthropic.com/dashboard).

## Setup and Run

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **Set environment variables and run:**
    Replace `ans_...` and `sk-ant-...` with your actual API keys. You can also optionally set a `USER_ID` to scope memory to a specific user.

    ```bash
    ANANSI_API_KEY=ans_... \
    ANTHROPIC_API_KEY=sk-ant-... \
    USER_ID=demo-user-chatbot \
    npm start
    ```

## Expected Output

The first time you run the script, the bot won't have any memory of you. Tell it something about yourself.

```text
Anansi + Claude chatbot — type a message, Ctrl-C to quit.

you   › My name is Alex and I am a software engineer.
claude › It's nice to meet you, Alex! What kind of software do you enjoy working on?

you   › I like working with TypeScript.
claude › That's great! TypeScript is a powerful language.
```

Now, quit the script with `Ctrl-C` and start it again with the *same `USER_ID`*. Ask a question that relies on the previous conversation. Anansi will provide the context to Claude.

```bash
# Re-run the script with the same USER_ID
ANANSI_API_KEY=ans_... \
ANTHROPIC_API_KEY=sk-ant-... \
USER_ID=demo-user-chatbot \
npm start
```

```text
Anansi + Claude chatbot — type a message, Ctrl-C to quit.

you   › what is my name and what do I like?
claude › Your name is Alex and you enjoy working with TypeScript.
```

## How it works

Each turn does three things (see `index.mjs`):

1. **Recall** — `memory.context({ userId, q })` returns a synthesized profile (`static` facts + `dynamic` context) based on the user's history and the current query.
2. **Inject** — `memory.formatForPrompt(ctx)` turns the profile into a text block that is injected into Claude's system prompt.
3. **Remember** — `memory.ingest({ userId, content })` stores the latest turn. This is a fire-and-forget operation that returns `202 Accepted` immediately, so it never adds latency to your chatbot's response.

Run it, tell the bot something about yourself, quit, and start it again — it remembers. The `USER_ID` is the key to scoping memory per end-user.
