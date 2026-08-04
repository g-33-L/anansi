// Add persistent memory to a Claude chatbot with Anansi.
// Three steps per turn: (1) pull the user's memory, (2) inject it into the
// system prompt, (3) remember the turn without blocking the reply.
//
//   ANANSI_API_KEY=ans_...  ANTHROPIC_API_KEY=sk-ant-...  node index.mjs

import AnansiMemory from "anansi-memory";
import Anthropic from "@anthropic-ai/sdk";
import { createInterface } from "node:readline/promises";

const memory = new AnansiMemory({ apiKey: process.env.ANANSI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const userId = process.env.USER_ID ?? "demo-user";

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("Anansi + Claude chatbot — type a message, Ctrl-C to quit.\n");

for (;;) {
  const input = (await rl.question("you   › ")).trim();
  if (!input) continue;

  // 1. Pull what Anansi remembers about this user (relevant to the message).
  const ctx = await memory.context({ userId, q: input });
  const memoryBlock = memory.formatForPrompt(ctx);

  // 2. Ask Claude with that memory injected into the system prompt.
  const res = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 500,
    system: `You are a helpful assistant.\n\nWhat you remember about this user:\n${memoryBlock}`,
    messages: [{ role: "user", content: input }],
  });
  const reply = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  console.log(`claude › ${reply}\n`);

  // 3. Remember this turn — fire-and-forget, never block the response path.
  memory
    .ingest({ userId, content: `User: ${input}\nAssistant: ${reply}`, sourceType: "conversation" })
    .catch((err) => console.error("[ingest failed]", err.message));
}
