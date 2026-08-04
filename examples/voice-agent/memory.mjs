// The voice memory pattern for Vapi / Retell / LiveKit, in two functions.
//
// Voice is latency-critical, so the rule is: retrieval is pre-warmed and cached,
// and ingestion never touches the response path.
//
//   ANANSI_API_KEY=ans_...  (import these functions from your webhook handler)

import AnansiMemory from "anansi-memory";

const memory = new AnansiMemory({ apiKey: process.env.ANANSI_API_KEY });

/**
 * Call the MOMENT a call connects, before the caller speaks.
 * Warms Anansi's cache and returns a system-prompt block describing the caller.
 * Use the caller's phone number / account id / PIN as the stable `callerId`.
 */
export async function buildSystemPromptForCaller(callerId) {
  const ctx = await memory.context({ userId: callerId }); // no query = fast profile fetch, primes cache
  const memoryBlock = memory.formatForPrompt(ctx);
  return `You are a helpful voice assistant. Keep replies short and spoken-friendly.\n\nWhat you know about this caller:\n${memoryBlock}`;
}

/**
 * Call after each turn (or once at end-of-call with the full transcript).
 * Fire-and-forget: ingest returns 202 immediately and never blocks the call.
 */
export function rememberTurn(callerId, transcript, sessionId) {
  memory
    .ingest({ userId: callerId, content: transcript, sourceType: "voice", sessionId })
    .catch((err) => console.error("[anansi ingest failed]", err.message));
}
