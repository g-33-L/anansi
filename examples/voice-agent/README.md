# Voice Agent Memory (Vapi / Retell / LiveKit)

This example demonstrates how to add persistent memory to a voice agent. With Anansi, your agent can remember a caller across multiple calls, so they don't have to repeat themselves.

The `memory.mjs` module exports two functions that are designed for the latency-critical environment of voice applications.

## Prerequisites

*   **Node.js:** v18 or later.
*   **Anansi API Key:** Get a free key from the [Anansi Developer Portal](https://anansimemory.com/portal).
*   **A Voice Agent Platform:** Such as [Vapi](https://vapi.ai), [Retell AI](https://www.retellai.com/), or a custom solution with [LiveKit](https://livekit.io/).

## Setup

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **Set environment variables:**
    Ensure your server environment (e.g., your webhook handler) has the `ANANSI_API_KEY` environment variable set.

    ```bash
    ANANSI_API_KEY=ans_...
    ```

3.  **Integrate `memory.mjs`:**
    Import the two functions from `memory.mjs` into your voice agent's webhook handler or server logic.

    ```javascript
    import { buildSystemPromptForCaller, rememberTurn } from "./memory.mjs";
    ```

## How It Works

### 1. `buildSystemPromptForCaller(callerId)`

Call this function as soon as a call connects (e.g., on a `call.started` event), before the caller even speaks.

*   **What it does:** It fetches the caller's Anansi profile. This is a fast operation that "warms" Anansi's cache.
*   **What it returns:** A formatted string ready to be used as your LLM's system prompt.

```javascript
// In your platform's 'call.started' webhook handler:
const callerId = getCallerIdFromWebhook(webhookPayload); // e.g., '+14155551234'
const systemPrompt = await buildSystemPromptForCaller(callerId);

// Now, use this systemPrompt when initializing your LLM assistant for the call.
```

**Example System Prompt:**
If Anansi remembers that this caller is a "senior engineer" and is "building a voice agent", the `systemPrompt` will look like this:

```text
You are a helpful voice assistant. Keep replies short and spoken-friendly.

What you know about this caller:
## User — Stable facts
- Senior engineer
## User — Current context
- Currently building a voice agent
```

### 2. `rememberTurn(callerId, transcript, sessionId)`

Call this function after each conversational turn, or once at the end of the call with the full transcript.

*   **What it does:** It sends the conversation transcript to Anansi for ingestion. This is a **fire-and-forget** operation; it returns `202 Accepted` immediately and does not add latency to your conversation flow. Anansi processes the information asynchronously.

```javascript
// In your platform's 'end-of-call-report' or 'transcript.ready' webhook:
const callerId = getCallerIdFromWebhook(webhookPayload);
const fullTranscript = getTranscriptFromWebhook(webhookPayload);
const callId = getCallIdFromWebhook(webhookPayload);

rememberTurn(callerId, fullTranscript, callId); // No `await` needed
```

## Why This Pattern is Suited for Voice

Voice applications are highly sensitive to latency. This example is designed to keep Anansi off the critical path:

*   **Async Ingestion:** `rememberTurn` sends data to Anansi without waiting for it to be processed.
*   **Fast Context Retrieval:** `buildSystemPromptForCaller` is designed to be fast, and subsequent calls for the same user within a short period will hit Anansi's cache (60s TTL), making them even faster.

By pre-warming the cache on call connection and ingesting data asynchronously, you can provide a seamless, memory-enabled experience for your users without compromising on performance.
