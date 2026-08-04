/** @jsxImportSource hono/jsx */
import { docsRoutes } from "./router.js";
import { layout, CodeBlock, Response, APP_URL } from "./shared.js";

// ─── /docs/guides/claude-chatbot ─────────────────────────────────────────────

docsRoutes.get("/guides/claude-chatbot", (c) => c.html(layout("/docs/guides/claude-chatbot", [
  { label: "How it works", href: "#how-it-works" },
  { label: "Full implementation", href: "#full-implementation" },
  { label: "Using relevant chunks", href: "#relevant-chunks" },
  { label: "Session grouping", href: "#session-grouping" },
  { label: "What the profile looks like", href: "#memory-profile" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/claude-chatbot">Guides</a><span class="breadcrumb-sep">/</span>Claude chatbot</div>
  <div class="page-title">Add memory to a Claude chatbot</div>
  <p class="page-sub">Give your Claude-powered chatbot persistent, synthesized memory across sessions. Users won't have to re-introduce themselves.</p>

  <div class="callout callout-info">
    <div class="callout-tag">Note</div>
    <div class="callout-body"><strong>What you'll build:</strong> A chatbot that remembers each user's preferences, background, and recent context — personalising every response without asking the user to repeat themselves.</div>
  </div>

  <h2 class="first" id="how-it-works">How it works</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body"><h3>Before each turn: fetch memory</h3><p>Call <code>GET /v1/context</code> with <code>userId</code> and the user's current message as <code>q</code>. The query steers which relevant chunks surface alongside the synthesized profile.</p></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><h3>Inject into system prompt</h3><p>Prepend <code>static</code>, <code>dynamic</code>, and optionally <code>relevant</code> facts into your Claude system prompt.</p></div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><h3>After each turn: ingest (fire-and-forget)</h3><p>POST the conversation turn to <code>/v1/ingest</code> asynchronously — never block the response on it.</p></div></div>
  </div>

  <h2 id="full-implementation">Full implementation</h2>
  <CodeBlock lang="typescript" file="chatbot.ts" code={`import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";

const anthropic = new Anthropic();
const ANANSI_URL = "${APP_URL}";
const ANANSI_KEY = process.env.ANANSI_API_KEY!;

interface Memory {
  static: string[];
  dynamic: string[];
  relevant: { content: string; similarity: number; metadata: Record<string, unknown> }[];
}

async function getMemory(userId: string, query: string): Promise<Memory> {
  const res = await fetch(
    \`\${ANANSI_URL}/v1/context?userId=\${encodeURIComponent(userId)}&q=\${encodeURIComponent(query)}\`,
    { headers: { Authorization: \`Bearer \${ANANSI_KEY}\` } }
  );
  if (!res.ok) return { static: [], dynamic: [], relevant: [] };
  return res.json();
}

function buildSystemPrompt(memory: Memory): string {
  const lines = ["You are a helpful assistant with persistent memory of this user."];
  if (memory.static.length) {
    lines.push("\\n## About this user");
    memory.static.forEach((f) => lines.push(\`- \${f}\`));
  }
  if (memory.dynamic.length) {
    lines.push("\\n## What they're working on right now");
    memory.dynamic.forEach((d) => lines.push(\`- \${d}\`));
  }
  if (memory.relevant.length) {
    lines.push("\\n## Relevant context for this message");
    memory.relevant.slice(0, 3).forEach((r) => lines.push(\`- \${r.content}\`));
  }
  return lines.join("\\n");
}

export async function chat(
  userId: string,
  userMessage: string,
  history: { role: "user" | "assistant"; content: string }[],
  sessionId?: string
) {
  const sid = sessionId ?? randomUUID();
  const memory = await getMemory(userId, userMessage);

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    system: buildSystemPrompt(memory),
    messages: [...history, { role: "user", content: userMessage }],
    max_tokens: 1024,
  });

  const reply = response.content[0].type === "text" ? response.content[0].text : "";

  // Fire-and-forget — never block the user-facing response on this
  fetch(\`\${ANANSI_URL}/v1/ingest\`, {
    method: "POST",
    headers: { Authorization: \`Bearer \${ANANSI_KEY}\`, "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      content: \`User: \${userMessage}\\nAssistant: \${reply}\`,
      sourceType: "conversation",
      sessionId: sid,
    }),
  }).catch(() => {});

  return { reply, sessionId: sid };
}`} />

  <div class="callout callout-tip">
    <div class="callout-tag">Tip</div>
    <div class="callout-body"><strong>Fire-and-forget ingest:</strong> Never <code>await</code> the ingest call on the response path — it adds a network round-trip to every turn for no benefit. Ingest asynchronously after returning the reply.</div>
  </div>

  <h2 id="relevant-chunks">Using relevant chunks</h2>
  <p>The <code>relevant</code> array contains the top vector-search hits for the user's current message. Use it for specific factual lookups that go beyond the synthesized profile:</p>
  <CodeBlock lang="typescript" code={`// Only inject relevant chunks if they're high-confidence (similarity > 0.7)
const highConfidence = memory.relevant.filter((r) => r.similarity > 0.7);
if (highConfidence.length) {
  system += "\\n\\n## Directly relevant context\\n";
  system += highConfidence.map((r) => \`- \${r.content}\`).join("\\n");
}`} />
  <p>The <code>static</code> and <code>dynamic</code> arrays are the synthesized profile — always use those. The <code>relevant</code> array is bonus signal — use it when the query is specific enough that raw chunks add value.</p>

  <h2 id="session-grouping">Session grouping with sessionId</h2>
  <p>Pass a <code>sessionId</code> to group conversation turns. Anansi uses it during synthesis to distinguish "what happened in this session" vs "long-term history".</p>
  <CodeBlock lang="typescript" code={`// Generate once per chat session, reuse for every turn in that session
const sessionId = randomUUID(); // e.g. "3f7a2b1c-..."

// Pass it to every ingest call in the session
await fetch(\`\${ANANSI_URL}/v1/ingest\`, {
  method: "POST",
  headers: { Authorization: \`Bearer \${ANANSI_KEY}\`, "Content-Type": "application/json" },
  body: JSON.stringify({
    userId: "user_abc",
    content: "User: How does BullMQ handle retries?\\nAssistant: ...",
    sourceType: "conversation",
    sessionId,               // same UUID for every turn in this session
  }),
});`} />

  <h2 id="memory-profile">What the profile looks like after a few sessions</h2>
  <CodeBlock lang="json" code={`{
  "static": [
    "Senior engineer at a fintech startup",
    "Prefers concise answers without preamble",
    "Uses TypeScript, BullMQ, and Postgres"
  ],
  "dynamic": [
    "Debugging a webhook deduplication issue this week",
    "Asked about Stripe idempotency keys in the last session"
  ],
  "relevant": [
    {
      "content": "User: What's the BullMQ default retry delay?\\nAssistant: Exponential backoff starting at 1s.",
      "similarity": 0.89,
      "metadata": { "sessionId": "3f7a2b1c-...", "timestamp": "2026-06-08T..." }
    }
  ]
}`} />
  <p>Claude receives this before every message — zero extra work from the user, zero re-introduction across sessions.</p>
</>)));

// ─── /docs/guides/voice-agent ─────────────────────────────────────────────────

docsRoutes.get("/guides/voice-agent", (c) => c.html(layout("/docs/guides/voice-agent", [
  { label: "Architecture", href: "#architecture" },
  { label: "Pre-warm at session start", href: "#pre-warm" },
  { label: "Per-turn implementation", href: "#implementation" },
  { label: "Latency targets", href: "#latency" },
  { label: "Caller identification", href: "#caller-identification" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/voice-agent">Guides</a><span class="breadcrumb-sep">/</span>Voice agent</div>
  <div class="page-title">Personalise a voice agent</div>
  <p class="page-sub">Give your voice agent persistent memory of each caller — names, preferences, past calls — served from a warm cache so retrieval stays off your critical path.</p>

  <div class="callout callout-warn">
    <div class="callout-tag">Warning</div>
    <div class="callout-body"><strong>Latency is everything in voice.</strong> A 200ms delay before TTS is audible. The patterns below keep Anansi off your critical path.</div>
  </div>

  <h2 class="first" id="architecture">Architecture</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body"><h3>Call connects → pre-warm memory</h3><p>Immediately fetch <code>GET /v1/context?userId=callerId</code> (no query). This primes the Redis cache so the first-turn retrieval is instant.</p></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><h3>User speaks → STT + memory in parallel</h3><p>Start transcription and fetch <code>/v1/context?userId=callerId&q=transcript</code> concurrently. Both finish around the same time.</p></div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><h3>Build system prompt → LLM → TTS</h3><p>Inject the memory profile. Generate response with Claude. Feed to ElevenLabs or OpenAI TTS.</p></div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body"><h3>Ingest the turn (background)</h3><p>Fire-and-forget <code>POST /v1/ingest</code> after TTS starts — never on the critical path.</p></div></div>
  </div>

  <h2 id="pre-warm">Pre-warm at session start</h2>
  <p>When the call connects, before the user says anything, kick off a context fetch with no query. This loads the synthesized profile into Redis cache (TTL 60s) so every turn in the call hits the fast path.</p>
  <CodeBlock lang="typescript" file="voice-session.ts" code={`const ANANSI_URL = "${APP_URL}";
const ANANSI_KEY = process.env.ANANSI_API_KEY!;

// Call this the moment the phone call connects
export async function onCallStart(callerId: string) {
  // Pre-warm: fetches the profile into the Redis cache so per-turn fetches hit the warm path
  const profile = await fetch(
    \`\${ANANSI_URL}/v1/context?userId=\${encodeURIComponent(callerId)}\`,
    { headers: { Authorization: \`Bearer \${ANANSI_KEY}\` } }
  ).then((r) => r.json());

  const isReturning = profile.static.length > 0;
  return { profile, isReturning };
}`} />

  <h2 id="implementation">Per-turn implementation</h2>
  <CodeBlock lang="typescript" file="voice-turn.ts" code={`import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function handleVoiceTurn(
  callerId: string,
  transcript: string,                              // from STT
  history: { role: "user" | "assistant"; content: string }[],
  sessionId: string
) {
  // Fetch memory with the transcript as query — concurrent with any post-STT work
  const memory = await fetch(
    \`\${ANANSI_URL}/v1/context?userId=\${encodeURIComponent(callerId)}&q=\${encodeURIComponent(transcript)}\`,
    { headers: { Authorization: \`Bearer \${ANANSI_KEY}\` } }
  ).then((r) => r.json());

  const isReturning = memory.static.length > 0;
  const system = [
    isReturning
      ? \`You remember this caller. Their name may appear in the facts below.\`
      : \`You are a friendly voice assistant. This is a new caller.\`,
    "Keep every response under 2 sentences. Natural, conversational tone.",
    ...memory.static.map((f: string) => \`Fact: \${f}\`),
    ...memory.dynamic.map((d: string) => \`Recent: \${d}\`),
  ].join("\\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    system,
    messages: [...history, { role: "user", content: transcript }],
    max_tokens: 100,   // short replies = faster TTS
  });

  const reply = response.content[0].type === "text" ? response.content[0].text : "";

  // Ingest after TTS starts — zero impact on latency
  fetch(\`\${ANANSI_URL}/v1/ingest\`, {
    method: "POST",
    headers: { Authorization: \`Bearer \${ANANSI_KEY}\`, "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: callerId,
      content: \`Caller: \${transcript}\\nAgent: \${reply}\`,
      sourceType: "voice",
      sessionId,
    }),
  }).catch(() => {});

  return reply;
}`} />

  <h2 id="latency">Keeping Anansi off the critical path</h2>
  <p>Latency depends on your deployment, your LLM, and your TTS provider, so we don't publish universal numbers. What you control is <em>where</em> Anansi sits in the turn:</p>
  <ul>
    <li><strong>Pre-warm at call start.</strong> A no-query <code>GET /v1/context</code> primes the Redis cache (60s TTL), so subsequent in-call fetches are served from cache rather than re-running retrieval.</li>
    <li><strong>Fetch memory in parallel with STT.</strong> Kick off the context fetch the moment transcription starts — both finish before you build the prompt, so retrieval adds no serial time.</li>
    <li><strong>Ingest off the response path.</strong> Fire-and-forget <code>POST /v1/ingest</code> after TTS starts. Ingest returns <code>202</code> immediately and embedding runs on a worker, so it never blocks the turn.</li>
  </ul>
  <p>Net effect: on the per-turn hot path your agent hits a warm cache read, and the LLM + TTS providers — not Anansi — dominate time-to-first-audio.</p>

  <h2 id="caller-identification">Caller identification strategies</h2>
  <ul>
    <li><strong>Phone number</strong> (<code>+14155551234</code>) — always available via Twilio or Vonage. Best for anonymous callers who call back.</li>
    <li><strong>Account ID</strong> — if callers enter a PIN to authenticate before the agent starts, use their account ID as userId.</li>
    <li><strong>Email / username</strong> — for authenticated web-based voice interfaces (browser microphone).</li>
  </ul>
</>)));

// ─── /docs/guides/multi-agent ────────────────────────────────────────────────

docsRoutes.get("/guides/multi-agent", (c) => c.html(layout("/docs/guides/multi-agent", [
  { label: "The pattern", href: "#pattern" },
  { label: "Background agent ingests", href: "#background-ingest" },
  { label: "Conversational agent retrieves", href: "#conversational-retrieve" },
  { label: "Agent-to-agent handoff", href: "#handoff" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/multi-agent">Guides</a><span class="breadcrumb-sep">/</span>Multi-agent</div>
  <div class="page-title">Multi-agent memory</div>
  <p class="page-sub">Share synthesized memory across agents — a background research agent ingests findings, and a conversational agent retrieves them. One user, many agents, one memory store.</p>

  <div class="callout callout-info">
    <div class="callout-tag">Note</div>
    <div class="callout-body"><strong>The key insight:</strong> <code>userId</code> is the shared key. Any agent that writes to a userId shares memory with any other agent that reads from the same userId.</div>
  </div>

  <h2 class="first" id="pattern">The pattern</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body"><h3>Background agent runs a task</h3><p>A research agent, summarizer, or data-processing agent completes work for a user. It ingests its output with <code>sourceType: "agent_summary"</code> and its own <code>agentId</code>.</p></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><h3>Synthesis runs automatically</h3><p>Anansi synthesizes all ingested content (from all agents) into a unified <code>static</code> + <code>dynamic</code> profile for that user.</p></div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><h3>Conversational agent retrieves</h3><p>The chat-facing agent calls <code>GET /v1/context</code> and gets the synthesized profile — including everything the background agent learned — without knowing or caring that another agent wrote it.</p></div></div>
  </div>

  <h2 id="background-ingest">Background agent: ingest findings</h2>
  <CodeBlock lang="typescript" file="research-agent.ts" code={`const ANANSI_URL = "${APP_URL}";
const ANANSI_KEY = process.env.ANANSI_API_KEY!;

// Called after the research agent completes a task for a user
export async function ingestAgentFindings(
  userId: string,
  findings: string,
  agentId: string = "research-agent-v1"
) {
  await fetch(\`\${ANANSI_URL}/v1/ingest\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${ANANSI_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId,
      content: findings,
      sourceType: "agent_summary",
      agentId,                   // tracked in metadata — visible in relevant[].metadata
      metadata: {
        title: "Research findings",
        timestamp: new Date().toISOString(),
      },
    }),
  });
}

// Example usage: after researching a topic for a user
await ingestAgentFindings(
  "user_abc",
  \`Research summary for user_abc:
  - They asked about distributed tracing three times this month
  - Expressed frustration with Jaeger's UI complexity
  - Currently evaluating Honeycomb vs Grafana Tempo
  - Has a Kubernetes cluster on GKE, uses OpenTelemetry SDK\`,
  "research-agent-v2"
);`} />

  <h2 id="conversational-retrieve">Conversational agent: retrieve unified memory</h2>
  <CodeBlock lang="typescript" file="chat-agent.ts" code={`// The conversational agent doesn't need to know about the research agent at all.
// It just reads context for the userId — Anansi has already synthesized everything.

export async function getContextForUser(userId: string, userMessage: string) {
  const memory = await fetch(
    \`\${ANANSI_URL}/v1/context?userId=\${encodeURIComponent(userId)}&q=\${encodeURIComponent(userMessage)}\`,
    { headers: { Authorization: \`Bearer \${ANANSI_KEY}\` } }
  ).then((r) => r.json());

  // memory.static now includes facts synthesized from both the conversation agent
  // AND anything the background research agent ingested for this user.
  // e.g. "Evaluating Honeycomb vs Grafana Tempo for distributed tracing"
  return memory;
}

// The relevant[] array will show which agent produced each chunk:
// relevant[0].metadata.agentId === "research-agent-v2"
// relevant[1].metadata.agentId === undefined  (came from conversation)`} />

  <h2 id="handoff">Agent-to-agent handoff example</h2>
  <p>A common pattern: an orchestrator spins up a specialist agent, that agent ingests its results, and then passes control to a different agent. The second agent starts with full context.</p>
  <CodeBlock lang="typescript" file="orchestrator.ts" code={`async function runPipeline(userId: string, task: string) {
  // Step 1: specialist agent runs and ingests its findings
  const findings = await runSpecialistAgent(userId, task);
  await ingestAgentFindings(userId, findings, "specialist-agent");

  // Step 2: summary agent reads unified memory (includes specialist's work)
  // No explicit handoff needed — Anansi is the shared state
  const memory = await getContextForUser(userId, "What should I tell the user?");

  // Step 3: conversational agent responds with full context
  return runConversationalAgent(userId, memory);
}`} />
</>)));

// ─── /docs/guides/tool-actions ────────────────────────────────────────────────

docsRoutes.get("/guides/tool-actions", (c) => c.html(layout("/docs/guides/tool-actions", [
  { label: "What to ingest", href: "#what-to-ingest" },
  { label: "Ingest an action", href: "#ingest-action" },
  { label: "Retrieve for personalisation", href: "#retrieve" },
  { label: "Action types reference", href: "#action-types" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/tool-actions">Guides</a><span class="breadcrumb-sep">/</span>Tool & action memory</div>
  <div class="page-title">Tool & action memory</div>
  <p class="page-sub">Every action a user takes in your app is a signal. Ingest it. Retrieve it. Use it to personalise every LLM interaction that follows.</p>

  <div class="callout callout-info">
    <div class="callout-tag">Note</div>
    <div class="callout-body"><strong>The pattern:</strong> whenever a user completes a meaningful action — creating a project, making a purchase, completing a task, toggling a feature — ingest a structured note. The synthesized memory will reflect their behaviour history.</div>
  </div>

  <h2 class="first" id="what-to-ingest">What to ingest</h2>
  <p>Ingest actions as structured sentences. Be specific enough that synthesis produces useful facts.</p>
  <table class="param-table">
    <thead><tr><th>Action</th><th>What to ingest</th></tr></thead>
    <tbody>
      <tr><td>Created project</td><td><code>"Created project 'API Gateway Rewrite' — goal: migrate from REST to GraphQL"</code></td></tr>
      <tr><td>Made purchase</td><td><code>"Purchased Pro plan. Previously on Free for 3 months."</code></td></tr>
      <tr><td>Completed task</td><td><code>"Completed 'Set up CI/CD pipeline' in the DevOps workspace"</code></td></tr>
      <tr><td>Enabled feature</td><td><code>"Enabled two-factor authentication on their account"</code></td></tr>
      <tr><td>Searched for</td><td><code>"Searched for 'webhook retry logic' three times this session"</code></td></tr>
    </tbody>
  </table>

  <h2 id="ingest-action">Ingest an action</h2>
  <CodeBlock lang="typescript" file="action-memory.ts" code={`const ANANSI_URL = "${APP_URL}";
const ANANSI_KEY = process.env.ANANSI_API_KEY!;

interface ActionEvent {
  userId: string;
  actionType: string;       // "project_created", "purchase", "task_completed", etc.
  description: string;      // human-readable summary of the action
  resourceId?: string;      // ID of the affected resource
  resourceType?: string;    // "project", "task", "order", etc.
}

export async function ingestAction(event: ActionEvent) {
  await fetch(\`\${ANANSI_URL}/v1/ingest\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${ANANSI_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: event.userId,
      content: event.description,
      sourceType: "action",
      metadata: {
        actionType: event.actionType,
        resourceId: event.resourceId,
        resourceType: event.resourceType,
        timestamp: new Date().toISOString(),
      },
    }),
  });
}

// Wire it up to your app events
await ingestAction({
  userId: "user_abc",
  actionType: "project_created",
  description: "Created project 'API Gateway Rewrite' with goal: migrate from REST to GraphQL. Team size: 3.",
  resourceId: "proj_xyz",
  resourceType: "project",
});

await ingestAction({
  userId: "user_abc",
  actionType: "task_completed",
  description: "Completed task 'Set up OpenTelemetry SDK' in the API Gateway Rewrite project.",
  resourceId: "task_123",
  resourceType: "task",
});`} />

  <h2 id="retrieve">Retrieve action history for personalisation</h2>
  <p>After a few actions, the synthesized profile reflects the user's behaviour pattern. Use it to personalise every subsequent LLM response.</p>
  <CodeBlock lang="typescript" code={`// Before any LLM call for this user
const memory = await fetch(
  \`\${ANANSI_URL}/v1/context?userId=user_abc&q=\${encodeURIComponent(userQuestion)}\`,
  { headers: { Authorization: \`Bearer \${ANANSI_KEY}\` } }
).then((r) => r.json());

// memory.static will contain synthesized action history:
// "Working on API Gateway Rewrite project (REST to GraphQL migration)"
// "Completed CI/CD and OpenTelemetry setup tasks"
// "Active in DevOps workspace"

// memory.relevant will surface specific action chunks:
// relevant[0].metadata.actionType === "project_created"
// relevant[0].metadata.resourceId === "proj_xyz"`} />

  <h2 id="action-types">Recommended action types</h2>
  <CodeBlock lang="typescript" code={`// Use consistent actionType strings — they appear in metadata and
// help you filter relevant[] results by action category later.

type ActionType =
  | "project_created" | "project_updated" | "project_completed"
  | "task_created"    | "task_completed"   | "task_blocked"
  | "purchase"        | "upgrade"          | "downgrade"
  | "feature_enabled" | "feature_disabled"
  | "search"          | "export"           | "share"
  | "login"           | "onboarding_step";`} />
</>)));

// ─── /docs/guides/onboarding ──────────────────────────────────────────────────

docsRoutes.get("/guides/onboarding", (c) => c.html(layout("/docs/guides/onboarding", [
  { label: "Why batch at onboarding", href: "#why-batch" },
  { label: "Batch ingest", href: "#batch-ingest" },
  { label: "Onboarding wizard example", href: "#wizard" },
  { label: "What to collect", href: "#what-to-collect" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/onboarding">Guides</a><span class="breadcrumb-sep">/</span>Onboarding</div>
  <div class="page-title">Onboarding memory</div>
  <p class="page-sub">Collect user context at sign-up and batch-ingest it so your app is personalised from the first message — no waiting for organic conversation.</p>

  <div class="callout callout-info">
    <div class="callout-tag">Note</div>
    <div class="callout-body"><strong>The idea:</strong> most apps have a sign-up or onboarding flow that collects role, goals, experience level, preferences. Ingest all of it at once. The user's memory profile is ready before they send their first message.</div>
  </div>

  <h2 class="first" id="why-batch">Why use batch ingest at onboarding</h2>
  <p>The standard <code>POST /v1/ingest</code> handles one item per call. For onboarding where you're writing 5–20 facts at once, <code>POST /v1/ingest/batch</code> sends them all in a single HTTP request and triggers synthesis once.</p>
  <div class="card-grid">
    <div class="card">
      <h3>Single ingest × 10</h3>
      <p>10 HTTP calls, synthesis triggered 10 times. Fine for conversation, wasteful for onboarding.</p>
    </div>
    <div class="card">
      <h3>Batch ingest × 1</h3>
      <p>1 HTTP call, synthesis triggered once. The right choice when you have the data upfront.</p>
    </div>
  </div>

  <h2 id="batch-ingest">Batch ingest endpoint</h2>
  <CodeBlock lang="shell" code={`POST ${APP_URL}/v1/ingest/batch
Authorization: Bearer ans_your_key
Content-Type: application/json`} />
  <CodeBlock lang="json" code={`{
  "items": [
    {
      "userId": "user_abc",
      "content": "Role: Senior backend engineer. Focus area: distributed systems and event-driven architecture.",
      "sourceType": "onboarding",
      "metadata": { "step": "role" }
    },
    {
      "userId": "user_abc",
      "content": "Primary goal: reduce API latency below 100ms p99 in production Kubernetes cluster.",
      "sourceType": "onboarding",
      "metadata": { "step": "goal" }
    },
    {
      "userId": "user_abc",
      "content": "Tech stack: Node.js, TypeScript, BullMQ, Postgres, Redis, GKE.",
      "sourceType": "onboarding",
      "metadata": { "step": "stack" }
    },
    {
      "userId": "user_abc",
      "content": "Prefers: concise technical answers, no preamble, code examples over prose.",
      "sourceType": "onboarding",
      "metadata": { "step": "preferences" }
    }
  ]
}`} />
  <Response status={202} body={`{
  "queued": 4,
  "ids": [
    "api:ws_xyz:user_abc:a1b2c3",
    "api:ws_xyz:user_abc:d4e5f6",
    "api:ws_xyz:user_abc:g7h8i9",
    "api:ws_xyz:user_abc:j0k1l2"
  ]
}`} />

  <h2 id="wizard">Onboarding wizard example</h2>
  <p>Wire batch ingest to the final step of your onboarding wizard — after the user completes all the steps, send everything at once:</p>
  <CodeBlock lang="typescript" file="onboarding.ts" code={`const ANANSI_URL = "${APP_URL}";
const ANANSI_KEY = process.env.ANANSI_API_KEY!;

interface OnboardingAnswers {
  userId: string;
  role: string;
  goal: string;
  stack: string;
  experience: string;
  preferences: string;
}

export async function ingestOnboarding(answers: OnboardingAnswers) {
  const items = [
    { content: \`Role: \${answers.role}\`, metadata: { step: "role" } },
    { content: \`Primary goal: \${answers.goal}\`, metadata: { step: "goal" } },
    { content: \`Tech stack: \${answers.stack}\`, metadata: { step: "stack" } },
    { content: \`Experience level: \${answers.experience}\`, metadata: { step: "experience" } },
    { content: \`Communication preferences: \${answers.preferences}\`, metadata: { step: "preferences" } },
  ].map((item) => ({
    userId: answers.userId,
    sourceType: "onboarding",
    ...item,
  }));

  const res = await fetch(\`\${ANANSI_URL}/v1/ingest/batch\`, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${ANANSI_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items }),
  });

  if (!res.ok) throw new Error(\`Anansi batch ingest failed: \${res.status}\`);
  return res.json(); // { queued: 5, ids: [...] }
}

// Call this at the end of your onboarding flow
await ingestOnboarding({
  userId: req.user.id,
  role: "Senior backend engineer — distributed systems",
  goal: "Reduce API latency below 100ms p99 in production",
  stack: "Node.js, TypeScript, BullMQ, Postgres, Redis, GKE",
  experience: "10 years backend, 2 years on this codebase",
  preferences: "Concise answers, code examples, no preamble",
});`} />

  <div class="callout callout-tip">
    <div class="callout-tag">Tip</div>
    <div class="callout-body"><strong>Synthesis happens once:</strong> Even if you batch 20 items, synthesis is triggered once after all items are ingested. The user's profile is ready within seconds of completing onboarding.</div>
  </div>

  <h2 id="what-to-collect">What to collect during onboarding</h2>
  <table class="param-table">
    <thead><tr><th>Category</th><th>Example questions</th><th>Why it matters</th></tr></thead>
    <tbody>
      <tr><td><strong>Role</strong></td><td>"What's your job title / team?"</td><td>Informs the expertise level Anansi synthesizes</td></tr>
      <tr><td><strong>Goal</strong></td><td>"What are you trying to accomplish?"</td><td>Surfaces as <code>dynamic</code> context immediately</td></tr>
      <tr><td><strong>Stack</strong></td><td>"What technologies do you use?"</td><td>Enables tech-specific suggestions</td></tr>
      <tr><td><strong>Preferences</strong></td><td>"How do you like answers formatted?"</td><td>Shapes every future LLM response style</td></tr>
      <tr><td><strong>Experience</strong></td><td>"How long have you been doing this?"</td><td>Calibrates depth of explanations</td></tr>
    </tbody>
  </table>
</>)));

// ─── /docs/guides/notion ──────────────────────────────────────────────────────

docsRoutes.get("/guides/notion", (c) => c.html(layout("/docs/guides/notion", [
  { label: "Connect Notion", href: "#connect-notion" },
  { label: "What gets indexed", href: "#what-gets-indexed" },
  { label: "Context output", href: "#context-output" },
  { label: "Sync frequency", href: "#sync-frequency" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/notion">Guides</a><span class="breadcrumb-sep">/</span>Notion connector</div>
  <div class="page-title">Notion connector</div>
  <p class="page-sub">Index your Notion workspace so Anansi can synthesize knowledge from your pages, wikis, and databases.</p>

  <h2 class="first" id="connect-notion">Connect Notion</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body"><h3>Open the connectors page</h3><p>Portal dashboard → <strong>Connected Apps</strong> → click <strong>Connect Notion</strong>.</p></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><h3>Grant access</h3><p>Select the pages and databases you want Anansi to index. Anansi only reads what you explicitly share.</p></div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><h3>First sync starts immediately</h3><p>Pages are chunked at heading boundaries, embedded, and indexed. Subsequent syncs are incremental.</p></div></div>
  </div>

  <h2 id="what-gets-indexed">What gets indexed</h2>
  <ul>
    <li>All page text content, headings, callouts, and toggles</li>
    <li>Database rows (each row treated as a separate document)</li>
    <li>Nested pages within shared pages</li>
    <li>Page titles, last-edited timestamps, authors (stored as metadata)</li>
  </ul>
  <p>Not indexed: images, embedded files, formula columns, synced blocks from external sources.</p>

  <h2 id="context-output">How content appears in context</h2>
  <CodeBlock lang="json" code={`{
  "relevant": [{
    "content": "## Stripe Integration\\nOwned by: Alex. Last updated Q4...",
    "similarity": 0.91,
    "metadata": {
      "sourceType": "notion_page",
      "title": "Stripe Integration",
      "lastEditedAt": "2026-05-12T..."
    }
  }]
}`} />

  <h2 id="sync-frequency">Sync frequency</h2>
  <p>Anansi syncs Notion every <strong>30 minutes</strong>. Only changed pages are re-indexed. The dashboard shows last sync time and page count under Connected Apps.</p>

  <h2>Disconnect</h2>
  <p>Dashboard → Connected Apps → Notion → <strong>Disconnect</strong>. Revokes the access token. Existing indexed content stays in memory until you purge it from the dashboard.</p>
</>)));

// ─── /docs/guides/meetings ────────────────────────────────────────────────────

docsRoutes.get("/guides/meetings", (c) => c.html(layout("/docs/guides/meetings", [
  { label: "How it works", href: "#how-it-works" },
  { label: "Webhook format", href: "#webhook-format" },
  { label: "Middleware example", href: "#middleware-example" },
  { label: "Synthesized memory", href: "#synthesized-memory" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/meetings">Guides</a><span class="breadcrumb-sep">/</span>Meeting transcripts</div>
  <div class="page-title">Meeting transcripts</div>
  <p class="page-sub">Automatically ingest meeting transcripts from Fireflies, Otter, Grain, Fathom, or any webhook-capable transcription service.</p>

  <h2 class="first" id="how-it-works">How it works</h2>
  <p>Most transcription services support <strong>post-meeting webhooks</strong>. You configure a URL, they <code>POST</code> the transcript after each meeting. Point it at your endpoint and forward to Anansi.</p>

  <h2 id="webhook-format">Webhook payload format</h2>
  <CodeBlock lang="shell" code={`POST ${APP_URL}/v1/ingest
Authorization: Bearer ans_your_key
Content-Type: application/json`} />
  <CodeBlock lang="json" code={`{
  "userId": "user_abc",
  "content": "Alice: Let's talk about Q3...\\nBob: I think we should...",
  "sourceType": "meeting",
  "metadata": {
    "title": "Q3 Planning — June 8",
    "participants": "Alice, Bob, Carol",
    "timestamp": "2026-06-08T14:00:00Z"
  }
}`} />

  <h2 id="middleware-example">Middleware example</h2>
  <CodeBlock lang="typescript" file="transcript-webhook.ts" code={`app.post("/transcript-webhook", async (req, res) => {
  const { title, transcript, organizer_email } = req.body;

  await fetch("${APP_URL}/v1/ingest", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.ANANSI_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: organizer_email,
      content: transcript,
      sourceType: "meeting",
      metadata: { title, timestamp: new Date().toISOString() },
    }),
  });

  res.json({ ok: true });
});`} />

  <h2>How Anansi chunks meeting content</h2>
  <p>Meeting transcripts are chunked at <strong>speaker turns</strong> (e.g. <code>Alice:</code>, <code>Bob:</code>) so each speaker's contribution stays semantically together — making vector search significantly more accurate.</p>

  <h2 id="synthesized-memory">What appears in synthesized memory</h2>
  <ul>
    <li><strong>static</strong> — recurring topics, team decisions, ownership ("Carol owns Q3 roadmap")</li>
    <li><strong>dynamic</strong> — current action items, open questions from recent meetings</li>
    <li><strong>relevant</strong> — specific meeting content matching your query, with <code>metadata.title</code></li>
  </ul>

  <div class="callout callout-tip">
    <div class="callout-tag">Tip</div>
    <div class="callout-body"><strong>Tip:</strong> Include <code>metadata.title</code> and <code>metadata.participants</code> — they surface in <code>relevant[].metadata</code>, letting you show "From: Q3 Planning — June 8" in your UI.</div>
  </div>
</>)));

// ─── /docs/guides/slack-memory ────────────────────────────────────────────────

docsRoutes.get("/guides/slack-memory", (c) => c.html(layout("/docs/guides/slack-memory", [
  { label: "Setup", href: "#setup" },
  { label: "Commands", href: "#commands" },
  { label: "Privacy", href: "#privacy" },
  { label: "Relation to the API", href: "#relation-to-api" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/slack-memory">Guides</a><span class="breadcrumb-sep">/</span>Slack memory</div>
  <div class="page-title">Slack-native memory</div>
  <p class="page-sub">Install the Anansi Slack app and your team's memory builds itself — no API calls, no glue code. A working showcase of the same engine behind the API.</p>

  <p>Anansi reads the public channels you choose and synthesizes two layers automatically:</p>
  <ul>
    <li><strong>Team memory</strong> — a shared, synthesized profile of what your whole team knows, decides, and is working on.</li>
    <li><strong>Per-person memory</strong> — for each teammate, a personal profile <em>and</em> a bi-temporal view of how their context changes over time (roles, projects, tools, who they work with). This is the same engine behind the <a href="/docs/guides/entity-graph">entity graph</a> and <a href="/docs/guides/temporal-memory">point-in-time queries</a> — populated straight from Slack.</li>
  </ul>

  <h2 class="first" id="setup">Setup</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body"><h3>Install the Slack app</h3><p>Complete the OAuth flow and pick which public channels to index.</p></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><h3>Backfill runs automatically</h3><p>Anansi backfills recent history, then keeps memory current as people post.</p></div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><h3>Ask questions</h3><p>Use <code>/ask</code> for answers from team memory, or <code>/memory</code> to inspect what's stored.</p></div></div>
  </div>
  <p>Only channels you select are read, and only the bot's channels. Direct messages are never ingested.</p>

  <h2 id="commands">Commands</h2>
  <table class="param-table">
    <thead><tr><th>Command</th><th>What it does</th></tr></thead>
    <tbody>
      <tr><td class="param-name">/ask &lt;question&gt;</td><td class="param-desc">Answer from team memory, in-channel</td></tr>
      <tr><td class="param-name">/ask quietly &lt;question&gt;</td><td class="param-desc">Same, but only you see the answer</td></tr>
      <tr><td class="param-name">/memory</td><td class="param-desc">Memory status: chunks, last synthesis, channel backfill</td></tr>
      <tr><td class="param-name">/memory me</td><td class="param-desc"><strong>Your</strong> synthesized profile — facts, current focus, timeline, connections</td></tr>
      <tr><td class="param-name">/memory about @user</td><td class="param-desc">A teammate's profile (only you see it)</td></tr>
      <tr><td class="param-name">/memory forget-me</td><td class="param-desc">Opt out — purge your personal profile, stop building one</td></tr>
      <tr><td class="param-name">/memory remember-me</td><td class="param-desc">Opt back in</td></tr>
      <tr><td class="param-name">/memory dashboard</td><td class="param-desc">DM yourself a magic link to the web dashboard</td></tr>
      <tr><td class="param-name">/memory purge [#channel] [confirm]</td><td class="param-desc">Admin: delete indexed memory</td></tr>
    </tbody>
  </table>
  <p><code>/memory me</code> renders the personal profile Anansi has synthesized for you:</p>
  <CodeBlock lang="text" code={`Your memory

Known facts
• Senior backend engineer; owns the payments service
• Prefers TypeScript and pnpm

Currently
• Migrating webhooks to the new retry queue

Timeline
• Works on Payments (since 2024-03) ✓
• Worked on Onboarding (2023-06 – 2024-03)

Connections
• you works with Dana
• you uses PostgreSQL`} />
  <p>Everything here is derived from what you've said in indexed public channels.</p>

  <h2 id="privacy">Privacy</h2>
  <p>Per-person memory is built only from <strong>public channel</strong> messages Anansi is invited to — never DMs, never private channels it isn't in. Still, anyone can opt out of having a <em>personal</em> profile with <code>/memory forget-me</code>. This immediately:</p>
  <ul>
    <li>deletes your synthesized personal profile and your entries in the entity graph,</li>
    <li>detaches your past messages from your personal memory (they remain part of the <strong>team</strong> profile, since they were public), and</li>
    <li>stops Anansi attributing future messages to you.</li>
  </ul>
  <p>Opt back in anytime with <code>/memory remember-me</code>. Admins can purge memory at the workspace or channel level with <code>/memory purge</code>.</p>

  <h2 id="relation-to-api">How it relates to the API</h2>
  <p>Slack-native memory uses the same store and synthesis as the <a href="/docs">developer API</a>. A Slack workspace is provisioned a developer account behind the scenes, so per-person Slack memory is queryable through the same <code>GET /v1/context</code> and <code>GET /v1/entities</code> endpoints (including <code>asOf</code> / <code>asOfKnowledge</code>) once you have an API key — Slack and API memory are one graph, not two.</p>
</>)));
