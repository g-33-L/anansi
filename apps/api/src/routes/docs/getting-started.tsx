/** @jsxImportSource hono/jsx */
import { docsRoutes } from "./router.js";
import { layout, CodeBlock, Response, APP_URL } from "./shared.js";

// ─── /docs ────────────────────────────────────────────────────────────────────

docsRoutes.get("/", (c) => c.html(layout("/docs", [
  { label: "What is Anansi?", href: "#what-is-anansi" },
  { label: "Quick navigation", href: "#quick-navigation" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Base URL", href: "#base-url" },
], <>
  <div class="doc-home-masthead">
    <div class="breadcrumb"><a href="/docs">Docs</a></div>
    <div class="doc-kicker">Research lab / Documentation</div>
    <div class="page-title">Anansi Documentation</div>
    <p class="page-sub">Persistent, synthesized memory for any LLM application. Two API calls. Works with any model.</p>
    <div class="doc-home-index"><span>HTTP API</span><span>Concepts</span><span>Implementation guides</span></div>
  </div>

  <h2 class="first" id="what-is-anansi">What is Anansi?</h2>
  <p>Anansi is a memory layer for AI applications. You send content to it — conversations, documents, notes, meeting transcripts — and it returns synthesized, curated context ready to inject into your LLM system prompt.</p>
  <p>Unlike raw vector databases, Anansi runs a <strong>two-layer synthesis pass</strong> on every user's data:</p>
  <ul>
    <li><strong>Static facts</strong> — stable knowledge about a user (up to 30). Preferences, background, recurring interests.</li>
    <li><strong>Dynamic context</strong> — current state (up to 15). What they're working on now, recent friction, active projects.</li>
    <li><strong>Relevant chunks</strong> — top vector search results for a specific query.</li>
  </ul>
  <p>This is what you inject before an LLM call — not a wall of raw chunks, but a curated profile that fits cleanly in a system prompt.</p>

  <div class="callout callout-tip">
    <div class="callout-tag">Tip</div>
    <div class="callout-body"><strong>Prompt-ready by default:</strong> plenty of memory stores can hand you a synthesized profile now — this isn't unique to Anansi. What's useful here is that <code>static</code> + <code>dynamic</code> come back in the exact shape a system prompt wants, so there's nothing to reshape before injection. If you'd rather have the raw scored chunks, <code>POST /v1/search</code> gives you those instead.</div>
  </div>

  <h2 id="quick-navigation">Quick navigation</h2>
  <div class="card-grid">
    <a href="/docs/quickstart" class="card">
      <h3>Quickstart</h3>
      <p>Get from zero to working memory in under 5 minutes.</p>
    </a>
    <a href="/docs/api-reference" class="card">
      <h3>API Reference</h3>
      <p>Full reference for /v1/ingest, /v1/context, and /v1/memory.</p>
    </a>
    <a href="/docs/guides/claude-chatbot" class="card">
      <h3>Claude chatbot</h3>
      <p>Add persistent user memory to a Claude-powered chatbot.</p>
    </a>
    <a href="/docs/guides/voice-agent" class="card">
      <h3>Voice agent</h3>
      <p>Personalise a voice agent with Anansi memory.</p>
    </a>
    <a href="/docs/guides/multi-agent" class="card">
      <h3>Multi-agent</h3>
      <p>Share memory across background and conversational agents.</p>
    </a>
    <a href="/docs/guides/tool-actions" class="card">
      <h3>Tool & action memory</h3>
      <p>Remember every user action to personalise future interactions.</p>
    </a>
    <a href="/docs/guides/onboarding" class="card">
      <h3>Onboarding</h3>
      <p>Batch-ingest onboarding answers so the app is personalised from day one.</p>
    </a>
    <a href="/docs/guides/notion" class="card">
      <h3>Notion connector</h3>
      <p>Connect your Notion workspace to the memory engine.</p>
    </a>
    <a href="/docs/guides/meetings" class="card">
      <h3>Meeting transcripts</h3>
      <p>Auto-ingest transcripts from any webhook source.</p>
    </a>
  </div>

  <h2 id="how-it-works">How it works</h2>
  <div class="steps">
    <div class="step"><div class="step-num">1</div><div class="step-body"><h3>Create an API key</h3><p>Sign up at <a href="/portal/login">/portal/login</a> and generate a key. Keys start with <code style="font-family:monospace;background:#232326;border:1px solid rgba(255,255,255,.1);padding:2px 6px;border-radius:4px;font-size:13px;color:#f5f5f7">ans_</code>.</p></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-body"><h3>Ingest content</h3><p><code>POST /v1/ingest</code> with a <code>userId</code> and <code>content</code> string. Chunking, embedding, and synthesis queue automatically.</p></div></div>
    <div class="step"><div class="step-num">3</div><div class="step-body"><h3>Synthesis runs in the background</h3><p>Anansi distills accumulated content into static facts and dynamic context for each user.</p></div></div>
    <div class="step"><div class="step-num">4</div><div class="step-body"><h3>Retrieve before your LLM call</h3><p><code>GET /v1/context?userId=X&q=topic</code> returns the synthesized profile. Inject into your system prompt.</p></div></div>
  </div>

  <h2 id="base-url">Base URL</h2>
  <CodeBlock lang="text" code={APP_URL} />
</>)));

// ─── /docs/quickstart ─────────────────────────────────────────────────────────

docsRoutes.get("/quickstart", (c) => c.html(layout("/docs/quickstart", [
  { label: "Get an API key", href: "#get-an-api-key" },
  { label: "Ingest content", href: "#ingest-content" },
  { label: "Retrieve context", href: "#retrieve-context" },
  { label: "Inject into LLM", href: "#inject-into-llm" },
  { label: "Delete memory", href: "#delete-memory" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span>Quickstart</div>
  <div class="page-title">Quickstart</div>
  <p class="page-sub">From zero to working memory in under 5 minutes.</p>

  <div class="callout callout-info">
    <div class="callout-tag">Beta</div>
    <div class="callout-body"><strong>Anansi is currently in private beta.</strong> New signups are invite-only while the API is being hardened. <a href="/#waitlist">Join the waitlist</a> for early access. If you already have an account, sign in at <a href="/portal/login">/portal/login</a>.</div>
  </div>

  <h2 class="first" id="get-an-api-key">1. Get an API key</h2>
  <p>Sign up at <a href="/portal/login">/portal/login</a> with your email. You'll get a magic link — click it and create an API key from your dashboard.</p>
  <div class="callout callout-warn">
    <div class="callout-tag">Warning</div>
    <div class="callout-body"><strong>Keep your key secret.</strong> Never expose it in frontend code or commit it to git. Use environment variables.</div>
  </div>

  <h2 id="ingest-content">2. Ingest some content</h2>
  <CodeBlock lang="shell" code={`curl -X POST ${APP_URL}/v1/ingest \\
  -H "Authorization: Bearer ans_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"userId":"user_abc","content":"User prefers TypeScript. Building a webhook retry system with BullMQ."}'`} />
  <Response status={202} body={`{ "id": "api:ws:user_abc:uuid", "queued": true }`} />

  <h2>3. Wait for synthesis</h2>
  <p>Synthesis runs in the background. For a quick test, wait about 10–15 seconds before querying. In production, synthesis keeps up automatically.</p>

  <h2 id="retrieve-context">4. Retrieve context</h2>
  <CodeBlock lang="shell" code={`curl "${APP_URL}/v1/context?userId=user_abc&q=webhook+retry" \\
  -H "Authorization: Bearer ans_your_key"`} />
  <Response status={200} body={`{
  "static": ["Prefers TypeScript", "Uses BullMQ for job queues"],
  "dynamic": ["Working on webhook retry system"],
  "relevant": [{ "content": "User prefers TypeScript...", "similarity": 0.87 }]
}`} />

  <h2 id="inject-into-llm">5. Inject into your LLM call</h2>
  <CodeBlock lang="typescript" file="chatbot.ts" code={`const ctx = await fetch(
  \`${APP_URL}/v1/context?userId=\${userId}&q=\${encodeURIComponent(question)}\`,
  { headers: { Authorization: \`Bearer \${process.env.ANANSI_KEY}\` } }
).then(r => r.json());

const memoryBlock = [
  ...ctx.static.map((f: string) => \`Fact: \${f}\`),
  ...ctx.dynamic.map((d: string) => \`Context: \${d}\`),
].join("\\n");

const response = await anthropic.messages.create({
  model: "claude-haiku-4-5-20251001",
  system: \`You are a helpful assistant.\\n\\n## User memory\\n\${memoryBlock}\`,
  messages: [{ role: "user", content: question }],
});`} />

  <h2 id="delete-memory">6. Delete memory</h2>
  <CodeBlock lang="shell" code={`curl -X DELETE "${APP_URL}/v1/memory?userId=user_abc" \\
  -H "Authorization: Bearer ans_your_key"`} />
  <Response status={200} body={`{ "deleted": 7 }`} />

  <div class="callout callout-info">
    <div class="callout-tag">Note</div>
    <div class="callout-body">Ready for the full details? See the <a href="/docs/api-reference">API Reference</a> for all parameters, error codes, and rate limits.</div>
  </div>
</>)));

// ─── /docs/landscape ─────────────────────────────────────────────────────────

docsRoutes.get("/landscape", (c) => c.html(layout("/docs/landscape", [
  { label: "The honest summary", href: "#summary" },
  { label: "Direct competitors", href: "#direct" },
  { label: "Adjacent tools", href: "#adjacent" },
  { label: "When NOT to pick Anansi", href: "#when-not" },
  { label: "Quick comparison", href: "#table" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span>Landscape</div>
  <div class="page-title">Memory landscape</div>
  <p class="page-sub">An honest look at where Anansi sits next to the other memory tools for AI apps. Updated whenever the field shifts.</p>

  <h2 class="first" id="summary">The honest summary</h2>
  <p>"Memory for AI apps" is a real category now. Several teams are building in this space, and they aren't all solving the same problem. Here's where Anansi fits.</p>
  <p><strong>Anansi returns a synthesized profile — <code>static</code> facts and <code>dynamic</code> context, ready to drop into a system prompt — backed by a bi-temporal knowledge graph you can query as it was at any point in the past.</strong> Several tools now return profiles; where Anansi is genuinely differentiated is the knowledge-time query (<code>asOfKnowledge</code> — not in Mem0's or Supermemory's public APIs as of mid-2026), MIT self-hosting with a full local-model path, and a first-party Slack app.</p>

  <h2 id="direct">Direct competitors</h2>

  <h3>Mem0 — open-source personal AI memory</h3>
  <p><strong>What it is:</strong> The most popular OSS memory library. Vector search + an LLM fact-extraction pass at ingest. Strong ecosystem (VAPI, CrewAI, autogen integrations shipped).</p>
  <p><strong>Where it overlaps:</strong> It's the closest thing to synthesis in the OSS space — they extract atomic facts on write and retrieve them on read.</p>
  <p><strong>Where Anansi is different:</strong> Managed hosted API (Mem0 wants you to self-host Postgres + Qdrant + their server). Workspace-wide team profile. Bi-temporal queries (<code>asOf</code> + <code>asOfKnowledge</code>). Bring-your-own embeddings. A polished portal, billing, and 4 SDKs out of the box.</p>
  <p><strong>Pick Mem0 if:</strong> You want OSS, will self-host, and don't need team-wide memory or time-travel queries.</p>

  <h3>Supermemory — connectors + entity graph + chunks</h3>
  <p><strong>What it is:</strong> Memory API with a strong connector story (Notion, GDocs, Chrome extension), entity graph, and an MCP server.</p>
  <p><strong>Where it overlaps:</strong> Hosted API, connectors, entity graph, MCP support.</p>
  <p><strong>Where Anansi is different:</strong> knowledge-time queries (<code>asOfKnowledge</code> — reconstruct the graph as you knew it at a past instant), MIT self-hosting with a full local-model path (Ollama), a first-party Slack app, bring-your-own embeddings, and tighter entry pricing ($19/mo Pro). Both return prompt-ready profiles — the time axis and the self-host story are the real differences.</p>
  <p><strong>Pick Supermemory if:</strong> You want their Chrome extension to capture browsing history into memory, or their broader catalog of managed connectors.</p>

  <h3>Zep — temporal knowledge graph for agents</h3>
  <p><strong>What it is:</strong> Open-core memory layer that builds a temporal entity graph with summarization. Strongest competitor on the time axis.</p>
  <p><strong>Where it overlaps:</strong> Temporal facts, entity graph, user/session scoping, hosted cloud option.</p>
  <p><strong>Where Anansi is different:</strong> Zep is heavier to adopt — you run their server + graph DB or pay enterprise pricing for their cloud. Anansi is two API calls with a free tier. Anansi's synthesis output is designed for prompt injection; Zep's is designed for retrieval.</p>
  <p><strong>Pick Zep if:</strong> You're an enterprise team with budget for a dedicated memory infrastructure and you need the deepest temporal graph available.</p>

  <h3>Letta (was MemGPT) — stateful agent runtime</h3>
  <p><strong>What it is:</strong> A whole agent framework with memory paging built in. Lets agents "page" between core and recall memory like an OS.</p>
  <p><strong>Where it overlaps:</strong> The headline "persistent agent memory."</p>
  <p><strong>Where Anansi is different:</strong> Letta is a runtime; Anansi is an API. You build your app <em>inside</em> Letta. With Anansi, you make two HTTP calls from whatever stack you already have.</p>
  <p><strong>Pick Letta if:</strong> You're starting fresh and want a full agent framework, not just a memory layer.</p>

  <h3>LangMem — LangChain's built-in memory</h3>
  <p><strong>What it is:</strong> Memory module that ships inside LangChain.</p>
  <p><strong>Where it overlaps:</strong> If you're already on LangChain, this is free and native.</p>
  <p><strong>Where Anansi is different:</strong> LangMem isn't a service — it's a module inside LangChain. No connectors, no managed retrieval, no synthesis output you can use outside LangChain. We ship an <a href="https://www.npmjs.com/package/anansi-langchain" target="_blank" rel="noopener">anansi-langchain</a> adapter so you can use Anansi <em>from</em> LangChain.</p>
  <p><strong>Pick LangMem if:</strong> Your whole app lives inside LangChain and you don't need anything beyond the basics.</p>

  <h2 id="adjacent">Adjacent tools (different problem)</h2>

  <p>These get mentioned in the same conversations but solve different problems:</p>

  <ul>
    <li><strong>Pinecone, Weaviate, Qdrant, pgvector</strong> — vector databases. They're the storage primitive. Anansi uses pgvector under the hood. "Vector DB" is not "memory" — it's one layer of the stack.</li>
    <li><strong>OpenAI Memory, Anthropic Memory, ChatGPT Memory</strong> — built into consumer products. Not exposed as APIs to developers building their own apps on top.</li>
    <li><strong>Honcho</strong> — leans more "user modeling" (personality, preferences) than "session/context memory." Some overlap, but different focus.</li>
    <li><strong>Moss</strong> — on-device WASM retrieval optimized for sub-10ms latency. Solves ephemeral session context, not persistent user memory. Different use case.</li>
    <li><strong>Cognee</strong> — research-leaning knowledge graph memory layer. Earlier-stage, not optimized for production hot paths.</li>
  </ul>

  <h2 id="when-not">When NOT to pick Anansi</h2>

  <div class="callout callout-info">
    <div class="callout-tag">Honest</div>
    <div class="callout-body">We'd rather you pick the right tool than the wrong tool with our name on it. Anansi is not the answer for every case.</div>
  </div>

  <ul>
    <li><strong>You need on-device / edge inference latency (single-digit ms, no network hop).</strong> Use Moss or an in-process vector store. Anansi is a network service — every call is at least a round-trip.</li>
    <li><strong>You need multimodal ingest (images, audio) today.</strong> Anansi is text-only right now (PDFs and DOCX are parsed to text). If you need native image or audio memory, look at Mem0.</li>
    <li><strong>You're already deep in LangChain and your app is small.</strong> LangMem is free and native. Reach for Anansi when you outgrow it (workspace memory, bi-temporal queries, connectors).</li>
    <li><strong>You need a Chrome extension that captures browsing history into memory today.</strong> Supermemory has shipped that; ours is on the roadmap.</li>
    <li><strong>You're building the agent itself, not bolting memory onto an app.</strong> Letta gives you a stateful runtime; Anansi gives you a memory API.</li>
  </ul>

  <h2 id="table">Quick comparison</h2>

  <div style="overflow-x:auto">
    <table class="param-table" style="min-width:760px">
      <thead>
        <tr>
          <th>Feature</th>
          <th>Anansi</th>
          <th>Supermemory</th>
          <th>Mem0</th>
          <th>Zep</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Synthesized profile (static + dynamic) ready for prompt injection</td>
          <td>✓</td>
          <td>✓</td>
          <td>Facts</td>
          <td>Summaries</td>
        </tr>
        <tr>
          <td>Hybrid search (BM25 + vector + RRF)</td>
          <td>✓</td>
          <td>Vector</td>
          <td>Vector</td>
          <td>✓</td>
        </tr>
        <tr>
          <td>Entity graph</td>
          <td>✓</td>
          <td>✓</td>
          <td>Limited</td>
          <td>✓</td>
        </tr>
        <tr>
          <td>Knowledge-time queries — the graph "as we knew it" (<code>asOfKnowledge</code>)</td>
          <td>✓</td>
          <td>—</td>
          <td>—</td>
          <td>✓</td>
        </tr>
        <tr>
          <td>Workspace-scoped (team-wide) profile</td>
          <td>✓</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
        </tr>
        <tr>
          <td>Bring-your-own embeddings</td>
          <td>✓</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
        </tr>
        <tr>
          <td>Per-chunk TTL (ephemeral memory)</td>
          <td>✓</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
        </tr>
        <tr>
          <td>Connectors (Notion, GDocs, Linear, transcripts)</td>
          <td>✓</td>
          <td>✓</td>
          <td>—</td>
          <td>—</td>
        </tr>
        <tr>
          <td>Chrome extension</td>
          <td>Coming soon</td>
          <td>✓</td>
          <td>—</td>
          <td>—</td>
        </tr>
        <tr>
          <td>MCP server for Claude Desktop</td>
          <td>✓</td>
          <td>✓</td>
          <td>—</td>
          <td>—</td>
        </tr>
        <tr>
          <td>Hosted managed API</td>
          <td>✓</td>
          <td>✓</td>
          <td>Limited</td>
          <td>✓</td>
        </tr>
        <tr>
          <td>OSS / self-hostable</td>
          <td>✓ MIT (full stack)</td>
          <td>—</td>
          <td>✓</td>
          <td>Open-core</td>
        </tr>
        <tr>
          <td>Cheapest paid tier</td>
          <td>$19/mo</td>
          <td>Higher</td>
          <td>Self-host = free</td>
          <td>Enterprise</td>
        </tr>
      </tbody>
    </table>
  </div>

  <p style="margin-top:24px;font-size:.85rem;color:#636366">Last updated: {new Date().toISOString().slice(0, 10)}. Spot something out of date or unfair? <a href="mailto:anansi.memory@gmail.com?subject=Landscape%20page%20feedback">Email us</a> — we'll fix it.</p>

</>)));

docsRoutes.get("/faq", (c) => c.html(layout("/docs/faq", [
  { label: "Getting started", href: "#getting-started" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Knowledge-time & the graph", href: "#bi-temporal" },
  { label: "Pricing & plans", href: "#pricing" },
  { label: "Models & self-hosting", href: "#self-hosting" },
  { label: "Security & privacy", href: "#security" },
  { label: "Data & deletion", href: "#data" },
  { label: "Performance & reliability", href: "#reliability" },
  { label: "How it compares", href: "#comparisons" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span>FAQ</div>
  <div class="page-title">Frequently asked questions</div>
  <p class="page-sub">Straight answers, grounded in how Anansi actually works. If something here is unclear or looks wrong, <a href="mailto:anansi.memory@gmail.com?subject=FAQ%20feedback">tell us</a> and we'll fix it.</p>

  <h2 class="first" id="getting-started">Getting started</h2>

  <h3>What is Anansi?</h3>
  <p>A memory API for AI apps. Your app sends Anansi a user's messages and documents; Anansi stores and embeds them, synthesizes a per-user profile, and serves it back ready to drop into a system prompt. Two calls do the job: <code>POST /v1/ingest</code> to remember, <code>GET /v1/context</code> to retrieve.</p>

  <h3>What problem does it solve?</h3>
  <p>LLM apps are stateless — users repeat themselves every session. The usual workarounds are stuffing raw history into the prompt (context bloat, quality decay) or building your own vector store plus a dedup/ranking pipeline. Anansi is a drop-in memory layer that removes that work.</p>

  <h3>How long does it take to integrate?</h3>
  <p>Usually a few minutes. Install the SDK (or call the REST API directly), add an <code>ingest</code> call where your app produces content, and a <code>context</code> call before your LLM call. That's the whole integration.</p>

  <h3>Do I need the SDK?</h3>
  <p>No. The contract is REST with a bearer token and JSON responses. SDKs (TypeScript, Python, Vercel AI SDK, LangChain, an MCP server, and framework-agnostic tools) are convenience wrappers.</p>

  <h2 id="how-it-works">How it works</h2>

  <h3>What does <code>GET /v1/context</code> return?</h3>
  <p><code>static</code> facts (stable truths about the user, up to 30), <code>dynamic</code> context (current state, up to 15), and — when you pass a <code>q</code> — <code>relevant</code> chunks. On Pro and above the response also includes <code>temporal</code> facts and the <code>entities</code> graph. The <code>static</code> and <code>dynamic</code> arrays drop straight into a system prompt with no post-processing.</p>

  <h3>What's the difference between static and dynamic?</h3>
  <p><code>static</code> is stable ("Senior engineer at a fintech startup", "Prefers TypeScript"); <code>dynamic</code> is what's happening now ("Debugging a webhook dedup issue this week"). The synthesis worker re-derives both as new evidence arrives.</p>

  <h3>Is ingestion synchronous?</h3>
  <p>No. <code>POST /v1/ingest</code> returns <code>202</code> immediately; chunking, embedding, and synthesis run on background workers. That keeps ingest off your request path — ideal for latency-sensitive apps like voice agents.</p>

  <h3>What retrieval does it use?</h3>
  <p>Hybrid search: pgvector cosine similarity plus Postgres BM25, merged with reciprocal rank fusion (or an alpha weighting you control). Vector-only search misses exact lookups; BM25 catches them.</p>

  <h3>Can I bring my own embeddings?</h3>
  <p>Yes. Pass a pre-computed 768-dim <code>embedding</code> on <code>ingest</code> and Anansi stores your vector directly, skipping the internal embedding provider.</p>

  <h2 id="bi-temporal">Knowledge-time & the graph</h2>

  <h3>What does "bi-temporal" mean here?</h3>
  <p>Every relationship the synthesis worker extracts carries two independent time axes: <em>valid-time</em> (when the fact was true in the world) and <em>knowledge-time</em> (when Anansi learned it). Most memory stores track only the first, or just overwrite.</p>

  <h3>What's the difference between <code>asOf</code> and <code>asOfKnowledge</code>?</h3>
  <p><code>asOf</code> reconstructs the graph as it was <em>valid</em> at an instant. <code>asOfKnowledge</code> reconstructs it <em>as you knew it</em> at an instant. Together they answer "what was true on May 1 — as we understood it on May 1?" versus "what was true on May 1 — as we know it today?"</p>

  <h3>Why does knowledge-time matter?</h3>
  <p>Two reasons. Audit: "what did we know on March 3rd when we made that call?" is answerable instead of silently rewritten. And debugging agents: you can reconstruct exactly what an agent knew at the moment it made a decision. It's a Pro+ feature (<code>GET /v1/entities</code>).</p>

  <h3>Does anyone else offer knowledge-time queries?</h3>
  <p>Zep (Graphiti) models bi-temporality too — we do not claim this is unique against them. As of mid-2026, neither Mem0's nor Supermemory's public APIs expose a knowledge-time query. See the <a href="/docs/landscape">landscape page</a> for the honest full comparison.</p>

  <h2 id="pricing">Pricing & plans</h2>

  <h3>How much does it cost?</h3>
  <p>Free ($0), Pro ($19/mo), Scale ($99/mo), and Enterprise (contact us). Usage-metered, cancel anytime from the portal.</p>

  <h3>What's in the free tier?</h3>
  <p>1,000 ingest calls and 500 context calls per month, 10 memory users, 7-day retention, vector retrieval. No credit card required.</p>

  <h3>What unlocks on Pro?</h3>
  <p>25,000 ingest / 10,000 context calls, unlimited memory users, unlimited retention, hybrid and keyword search, metadata filters, the entity graph and bi-temporal queries, workspace-scoped context, all connectors, and outbound webhooks. A 14-day trial is included.</p>

  <h3>What happens when I exceed a limit?</h3>
  <p>Calls beyond your monthly quota return <code>402</code> with an upgrade message. Per-minute rate limits return <code>429</code> with <code>Retry-After: 60</code>.</p>

  <h2 id="self-hosting">Models & self-hosting</h2>

  <h3>Which LLM does Anansi use?</h3>
  <p>A provider chain: Cerebras (<code>gpt-oss-120b</code>) first, then GitHub Models (<code>gpt-4o-mini</code>), then local Ollama (<code>llama3.1:8b</code>). Query and synthesis have separate model slots, so you can route synthesis to a stronger model. Embeddings use Nomic <code>nomic-embed-text-v1.5</code>, falling back to Ollama.</p>

  <h3>Can it run fully local / offline?</h3>
  <p>Yes. With no cloud API keys set, the LLM and embedding providers automatically fall back to local Ollama, so the whole stack runs with zero external API calls. One honest caveat: we have not yet validated synthesis quality — especially bi-temporal entity extraction — on the small local <code>llama3.1:8b</code> model. Treat fully-local mode as great for development, offline work, and privacy prototyping; for production-grade synthesis accuracy, set a remote LLM key.</p>

  <h3>Is it really self-hostable?</h3>
  <p>Yes, and MIT-licensed with no open-core asterisks. <code>docker compose up -d</code> brings up PostgreSQL (pgvector) and Redis; the API ships its own Dockerfile. You can read the retrieval and synthesis code before you trust it with your users' memory.</p>

  <h3>Do I have to send my users' data to your servers?</h3>
  <p>Not if you self-host — memory never leaves your infrastructure. On the hosted service, your data is stored in our Postgres and processed by the configured LLM/embedding providers.</p>

  <h2 id="security">Security & privacy</h2>

  <h3>How are API keys stored?</h3>
  <p>Hashed with HMAC-SHA256 (using a dedicated secret, separate from the token-encryption key). Raw keys are never stored, and a regex fast-reject filters obviously-invalid keys before any database hit.</p>

  <h3>How is tenant isolation enforced?</h3>
  <div class="callout callout-info"><div class="callout-tag">Straight answer</div><div class="callout-body">Isolation is enforced in the application layer — every query scopes to the authenticated <code>workspace_id</code> / <code>developer_id</code>. Postgres row-level security is enabled on <code>memory_chunks</code> as a NULL-guard safety net, <em>not</em> as the isolation boundary. We'd rather tell you exactly how it works than imply RLS is doing more than it is.</div></div>

  <h3>Are secrets redacted from ingested content?</h3>
  <p>Yes. Detected secrets are redacted on ingest, and end-user text is run through prompt-injection neutralization before it ever reaches an LLM. OAuth tokens (Slack, Notion, Google) are AES-256-GCM encrypted at rest.</p>

  <h3>Are outbound webhooks safe?</h3>
  <p>Yes. Webhook and URL-ingestion targets are validated against an SSRF allowlist (HTTPS only, no private/RFC-1918 addresses), with re-validation across redirects.</p>

  <h2 id="data">Data & deletion</h2>

  <h3>How do I delete a user's memory?</h3>
  <p><code>DELETE /v1/memory?userId=…</code> wipes all chunks, the synthesized profile, and the entity graph (the user row is kept so you can re-ingest). Add <code>sourceId</code> to delete just one ingested document. Caches are evicted on delete.</p>

  <h3>How do I do a GDPR hard-delete?</h3>
  <p><code>DELETE /v1/user?userId=…</code> removes the user row and all cascaded child data (chunks, profile, entity nodes and edges) and evicts caches. It's idempotent — deleting an unknown user still returns <code>{"{"}deleted: true{"}"}</code>.</p>

  <h3>How long is data retained?</h3>
  <p>7 days on Free, unlimited on paid plans. You can also set a per-chunk TTL on ingest for ephemeral memory.</p>

  <h2 id="reliability">Performance & reliability</h2>

  <h3>Do you publish latency or throughput benchmarks?</h3>
  <div class="callout callout-info"><div class="callout-tag">Honest</div><div class="callout-body">No. We don't have published, reproducible benchmarks yet, so we don't cite specific latency or uptime numbers — you shouldn't trust ones we can't back. What we can tell you structurally: <code>context</code> reads hit a Redis cache (60s TTL), ingest is async (returns <code>202</code>), and embedding/synthesis run off the request path. When we have a real benchmark, we'll publish the methodology with it.</div></div>

  <h3>Is there a status page?</h3>
  <p>Yes — <a href="/status">/status</a> reports live PostgreSQL and Redis connectivity plus the running API version. Every API response also carries an <code>API-Version</code> header.</p>

  <h3>How does it scale, and what are the limits?</h3>
  <p>The API and background workers scale out independently. Today it runs on a single Postgres and Redis in a single region — honestly, that's the current ceiling, and it's plenty for launch-scale traffic. Larger deployments would move Postgres to a managed provider with read replicas.</p>

  <h2 id="comparisons">How it compares</h2>

  <h3>How is Anansi different from Mem0, Supermemory, and Zep?</h3>
  <p>They're all capable tools, and several now return synthesized profiles and offer graph or temporal memory — we won't pretend otherwise. Where Anansi is genuinely differentiated: knowledge-time queries (<code>asOfKnowledge</code>, not in Mem0's or Supermemory's public APIs), MIT self-hosting with a full local-model path, and a first-party Slack app. The <a href="/docs/landscape">landscape page</a> is the honest, tool-by-tool breakdown.</p>

  <h3>Should I use Anansi or just build on pgvector myself?</h3>
  <p>Build it yourself if you want full control and don't need synthesis, hybrid search, a temporal graph, and billing out of the box. Use Anansi to skip weeks of pipeline work — it's two calls instead of a vector store plus a dedup/ranking/synthesis layer you maintain.</p>

  <p style="margin-top:24px;font-size:.85rem;color:#636366">Didn't find your answer? <a href="mailto:anansi.memory@gmail.com?subject=FAQ%20question">Email us</a> or open an issue on <a href="https://github.com/g-33-L/anansi">GitHub</a>.</p>
</>)));
