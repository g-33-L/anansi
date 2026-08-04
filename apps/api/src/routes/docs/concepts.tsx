/** @jsxImportSource hono/jsx */
import { docsRoutes } from "./router.js";
import { layout, CodeBlock, APP_URL } from "./shared.js";

// ─── /docs/guides/entity-graph ────────────────────────────────────────────────

docsRoutes.get("/guides/entity-graph", (c) => c.html(layout("/docs/guides/entity-graph", [
  { label: "What gets extracted", href: "#what-gets-extracted" },
  { label: "Bi-temporal edges", href: "#bi-temporal-edges" },
  { label: "Reading the graph", href: "#reading-the-graph" },
  { label: "Temporal facts", href: "#temporal-facts" },
  { label: "Entities in a prompt", href: "#entities-in-a-prompt" },
  { label: "When entities populate", href: "#when-entities-populate" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/entity-graph">Concepts</a><span class="breadcrumb-sep">/</span>Entity graph</div>
  <div class="page-title">Entity graph</div>
  <p class="page-sub">Every synthesis pass extracts entities and relationships into a bi-temporal knowledge graph — who a user knows, what they use, where they work, and <em>when</em> each of those was true.</p>

  <h2 class="first" id="what-gets-extracted">What gets extracted</h2>
  <p>The synthesis worker identifies five entity types:</p>
  <table class="param-table">
    <thead><tr><th>Type</th><th>Examples</th></tr></thead>
    <tbody>
      <tr><td class="param-name">person</td><td class="param-desc">"Alex", "my manager Sarah"</td></tr>
      <tr><td class="param-name">org</td><td class="param-desc">"Stripe", "Acme Corp", "Y Combinator"</td></tr>
      <tr><td class="param-name">tech</td><td class="param-desc">"Next.js", "PostgreSQL", "BullMQ"</td></tr>
      <tr><td class="param-name">project</td><td class="param-desc">"Project Atlas", "the payments rewrite"</td></tr>
      <tr><td class="param-name">location</td><td class="param-desc">"San Francisco", "HQ"</td></tr>
    </tbody>
  </table>
  <p>And six relationship types:</p>
  <table class="param-table">
    <thead><tr><th>Relationship</th><th>Meaning</th></tr></thead>
    <tbody>
      <tr><td class="param-name">works_at</td><td class="param-desc">person → org</td></tr>
      <tr><td class="param-name">uses</td><td class="param-desc">person/project → tech</td></tr>
      <tr><td class="param-name">knows</td><td class="param-desc">person → person</td></tr>
      <tr><td class="param-name">member_of</td><td class="param-desc">person → org/project</td></tr>
      <tr><td class="param-name">reports_to</td><td class="param-desc">person → person</td></tr>
      <tr><td class="param-name">part_of</td><td class="param-desc">project → org</td></tr>
    </tbody>
  </table>

  <h2 id="bi-temporal-edges">Bi-temporal edges</h2>
  <p>Each relationship is stored as an edge with validity bounds:</p>
  <CodeBlock lang="json" code={`{
  "relationship": "works_at",
  "target": { "id": "...", "type": "org", "name": "Stripe" },
  "validFrom": "2024-01-01T00:00:00Z",
  "validUntil": null,
  "current": true
}`} />
  <ul>
    <li><strong><code>validFrom</code></strong> — when this relationship became true (derived from chunk timestamps)</li>
    <li><strong><code>validUntil</code></strong> — when it stopped being true; <code>null</code> means currently active</li>
    <li><strong><code>current</code></strong> — convenience boolean, <code>true</code> when <code>validUntil</code> is <code>null</code></li>
  </ul>
  <p>If synthesis later learns "Alex left Stripe and joined Anthropic", the Stripe edge gets <code>validUntil</code> set and a new Anthropic edge is created. Both are preserved — you get the full history, not a snapshot. Edges also carry a second, independent <strong>knowledge-time</strong> axis (when Anansi <em>learned</em> each boundary) — see <a href="/docs/guides/temporal-memory">temporal memory</a> for <code>asOf</code> and <code>asOfKnowledge</code> point queries.</p>

  <h2 id="reading-the-graph">How to read the graph</h2>
  <p>Every <code>GET /v1/context</code> response includes <code>entities[]</code>:</p>
  <CodeBlock lang="typescript" code={`const ctx = await memory.context({ userId: 'user_123' });

for (const entity of ctx.entities) {
  console.log(entity.name, entity.type);
  for (const rel of entity.relationships) {
    if (rel.current) {
      console.log(\`  → \${rel.relationship} \${rel.target.name}\`);
    }
  }
}`} />
  <p>Response shape (same as <code>GET /v1/entities</code>):</p>
  <CodeBlock lang="json" code={`{
  "entities": [
    {
      "id": "a1b2c3...",
      "type": "person",
      "name": "Alex",
      "relationships": [
        {
          "relationship": "works_at",
          "target": { "id": "d4e5f6...", "type": "org", "name": "Stripe" },
          "validFrom": "2024-01-01T00:00:00Z",
          "validUntil": null,
          "current": true
        },
        {
          "relationship": "works_at",
          "target": { "id": "g7h8i9...", "type": "org", "name": "Google" },
          "validFrom": "2022-01-01T00:00:00Z",
          "validUntil": "2024-01-01T00:00:00Z",
          "current": false
        }
      ],
      "firstSeen": "2026-06-01T00:00:00Z",
      "lastSeen": "2026-06-13T12:00:00Z"
    }
  ]
}`} />
  <p>For graphs you want to render or query independently, use the dedicated endpoint:</p>
  <CodeBlock lang="shell" code={`curl "${APP_URL}/v1/entities?userId=user_123" \\
  -H "Authorization: Bearer ans_..."`} />

  <h2 id="temporal-facts">Temporal facts in context</h2>
  <p>Alongside the entity graph, <code>GET /v1/context</code> returns <code>temporal[]</code> — a flat list of time-bounded facts extracted in the same synthesis pass:</p>
  <CodeBlock lang="json" code={`{
  "temporal": [
    { "fact": "Works at Stripe", "validFrom": "2024-01", "validUntil": null, "current": true },
    { "fact": "Worked at Google", "validFrom": "2022-01", "validUntil": "2024-01", "current": false },
    { "fact": "Led the payments team", "validFrom": "2023-06", "validUntil": "2024-01", "current": false }
  ]
}`} />
  <p>This complements the entity graph: <code>entities[]</code> is structured and queryable; <code>temporal[]</code> is for prompt injection where you want to give the LLM a clean timeline. Both support point-in-time queries via <code>asOf</code> — see <a href="/docs/guides/temporal-memory">Temporal memory &amp; point-in-time queries</a>.</p>

  <h2 id="entities-in-a-prompt">How to use entities in a prompt</h2>
  <CodeBlock lang="typescript" code={`const ctx = await memory.context({ userId: 'user_123' });

const currentOrg = ctx.entities
  .find(e => e.type === 'person' && e.name === 'Alex')
  ?.relationships.find(r => r.relationship === 'works_at' && r.current)
  ?.target.name;

const techStack = ctx.entities
  .filter(e => e.type === 'tech')
  .map(e => e.name);

const systemPrompt = \`
\${memory.formatForPrompt(ctx)}

Current employer: \${currentOrg ?? 'unknown'}
Tech stack: \${techStack.join(', ')}
\`.trim();`} />

  <h2 id="when-entities-populate">When entities are populated</h2>
  <p>The entity graph is populated <strong>after the first synthesis run</strong> for a user. Synthesis is triggered automatically after every <code>POST /v1/ingest</code> call, but runs asynchronously — typically within a few seconds. A user who has never been synthesized returns <code>entities: []</code>.</p>
  <p>To confirm synthesis has run, check that <code>static[]</code> is non-empty in <code>GET /v1/context</code>. Entities and temporal facts are extracted in the same pass as the static/dynamic profile.</p>
  <div class="callout callout-tip">
    <div class="callout-tag">Note</div>
    <div class="callout-body">On the hosted service, the entity graph and <code>GET /v1/entities</code> are Pro+ features.</div>
  </div>
</>)));

// ─── /docs/guides/temporal-memory ─────────────────────────────────────────────

docsRoutes.get("/guides/temporal-memory", (c) => c.html(layout("/docs/guides/temporal-memory", [
  { label: "Two kinds of temporal data", href: "#two-kinds" },
  { label: "The asOf parameter", href: "#asof" },
  { label: "Worked example", href: "#worked-example" },
  { label: "The knowledge-time axis", href: "#knowledge-time" },
  { label: "Why this matters", href: "#why-this-matters" },
  { label: "How the timeline is built", href: "#how-built" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/temporal-memory">Concepts</a><span class="breadcrumb-sep">/</span>Temporal memory</div>
  <div class="page-title">Temporal memory &amp; point-in-time queries</div>
  <p class="page-sub">Most memory APIs flatten to current state. Anansi keeps the timeline — every fact and relationship carries validity bounds, so you can ask: <em>what was true about this user in June 2024?</em></p>

  <h2 class="first" id="two-kinds">Two kinds of temporal data</h2>
  <p>When Anansi synthesizes a user's memory, it extracts two time-aware structures:</p>
  <ul>
    <li><strong>Temporal facts</strong> — time-bounded statements with <code>validFrom</code> / <code>validUntil</code> ("Works at Stripe", "Lived in NYC").</li>
    <li><strong>Entity relationships</strong> — bi-temporal edges in the <a href="/docs/guides/entity-graph">entity graph</a> (Alex —works_at→ Stripe, valid 2024-01 onward).</li>
  </ul>
  <p>Both are returned by <code>GET /v1/context</code> and <code>GET /v1/entities</code>, and both can be queried at a point in time with <code>asOf</code>.</p>

  <h2 id="asof">The <code>asOf</code> parameter</h2>
  <p>Add <code>asOf</code> to <code>GET /v1/context</code> or <code>GET /v1/entities</code> to get the world as it was valid at that instant. Accepted formats: <code>YYYY-MM</code>, <code>YYYY-MM-DD</code>, or full ISO 8601.</p>
  <CodeBlock lang="shell" code={`# What was true about the user as of mid-2023?
curl "${APP_URL}/v1/context?userId=user_123&asOf=2023-06" \\
  -H "Authorization: Bearer ans_..."`} />
  <CodeBlock lang="typescript" code={`import AnansiMemory from "anansi-memory";
const memory = new AnansiMemory({ apiKey: process.env.ANANSI_API_KEY });

const then = await memory.context({ userId: "user_123", asOf: "2023-06" });
const now  = await memory.context({ userId: "user_123" });`} />
  <CodeBlock lang="python" code={`then = memory.context(user_id="user_123", as_of="2023-06")
now  = memory.context(user_id="user_123")`} />

  <h3>What <code>asOf</code> changes</h3>
  <table class="param-table">
    <thead><tr><th>Field</th><th>Without asOf</th><th>With asOf</th></tr></thead>
    <tbody>
      <tr><td class="param-name">temporal[]</td><td class="param-desc">every fact, each tagged <code>current</code> (valid now)</td><td class="param-desc">only facts valid at <code>asOf</code>, each <code>current: true</code></td></tr>
      <tr><td class="param-name">entities[].relationships[]</td><td class="param-desc">full history (active + closed edges)</td><td class="param-desc">only relationships active at <code>asOf</code></td></tr>
      <tr><td class="param-name">static[], dynamic[], relevant[]</td><td class="param-desc">unchanged</td><td class="param-desc">unchanged (not time-versioned)</td></tr>
    </tbody>
  </table>
  <p><code>asOf</code> is <strong>valid-time</strong> — when the fact was true in the real world — not when Anansi learned it.</p>

  <h2 id="worked-example">Worked example</h2>
  <p>Suppose the user's history looks like this:</p>
  <CodeBlock lang="text" code={`Alex  works_at  Google   2022-01 ──────────► 2024-01
Alex  works_at  Stripe   2024-01 ──────────► (now)`} />
  <p><code>GET /v1/entities?userId=alex</code> (no <code>asOf</code>) — <strong>full history</strong>:</p>
  <CodeBlock lang="json" code={`{
  "entities": [{
    "name": "Alex", "type": "person",
    "relationships": [
      { "relationship": "works_at", "target": { "name": "Google" }, "validFrom": "2022-01-01T...", "validUntil": "2024-01-01T...", "current": false },
      { "relationship": "works_at", "target": { "name": "Stripe" }, "validFrom": "2024-01-01T...", "validUntil": null, "current": true }
    ]
  }]
}`} />
  <p><code>GET /v1/entities?userId=alex&amp;asOf=2023-06</code> — <strong>snapshot</strong>:</p>
  <CodeBlock lang="json" code={`{
  "entities": [{
    "name": "Alex", "type": "person",
    "relationships": [
      { "relationship": "works_at", "target": { "name": "Google" }, "validFrom": "2022-01-01T...", "validUntil": "2024-01-01T...", "current": true }
    ]
  }]
}`} />
  <p>At <code>asOf=2023-06</code>, Alex worked at Google, and that relationship is <code>current</code> <em>relative to the query instant</em>. Stripe doesn't appear — it wasn't true yet.</p>
  <div class="callout callout-tip">
    <div class="callout-tag">Boundaries</div>
    <div class="callout-body">Validity intervals are half-open — <code>[validFrom, validUntil)</code>, inclusive start, exclusive end. At the exact switch instant (<code>asOf=2024-01-01</code>) only the Stripe edge is returned. No double-counting at transitions.</div>
  </div>

  <h2 id="knowledge-time">The knowledge-time axis</h2>
  <p><code>asOf</code> answers <em>what was true</em>. There's a second, independent question: <em>what did we <strong>know</strong>?</em> These differ whenever we learn about something after it happened — which is almost always.</p>
  <p>The entity graph is <strong>bi-temporal</strong>: every relationship carries two time axes.</p>
  <table class="param-table">
    <thead><tr><th>Axis</th><th>Question</th><th>Stored as</th></tr></thead>
    <tbody>
      <tr><td class="param-name">Valid time</td><td class="param-desc">When was the relationship true in the real world?</td><td class="param-desc"><code>validFrom</code> / <code>validUntil</code></td></tr>
      <tr><td class="param-name">Knowledge time</td><td class="param-desc">When did Anansi learn it?</td><td class="param-desc"><code>recorded_at</code> (learned of the edge) / when its end was recorded</td></tr>
    </tbody>
  </table>
  <p>Query the knowledge axis with <code>asOfKnowledge</code>. It reconstructs the graph <strong>as we believed it</strong> at that instant:</p>
  <ul>
    <li>relationships first recorded <em>after</em> <code>asOfKnowledge</code> are excluded — we didn't know them yet;</li>
    <li>a relationship's end is applied only if we'd <em>learned of it</em> by <code>asOfKnowledge</code>; otherwise it reads as still open.</li>
  </ul>
  <CodeBlock lang="shell" code={`# What did we believe about the user back in Feb 2024?
curl "${APP_URL}/v1/entities?userId=alex&asOfKnowledge=2024-02" \\
  -H "Authorization: Bearer ans_..."`} />
  <CodeBlock lang="typescript" code={`const believedThen = await memory.listEntities({ userId: "alex", asOfKnowledge: "2024-02" });`} />

  <h3>Belief vs. reality</h3>
  <p>Suppose Alex moved Google → Stripe in <strong>January 2024</strong> (valid time), but Anansi only <strong>recorded</strong> it in <strong>March 2024</strong> (knowledge time). Then in February 2024:</p>
  <table class="param-table">
    <thead><tr><th>Query</th><th>Result</th><th>Why</th></tr></thead>
    <tbody>
      <tr><td class="param-name">asOf=2024-02</td><td class="param-desc">Stripe</td><td class="param-desc">At that <em>valid</em> instant Alex was already at Stripe…</td></tr>
      <tr><td class="param-name">asOfKnowledge=2024-02</td><td class="param-desc">Google (still open)</td><td class="param-desc">…but we hadn't <em>learned</em> it yet, so our belief was still Google</td></tr>
      <tr><td class="param-name">asOf=2024-02 &amp; asOfKnowledge=2024-02</td><td class="param-desc">Google</td><td class="param-desc">What we believed, at the time we believed it</td></tr>
    </tbody>
  </table>
  <p>This is the auditability guarantee: you can reconstruct exactly what an agent knew at the moment it acted — not what turned out to be true later. Combine both axes for a full bi-temporal point query.</p>
  <div class="callout callout-tip">
    <div class="callout-tag">Scope</div>
    <div class="callout-body">The knowledge-time axis applies to the <strong>entity graph</strong> (<code>entities[]</code>). Temporal facts (<code>temporal[]</code>) are re-derived each synthesis pass and support valid-time <code>asOf</code> only.</div>
  </div>

  <h2 id="why-this-matters">Why this matters</h2>
  <ul>
    <li><strong>Auditability</strong> — "What did the agent know about the customer when it made this recommendation?" Reconstruct the exact context behind a past decision.</li>
    <li><strong>Correctness over time</strong> — a support bot answering "where do you work?" gets the answer that was true when the conversation happened, not a stale or future one.</li>
    <li><strong>History without bloat</strong> — superseded facts aren't deleted; they're closed. You keep the trajectory (promotions, relocations, tech migrations) without it polluting current state.</li>
  </ul>

  <h2 id="how-built">How the timeline is built</h2>
  <p>The synthesis worker maintains validity automatically:</p>
  <ul>
    <li>When a new fact supersedes an old one (Alex changes jobs), the old relationship's <code>validUntil</code> is set to the moment the change was observed, and a new active relationship is opened.</li>
    <li>Facts explicitly marked as ended close cleanly.</li>
    <li>The entity graph enforces <strong>at most one active relationship</strong> of a given type between two entities, so snapshots are never ambiguous.</li>
  </ul>
  <p>See the <a href="/docs/guides/entity-graph">entity graph</a> for the underlying data model, and <a href="/docs/guides/metadata-filters">metadata filters</a> for filtering search results by stored fields.</p>
  <div class="callout callout-tip">
    <div class="callout-tag">Granularity</div>
    <div class="callout-body">Temporal facts use month precision (<code>YYYY-MM</code>) as emitted by synthesis; entity edges record full timestamps. <code>asOf</code> accepts any of <code>YYYY-MM</code>, <code>YYYY-MM-DD</code>, or ISO 8601 and is compared in UTC.</div>
  </div>
</>)));

// ─── /docs/guides/metadata-filters ────────────────────────────────────────────

docsRoutes.get("/guides/metadata-filters", (c) => c.html(layout("/docs/guides/metadata-filters", [
  { label: "Filter object shape", href: "#filter-shape" },
  { label: "Equality filters", href: "#equality" },
  { label: "Numeric ranges", href: "#numeric-ranges" },
  { label: "Contains filter", href: "#contains" },
  { label: "Logical operators", href: "#logical-operators" },
  { label: "System metadata fields", href: "#system-fields" },
  { label: "Usage examples", href: "#usage-examples" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span><a href="/docs/guides/metadata-filters">Concepts</a><span class="breadcrumb-sep">/</span>Metadata filters</div>
  <div class="page-title">Metadata filter syntax</div>
  <p class="page-sub">Every chunk carries a <code>metadata</code> object. Any field you write — plus the system fields Anansi writes automatically — can be filtered at query time.</p>

  <p>Filters are accepted on:</p>
  <ul>
    <li><code>GET /v1/context</code> — the <code>filters</code> query param, JSON-encoded</li>
    <li><code>POST /v1/search</code> — the <code>filters</code> body field</li>
    <li><code>GET /v1/memories</code> — the <code>sourceType</code> convenience param is a shorthand for a filter</li>
  </ul>

  <h2 class="first" id="filter-shape">Filter object shape</h2>
  <CodeBlock lang="typescript" code={`interface MetadataFilter {
  metadata?: Record<string, FilterValue>;
  $and?: MetadataFilter[];
  $or?: MetadataFilter[];
}

type FilterValue =
  | string | number | boolean | null          // equality / null check
  | { $gte?: number; $lte?: number;           // numeric range
      $gt?: number;  $lt?: number;
      $contains?: unknown };                  // JSONB contains`} />

  <h2 id="equality">Equality filters</h2>
  <p>Match chunks where a metadata field equals an exact value.</p>
  <CodeBlock lang="json" code={`{ "metadata": { "sourceType": "conversation" } }`} />
  <CodeBlock lang="json" code={`{ "metadata": { "author": "alice@example.com" } }`} />
  <p>Null check:</p>
  <CodeBlock lang="json" code={`{ "metadata": { "sessionId": null } }`} />

  <h2 id="numeric-ranges">Numeric range filters</h2>
  <CodeBlock lang="json" code={`{ "metadata": { "score": { "$gte": 0.8 } } }`} />
  <CodeBlock lang="json" code={`{ "metadata": { "wordCount": { "$gt": 100, "$lte": 500 } } }`} />
  <p>The field is cast to <code>float</code> before comparison, so it works for integers and decimals stored as JSON numbers.</p>

  <h2 id="contains">Contains filter</h2>
  <p>Tests whether the metadata field's JSONB value <strong>contains</strong> the given value. Useful for arrays and nested objects.</p>
  <CodeBlock lang="json" code={`{ "metadata": { "tags": { "$contains": "important" } } }`} />
  <CodeBlock lang="json" code={`{ "metadata": { "labels": { "$contains": ["billing", "urgent"] } } }`} />

  <h2 id="logical-operators">Logical operators</h2>
  <p>Combine conditions with <code>$and</code> or <code>$or</code> at any level.</p>
  <CodeBlock lang="json" code={`{
  "$and": [
    { "metadata": { "sourceType": "conversation" } },
    { "metadata": { "score": { "$gte": 0.7 } } }
  ]
}`} />
  <CodeBlock lang="json" code={`{
  "$or": [
    { "metadata": { "sourceType": "meeting" } },
    { "metadata": { "sourceType": "voice" } }
  ]
}`} />
  <p>Filters nest up to <strong>5 levels</strong> deep and accept up to <strong>50 total conditions</strong>. Multiple keys inside one <code>metadata</code> object are ANDed:</p>
  <CodeBlock lang="json" code={`{
  "metadata": {
    "sourceType": "conversation",
    "author": "alice@example.com"
  }
}`} />

  <h2 id="system-fields">System metadata fields</h2>
  <p>Anansi writes these fields on every chunk automatically. You can filter on any of them.</p>
  <table class="param-table">
    <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td class="param-name">sourceType</td><td class="param-type">string</td><td class="param-desc">The <code>sourceType</code> you passed on ingest (<code>conversation</code>, <code>meeting</code>, etc.)</td></tr>
      <tr><td class="param-name">author</td><td class="param-type">string</td><td class="param-desc">The <code>userId</code> of the ingest caller, or overridden by <code>metadata.author</code></td></tr>
      <tr><td class="param-name">authorId</td><td class="param-type">string</td><td class="param-desc">Always the <code>userId</code> of the ingest caller</td></tr>
      <tr><td class="param-name">timestamp</td><td class="param-type">string</td><td class="param-desc">ISO 8601 — <code>metadata.timestamp</code> if provided, otherwise ingest time</td></tr>
      <tr><td class="param-name">channelName</td><td class="param-type">string</td><td class="param-desc">Always <code>"api"</code> for API ingests</td></tr>
      <tr><td class="param-name">sessionId</td><td class="param-type">string</td><td class="param-desc">Only present if <code>sessionId</code> was provided on ingest</td></tr>
      <tr><td class="param-name">agentId</td><td class="param-type">string</td><td class="param-desc">Only present if <code>agentId</code> was provided on ingest</td></tr>
      <tr><td class="param-name">embedding_source</td><td class="param-type">string</td><td class="param-desc"><code>"custom"</code> when a bring-your-own embedding was used</td></tr>
    </tbody>
  </table>

  <h2 id="usage-examples">Usage examples</h2>
  <h3><code>GET /v1/context</code> — filter relevant chunks by source type</h3>
  <CodeBlock lang="shell" code={`curl "${APP_URL}/v1/context?userId=user_123&q=what+stack&filters=%7B%22metadata%22%3A%7B%22sourceType%22%3A%22conversation%22%7D%7D" \\
  -H "Authorization: Bearer ans_..."`} />
  <p>Or with a library:</p>
  <CodeBlock lang="typescript" code={`const ctx = await memory.context({
  userId: 'user_123',
  q: 'what stack does the user prefer?',
  filters: { metadata: { sourceType: 'conversation' } },
});`} />
  <h3><code>POST /v1/search</code> — search within a date range</h3>
  <p>Assuming you store a numeric timestamp in <code>metadata.timestamp</code> on ingest:</p>
  <CodeBlock lang="json" code={`{
  "userId": "user_123",
  "query": "webhook issues",
  "filters": {
    "metadata": {
      "timestamp": { "$gte": 1717200000, "$lte": 1717286400 }
    }
  }
}`} />
  <h3>Combining source type and recency</h3>
  <CodeBlock lang="json" code={`{
  "$and": [
    { "metadata": { "sourceType": "meeting" } },
    { "metadata": { "score": { "$gte": 0.5 } } }
  ]
}`} />
  <div class="callout callout-tip">
    <div class="callout-tag">Note</div>
    <div class="callout-body">On the hosted service, metadata filters are a Pro+ feature. Filter values are compiled to parameterized SQL — never string-interpolated.</div>
  </div>
</>)));
