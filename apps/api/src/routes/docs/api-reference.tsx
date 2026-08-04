/** @jsxImportSource hono/jsx */
import { docsRoutes } from "./router.js";
import { layout, CodeBlock, Response } from "./shared.js";

// ─── /docs/api-reference ──────────────────────────────────────────────────────

docsRoutes.get("/api-reference", (c) => c.html(layout("/docs/api-reference", [
  { label: "Authentication", href: "#authentication" },
  { label: "POST /v1/ingest", href: "#ingest" },
  { label: "POST /v1/ingest/batch", href: "#batch" },
  { label: "GET /v1/context", href: "#context" },
  { label: "GET /v1/entities", href: "#entities" },
  { label: "POST /v1/search", href: "#search" },
  { label: "DELETE /v1/memory", href: "#delete" },
  { label: "GET /v1/ledger", href: "#ledger" },
  { label: "GET /v1/ledger/divergences", href: "#ledger-divergences" },
  { label: "GET /v1/ledger/timeline", href: "#ledger-timeline" },
  { label: "Rate limits", href: "#rate-limits" },
], <>
  <div class="breadcrumb"><a href="/docs">Docs</a><span class="breadcrumb-sep">/</span>API Reference</div>
  <div class="page-title">API Reference</div>
  <p class="page-sub">Complete reference for all Anansi API endpoints.</p>

  <h2 class="first" id="authentication">Authentication</h2>
  <p>All requests require a <code>Bearer</code> token in the <code>Authorization</code> header. Create keys from your <a href="/portal/login">developer portal</a>.</p>
  <CodeBlock lang="shell" code={`Authorization: Bearer ans_your_api_key_here`} />
  <p>Keys are HMAC-hashed at rest. Every key has a label and creation timestamp visible in the portal. Revoke any key instantly from your dashboard.</p>

  <h2 id="ingest">POST /v1/ingest</h2>
  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-post">POST</span>
      <span class="endpoint-path">/v1/ingest</span>
    </div>
    <div class="endpoint-desc">Ingest content into a user's memory. Content is sanitized, chunked, embedded, and queued for synthesis. Returns immediately — synthesis is asynchronous.</div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Request body (JSON)</div>
      <table class="param-table">
        <thead><tr><th>Field</th><th>Type</th><th></th><th>Description</th></tr></thead>
        <tbody>
          <tr><td class="param-name">userId</td><td class="param-type">string</td><td><span class="param-req">required</span></td><td class="param-desc">Your app's identifier for this user. Max 256 chars.</td></tr>
          <tr><td class="param-name">content</td><td class="param-type">string</td><td><span class="param-req">required</span></td><td class="param-desc">Text to ingest. Max 100 KB. Secrets and API keys are automatically redacted before storage.</td></tr>
          <tr><td class="param-name">sourceType</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc"><code>conversation</code> · <code>voice</code> · <code>action</code> · <code>agent_summary</code> · <code>onboarding</code> · <code>meeting</code>. Defaults to <code>api_text</code>. Preserved in <code>relevant[].metadata.sourceType</code>.</td></tr>
          <tr><td class="param-name">sourceId</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Idempotency key. Alphanum + <code>:_./–</code>, max 256 chars.</td></tr>
          <tr><td class="param-name">sessionId</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Groups conversation turns by session. Surfaces in <code>relevant[].metadata.sessionId</code>.</td></tr>
          <tr><td class="param-name">agentId</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Identifies the agent that produced this content. Surfaces in <code>relevant[].metadata.agentId</code>.</td></tr>
          <tr><td class="param-name">metadata</td><td class="param-type">object</td><td><span class="param-opt">optional</span></td><td class="param-desc">Arbitrary key-value pairs. Recognised fields: <code>title</code>, <code>author</code>, <code>timestamp</code>, <code>actionType</code>, <code>resourceId</code>, <code>resourceType</code>.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Response 202</div>
      <Response status={202} body={`{ "id": "api:ws_id:user_abc:uuid", "queued": true }`} />
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Errors</div>
      <table class="param-table">
        <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td class="param-name">401</td><td class="param-desc">Missing or invalid API key</td></tr>
          <tr><td class="param-name">400</td><td class="param-desc">Missing required fields or invalid sourceType</td></tr>
          <tr><td class="param-name">402</td><td class="param-desc">Monthly ingest quota exceeded</td></tr>
          <tr><td class="param-name">413</td><td class="param-desc">Content exceeds 100 KB</td></tr>
          <tr><td class="param-name">429</td><td class="param-desc">Rate limit exceeded (100 req/min)</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <h2 id="batch">POST /v1/ingest/batch</h2>
  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-post">POST</span>
      <span class="endpoint-path">/v1/ingest/batch</span>
    </div>
    <div class="endpoint-desc">Ingest up to 50 items in a single request. Accepts the same fields as <code>/v1/ingest</code> per item. Ideal for onboarding flows and bulk imports. Synthesis is triggered once for all unique userIds touched. Each item counts as one ingest call against your monthly quota (a 50-item batch = 50 units).</div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Request body (JSON)</div>
      <table class="param-table">
        <thead><tr><th>Field</th><th>Type</th><th></th><th>Description</th></tr></thead>
        <tbody>
          <tr><td class="param-name">items</td><td class="param-type">array</td><td><span class="param-req">required</span></td><td class="param-desc">Array of ingest objects (1–50). Each item supports the same fields as <code>POST /v1/ingest</code>.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Response 202</div>
      <Response status={202} body={`{ "queued": 4, "ids": ["api:ws:user:uuid1", "api:ws:user:uuid2", ...] }`} />
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Errors</div>
      <table class="param-table">
        <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td class="param-name">400</td><td class="param-desc">items is not an array, is empty, or exceeds 50</td></tr>
          <tr><td class="param-name">402</td><td class="param-desc">Monthly ingest quota exceeded</td></tr>
          <tr><td class="param-name">429</td><td class="param-desc">Rate limit exceeded</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <h2 id="context">GET /v1/context</h2>
  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-get">GET</span>
      <span class="endpoint-path">/v1/context</span>
    </div>
    <div class="endpoint-desc">Retrieve synthesized memory context for a user. Returns static facts, dynamic context, and (if <code>q</code> provided) relevant vector search results.</div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Query parameters</div>
      <table class="param-table">
        <thead><tr><th>Param</th><th>Type</th><th></th><th>Description</th></tr></thead>
        <tbody>
          <tr><td class="param-name">userId</td><td class="param-type">string</td><td><span class="param-req">required</span></td><td class="param-desc">Same userId used during ingest. Max 256 chars. Not required when <code>scope=workspace</code>.</td></tr>
          <tr><td class="param-name">q</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Query for vector search. Returns top relevant chunks (capped at 8). Omit for synthesized profile only. Max 2000 chars.</td></tr>
          <tr><td class="param-name">scope</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc"><code>user</code> (default) or <code>workspace</code> for the team-wide profile across all users. Workspace scope is Pro+.</td></tr>
          <tr><td class="param-name">alpha</td><td class="param-type">number</td><td><span class="param-opt">optional</span></td><td class="param-desc">Hybrid weighting: <code>1.0</code> = pure vector, <code>0.0</code> = pure keyword. Omit for RRF merge. Values other than 1.0 require hybrid search (Pro+).</td></tr>
          <tr><td class="param-name">threshold</td><td class="param-type">number</td><td><span class="param-opt">optional</span></td><td class="param-desc">Minimum similarity score (0.0–1.0) for returned chunks.</td></tr>
          <tr><td class="param-name">filters</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">JSON-encoded metadata filter (e.g. <code>{'{"team":"eng"}'}</code>). Pro+.</td></tr>
          <tr><td class="param-name">sessionId</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Restrict retrieval to a single conversation/session.</td></tr>
          <tr><td class="param-name">asOf</td><td class="param-type">ISO 8601</td><td><span class="param-opt">optional</span></td><td class="param-desc">Point-in-time query. Returns the synthesized profile as it was at this UTC timestamp. Only chunks ingested on or before this date are included. Pro+.</td></tr>
          <tr><td class="param-name">asOfKnowledge</td><td class="param-type">ISO 8601</td><td><span class="param-opt">optional</span></td><td class="param-desc">Bi-temporal query. Returns what your system <em>knew</em> at this timestamp — useful for replaying past system state regardless of when events actually occurred. Pro+.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Response 200</div>
      <Response status={200} body={`{
  "static": ["Prefers TypeScript", "Works on payments team"],
  "dynamic": ["Building webhook retry system"],
  "relevant": [{
    "content": "User prefers TypeScript...",
    "similarity": 0.87,
    "metadata": { "timestamp": "2026-06-08T..." }
  }]
}`} />
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Errors</div>
      <table class="param-table">
        <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td class="param-name">401</td><td class="param-desc">Missing or invalid API key</td></tr>
          <tr><td class="param-name">400</td><td class="param-desc">Missing userId or userId exceeds 256 chars</td></tr>
          <tr><td class="param-name">402</td><td class="param-desc">Monthly context quota exceeded</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <div class="callout callout-tip">
    <div class="callout-tag">Tip</div>
    <div class="callout-body"><strong>Performance:</strong> Synthesized profiles are cached in Redis with a 60-second TTL, so repeated context calls within that window skip retrieval entirely. A cache miss runs the profile load plus (when <code>q</code> is set) one hybrid search query.</div>
  </div>

  <h2 id="entities">GET /v1/entities</h2>
  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-get">GET</span>
      <span class="endpoint-path">/v1/entities</span>
    </div>
    <div class="endpoint-desc">Return the entity graph for a user — people, organizations, and tools extracted from ingested content. Updated after each synthesis pass.</div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Query parameters</div>
      <table class="param-table">
        <thead><tr><th>Param</th><th>Type</th><th></th><th>Description</th></tr></thead>
        <tbody>
          <tr><td class="param-name">userId</td><td class="param-type">string</td><td><span class="param-req">required</span></td><td class="param-desc">The userId to retrieve the entity graph for.</td></tr>
          <tr><td class="param-name">type</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Filter by entity type: <code>person</code> · <code>organization</code> · <code>tool</code>. Omit to return all types.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Response 200</div>
      <Response status={200} body={`{
  "entities": [
    { "name": "Sarah", "type": "person", "relationship": "manager", "confidence": 0.91 },
    { "name": "Stripe", "type": "organization", "relationship": "employer", "confidence": 0.87 },
    { "name": "BullMQ", "type": "tool", "relationship": "uses", "confidence": 0.94 }
  ]
}`} />
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Errors</div>
      <table class="param-table">
        <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td class="param-name">401</td><td class="param-desc">Missing or invalid API key</td></tr>
          <tr><td class="param-name">400</td><td class="param-desc">Missing userId</td></tr>
          <tr><td class="param-name">404</td><td class="param-desc">No entity graph found for this user (not yet synthesized)</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <h2 id="search">POST /v1/search</h2>
  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-post">POST</span>
      <span class="endpoint-path">/v1/search</span>
    </div>
    <div class="endpoint-desc">Hybrid vector + keyword search across all memory chunks for a user. Send a JSON body. Use this for raw scored retrieval beyond the top-K results returned by <code>GET /v1/context</code>.</div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Request body (JSON)</div>
      <table class="param-table">
        <thead><tr><th>Field</th><th>Type</th><th></th><th>Description</th></tr></thead>
        <tbody>
          <tr><td class="param-name">userId</td><td class="param-type">string</td><td><span class="param-req">required</span></td><td class="param-desc">The userId to search memory for. Max 256 chars.</td></tr>
          <tr><td class="param-name">query</td><td class="param-type">string</td><td><span class="param-req">required</span></td><td class="param-desc">Search query, max 2000 chars. Combined vector similarity + BM25 keyword match.</td></tr>
          <tr><td class="param-name">searchMode</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc"><code>semantic</code> · <code>hybrid</code> (default) · <code>keyword</code>. Hybrid/keyword are Pro+.</td></tr>
          <tr><td class="param-name">alpha</td><td class="param-type">number</td><td><span class="param-opt">optional</span></td><td class="param-desc"><code>1.0</code> = pure vector, <code>0.0</code> = pure keyword. Omit for RRF merge (Pro+).</td></tr>
          <tr><td class="param-name">threshold</td><td class="param-type">number</td><td><span class="param-opt">optional</span></td><td class="param-desc">Minimum similarity score (0.0–1.0).</td></tr>
          <tr><td class="param-name">limit</td><td class="param-type">number</td><td><span class="param-opt">optional</span></td><td class="param-desc">Max results to return (default 8, max 50).</td></tr>
          <tr><td class="param-name">filters</td><td class="param-type">object</td><td><span class="param-opt">optional</span></td><td class="param-desc">JSONB metadata filters (Pro+).</td></tr>
          <tr><td class="param-name">sourceId</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Scope search to one ingested document.</td></tr>
          <tr><td class="param-name">sessionId</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Restrict search to a session.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Response 200</div>
      <Response status={200} body={`{
  "results": [
    { "content": "User prefers TypeScript...", "similarity": 0.89, "sourceType": "conversation", "ingestedAt": "2026-06-10T..." },
    { "content": "Debugging BullMQ retry logic", "similarity": 0.82, "sourceType": "meeting", "ingestedAt": "2026-06-09T..." }
  ]
}`} />
    </div>
  </div>

  <h2 id="delete">DELETE /v1/memory</h2>
  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-delete">DELETE</span>
      <span class="endpoint-path">/v1/memory</span>
    </div>
    <div class="endpoint-desc">Delete all memory for a user — chunks, embeddings, and synthesized profiles. Idempotent.</div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Query parameters</div>
      <table class="param-table">
        <thead><tr><th>Param</th><th>Type</th><th></th><th>Description</th></tr></thead>
        <tbody>
          <tr><td class="param-name">userId</td><td class="param-type">string</td><td><span class="param-req">required</span></td><td class="param-desc">The userId whose memory to delete entirely.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Response 200</div>
      <Response status={200} body={`{ "deleted": 7 }`} />
    </div>
  </div>

  <h2 id="ledger">GET /v1/ledger</h2>
  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-get">GET</span>
      <span class="endpoint-path">/v1/ledger</span>
    </div>
    <div class="endpoint-desc">Reconstruct the ledger — cited, trust-tiered claims for a workspace — at any point in time. With <code>asOfKnowledge</code>, answers reflect what was <em>believed</em> at that instant; with <code>asOf</code>, what was <em>true</em>; with neither, the current ledger. Every claim carries its supporting evidence; competing active answers for one question surface as <code>disputes</code>.</div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Query parameters</div>
      <table class="param-table">
        <thead><tr><th>Param</th><th>Type</th><th></th><th>Description</th></tr></thead>
        <tbody>
          <tr><td class="param-name">domain</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Restrict the fold to a single domain. Omit to return the whole ledger.</td></tr>
          <tr><td class="param-name">asOf</td><td class="param-type">ISO 8601</td><td><span class="param-opt">optional</span></td><td class="param-desc">Valid-time coordinate — reconstruct what was true at this instant. Accepts <code>YYYY-MM</code>, <code>YYYY-MM-DD</code>, or full ISO 8601.</td></tr>
          <tr><td class="param-name">asOfKnowledge</td><td class="param-type">ISO 8601</td><td><span class="param-opt">optional</span></td><td class="param-desc">Knowledge-time coordinate — reconstruct what the system believed at this instant.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Response 200</div>
      <Response status={200} body={`{
  "workspaceId": "ws_abc",
  "domain": null,
  "asOf": null,
  "asOfKnowledge": null,
  "claims": [
    {
      "claim": "Prod deploys require two approvals",
      "claimKey": "deploy.approvals",
      "claimFingerprint": "a1b2c3",
      "claimType": "policy",
      "status": "observed",
      "disputed": false,
      "confidence": 0.92,
      "validFrom": "2026-03-01T00:00:00.000Z",
      "validFromBasis": "stated",
      "evidence": [
        { "chunkId": "chunk-uuid", "quote": "all prod deploys need two approvals", "sourceType": "notion_page" }
      ],
      "recordedAt": "2026-03-02T09:00:00.000Z"
    }
  ],
  "disputes": []
}`} />
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Errors</div>
      <table class="param-table">
        <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td class="param-name">401</td><td class="param-desc">Missing or invalid API key</td></tr>
          <tr><td class="param-name">400</td><td class="param-desc">Invalid asOf or asOfKnowledge date</td></tr>
          <tr><td class="param-name">429</td><td class="param-desc">Rate limit exceeded (60 req/min)</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <h2 id="ledger-divergences">GET /v1/ledger/divergences</h2>
  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-get">GET</span>
      <span class="endpoint-path">/v1/ledger/divergences</span>
    </div>
    <div class="endpoint-desc">Where a <strong>documented</strong> answer (wiki, runbook, Notion) disagrees with the <strong>observed</strong> reality (chat, tickets) for the same question — the doc-vs-reality view only a bi-temporal ledger can produce. Reads history, not just active rows, so it catches docs the ledger already superseded.</div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Query parameters</div>
      <table class="param-table">
        <thead><tr><th>Param</th><th>Type</th><th></th><th>Description</th></tr></thead>
        <tbody>
          <tr><td class="param-name">domain</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Restrict to a single domain. Omit to scan all domains.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Response 200</div>
      <Response status={200} body={`{
  "divergences": [
    {
      "claimKey": "deploy.approvals",
      "documented": {
        "claim": "Prod deploys require two approvals",
        "fingerprint": "a1b2c3",
        "validFrom": "2026-01-01T00:00:00.000Z",
        "evidence": [{ "chunkId": "c1", "quote": "two approvals", "sourceType": "notion_page" }]
      },
      "observed": {
        "claim": "Prod deploys ship with one approval",
        "fingerprint": "d4e5f6",
        "validFrom": "2026-04-01T00:00:00.000Z",
        "evidence": [{ "chunkId": "c2", "quote": "just LGTM and merge", "sourceType": "conversation" }]
      },
      "changedAt": "2026-04-01T00:00:00.000Z"
    }
  ]
}`} />
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Errors</div>
      <table class="param-table">
        <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td class="param-name">401</td><td class="param-desc">Missing or invalid API key</td></tr>
          <tr><td class="param-name">429</td><td class="param-desc">Rate limit exceeded (60 req/min)</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <h2 id="ledger-timeline">GET /v1/ledger/timeline</h2>
  <div class="endpoint">
    <div class="endpoint-header">
      <span class="method method-get">GET</span>
      <span class="endpoint-path">/v1/ledger/timeline</span>
    </div>
    <div class="endpoint-desc">A chronological record of when each answer was adopted and (if closed) superseded. <code>adopted</code> uses a stated start date when one exists, otherwise the moment the claim was first recorded — never an invented date. Sorted ascending by time.</div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Query parameters</div>
      <table class="param-table">
        <thead><tr><th>Param</th><th>Type</th><th></th><th>Description</th></tr></thead>
        <tbody>
          <tr><td class="param-name">domain</td><td class="param-type">string</td><td><span class="param-opt">optional</span></td><td class="param-desc">Restrict to a single domain. Omit for all domains.</td></tr>
        </tbody>
      </table>
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Response 200</div>
      <Response status={200} body={`{
  "timeline": [
    { "at": "2026-01-01T00:00:00.000Z", "claimKey": "deploy.approvals", "claim": "Prod deploys require two approvals", "fingerprint": "a1b2c3", "kind": "adopted" },
    { "at": "2026-04-01T00:00:00.000Z", "claimKey": "deploy.approvals", "claim": "Prod deploys require two approvals", "fingerprint": "a1b2c3", "kind": "superseded" }
  ]
}`} />
    </div>
    <div class="endpoint-section">
      <div class="endpoint-section-label">Errors</div>
      <table class="param-table">
        <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td class="param-name">401</td><td class="param-desc">Missing or invalid API key</td></tr>
          <tr><td class="param-name">429</td><td class="param-desc">Rate limit exceeded (60 req/min)</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <h2 id="rate-limits">Rate limits</h2>
  <table class="param-table" style="margin-top:12px">
    <thead><tr><th>Endpoint</th><th>Per-minute</th><th>Monthly (API plan)</th></tr></thead>
    <tbody>
      <tr><td class="param-name">POST /v1/ingest</td><td class="param-desc">100 req/min</td><td class="param-desc">10,000/month</td></tr>
      <tr><td class="param-name">GET /v1/context</td><td class="param-desc">60 req/min</td><td class="param-desc">5,000/month</td></tr>
      <tr><td class="param-name">GET /v1/entities</td><td class="param-desc">60 req/min</td><td class="param-desc">Unlimited</td></tr>
      <tr><td class="param-name">POST /v1/search</td><td class="param-desc">60 req/min</td><td class="param-desc">Counts against context quota</td></tr>
      <tr><td class="param-name">DELETE /v1/memory</td><td class="param-desc">60 req/min</td><td class="param-desc">Unlimited</td></tr>
      <tr><td class="param-name">GET /v1/ledger*</td><td class="param-desc">60 req/min</td><td class="param-desc">Unlimited</td></tr>
    </tbody>
  </table>
  <p>Monthly limit exceeded → <code>402</code>. Per-minute limit exceeded → <code>429</code>.</p>
</>)));
