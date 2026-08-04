#!/usr/bin/env node
// anansi-mcp — Model Context Protocol server for Anansi memory.
// Exposes `remember` (POST /v1/ingest) and `recall` (GET /v1/context) to any
// MCP client: Claude Desktop, Cursor, Windsurf, etc.
//
// Configuration (env):
//   ANANSI_API_KEY   — required, your Anansi API key (ans_...)
//   ANANSI_BASE_URL  — optional, defaults to the hosted Anansi API

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DEFAULT_BASE_URL = "https://anansimemory.com";
const REQUEST_TIMEOUT_MS = 30_000;

const apiKey = process.env.ANANSI_API_KEY;
const baseUrl = (process.env.ANANSI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");

if (!apiKey) {
  // stdout is reserved for the MCP protocol — diagnostics go to stderr
  console.error(
    "ANANSI_API_KEY is not set. Add it to your MCP client config, e.g.\n" +
      '  "env": { "ANANSI_API_KEY": "ans_..." }\n' +
      "Self-hosting? Mint a key against your own instance with\n" +
      "  docker compose exec api node dist/scripts/seed-dev-key.js you@example.com\n" +
      "and set ANANSI_BASE_URL to your instance (e.g. http://localhost:3000), or this\n" +
      "server will talk to the hosted API instead.\n" +
      "Using the hosted service? Get a key at https://anansimemory.com/portal"
  );
  process.exit(1);
}

// ─── Anansi API client ────────────────────────────────────────────────────────

interface IngestResult {
  id: string;
  queued: boolean;
}

interface ContextResult {
  static: string[];
  dynamic: string[];
  relevant: { content: string; similarity: number; metadata: Record<string, unknown> }[];
}

class AnansiApiError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "AnansiApiError";
  }
}

async function anansiRequest<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    let message = `Anansi API error ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string };
      if (err.error) message = err.error;
    } catch {}
    throw new AnansiApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

// ─── Tool result helpers ──────────────────────────────────────────────────────

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResult(err: unknown) {
  const message =
    err instanceof AnansiApiError
      ? `Anansi API error (${err.statusCode}): ${err.message}`
      : err instanceof Error
        ? `Failed to reach the Anansi API: ${err.message}`
        : "Failed to reach the Anansi API";
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function formatProfile(ctx: ContextResult): string {
  const lines: string[] = [];

  if (ctx.static.length > 0) {
    lines.push("## Stable facts");
    ctx.static.forEach((f) => lines.push(`- ${f}`));
  }

  if (ctx.dynamic.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("## Current context");
    ctx.dynamic.forEach((d) => lines.push(`- ${d}`));
  }

  if (ctx.relevant.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("## Relevant memories");
    ctx.relevant.forEach((r) => lines.push(`- ${r.content}`));
  }

  if (lines.length === 0) {
    return "No memories stored for this user yet. Use the `remember` tool to save something first.";
  }

  return lines.join("\n");
}

// ─── MCP server ───────────────────────────────────────────────────────────────

const server = new McpServer({ name: "anansi-memory", version: "0.1.0" });

server.registerTool(
  "remember",
  {
    title: "Remember",
    description:
      "Save a memory about a user to Anansi. Use this whenever the user shares a durable fact, " +
      "preference, decision, or piece of context worth recalling in future sessions " +
      '(e.g. "prefers TypeScript", "working on a webhook migration this week"). ' +
      "The content is chunked, embedded, and synthesized into the user's profile asynchronously.",
    inputSchema: {
      content: z.string().min(1).max(100_000).describe("The memory to store — a fact, preference, note, or excerpt of conversation"),
      userId: z.string().min(1).max(256).describe("Stable identifier for the user this memory belongs to (e.g. an email or user id)"),
      sourceType: z
        .enum(["conversation", "document", "note", "meeting", "custom"])
        .optional()
        .describe("What kind of content this is — affects chunking. Defaults to 'conversation'."),
    },
  },
  async ({ content, userId, sourceType }) => {
    try {
      const result = await anansiRequest<IngestResult>("POST", "/v1/ingest", {
        userId,
        content,
        sourceType,
      });
      return textResult(
        `Memory saved for ${userId} (id: ${result.id}). It will appear in recall results once synthesis completes (usually a few seconds).`
      );
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "recall",
  {
    title: "Recall",
    description:
      "Retrieve the synthesized memory profile for a user from Anansi: stable facts, current context, " +
      "and the memories most relevant to your query. Use this at the start of a conversation or before " +
      "answering questions that depend on what the user has shared before. The result is curated and " +
      "ready to use directly — not raw chunks.",
    inputSchema: {
      query: z.string().min(1).max(2000).describe("What you want to know about the user — used for relevance search"),
      userId: z.string().min(1).max(256).describe("Stable identifier for the user whose memory to retrieve"),
    },
  },
  async ({ query, userId }) => {
    try {
      const params = new URLSearchParams({ userId, q: query });
      const result = await anansiRequest<ContextResult>("GET", `/v1/context?${params}`);
      return textResult(formatProfile(result));
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── Ledger (corporate-brain) tools ───────────────────────────────────────────

interface LedgerClaim {
  claim: string;
  claimFingerprint: string;
  status: string;
  disputed: boolean;
  confidence: number;
  validFrom: string | null;
}
interface LedgerView {
  domain: string | null;
  asOf: string | null;
  asOfKnowledge: string | null;
  claims: LedgerClaim[];
  disputes: { claimKey: string; answers: { claim: string; claimFingerprint: string }[] }[];
}
interface Divergence {
  claimKey: string;
  documented: { claim: string };
  observed: { claim: string; validFrom: string | null };
  changedAt: string | null;
}
interface TimelineEntry {
  at: string;
  claim: string;
  kind: string;
}

function formatLedger(v: LedgerView): string {
  const lines: string[] = [];
  const at = v.asOf ? `as of ${v.asOf}` : "current";
  const known = v.asOfKnowledge ? `, as known ${v.asOfKnowledge}` : "";
  lines.push(`## Ledger${v.domain ? ` — ${v.domain}` : ""} (${at}${known})`);
  if (v.claims.length === 0) lines.push("_No attestations yet._");
  for (const c of v.claims) {
    const conf = `${Math.round(c.confidence * 100)}%`;
    const flags = [c.status, c.disputed ? "disputed" : null].filter(Boolean).join(", ");
    const since = c.validFrom ? ` (since ${c.validFrom.slice(0, 10)})` : "";
    lines.push(`- ${c.claim}${since} — ${flags}, confidence ${conf}`);
  }
  if (v.disputes.length > 0) {
    lines.push("", "### Disputes");
    for (const d of v.disputes) lines.push(`- ${d.claimKey}: ${d.answers.map((a) => a.claim).join("  vs  ")}`);
  }
  return lines.join("\n");
}

server.registerTool(
  "ledger",
  {
    title: "Ledger (as-of)",
    description:
      "Get the correct organizational context for a topic from Anansi's ledger — cited, trust-tiered " +
      "claims about how the company operates, reconstructed at any point in time. Pass asOf to see what " +
      "was TRUE at a past date, and asOfKnowledge to see what was BELIEVED at a past date. Use this " +
      "before acting on a company process so the answer reflects reality, not a stale wiki.",
    inputSchema: {
      domain: z.string().max(128).optional().describe("Topic to scope to, e.g. 'incident_response'"),
      asOf: z.string().max(40).optional().describe("Valid-time instant (YYYY-MM, YYYY-MM-DD, or ISO). Omit for now."),
      asOfKnowledge: z.string().max(40).optional().describe("Knowledge-time instant — reconstruct what was believed then."),
    },
  },
  async ({ domain, asOf, asOfKnowledge }) => {
    try {
      const params = new URLSearchParams();
      if (domain) params.set("domain", domain);
      if (asOf) params.set("asOf", asOf);
      if (asOfKnowledge) params.set("asOfKnowledge", asOfKnowledge);
      const qs = params.toString();
      const result = await anansiRequest<LedgerView>("GET", `/v1/ledger${qs ? `?${qs}` : ""}`);
      return textResult(formatLedger(result));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "ledger_divergences",
  {
    title: "Ledger divergences (doc vs reality)",
    description:
      "Find where a company's documented process disagrees with what its team actually does, according " +
      "to Anansi's ledger — with the date the practice changed. Use this to spot stale runbooks/wikis.",
    inputSchema: {
      domain: z.string().max(128).optional().describe("Topic to scope to, e.g. 'incident_response'"),
    },
  },
  async ({ domain }) => {
    try {
      const qs = domain ? `?domain=${encodeURIComponent(domain)}` : "";
      const { divergences } = await anansiRequest<{ divergences: Divergence[] }>("GET", `/v1/ledger/divergences${qs}`);
      if (divergences.length === 0) return textResult("No documented-vs-observed divergences found.");
      const lines = divergences.map(
        (d) =>
          `- ${d.claimKey}: docs say "${d.documented.claim}" but the team does "${d.observed.claim}"` +
          `${d.changedAt ? ` (changed ~${d.changedAt.slice(0, 10)})` : ""}`
      );
      return textResult(["## Doc-vs-reality divergences", ...lines].join("\n"));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.registerTool(
  "ledger_timeline",
  {
    title: "Ledger timeline",
    description:
      "Get a chronological timeline of when each practice was adopted and superseded for a topic, from " +
      "Anansi's ledger. Use this to understand how a process evolved over time.",
    inputSchema: {
      domain: z.string().max(128).optional().describe("Topic to scope to, e.g. 'incident_response'"),
    },
  },
  async ({ domain }) => {
    try {
      const qs = domain ? `?domain=${encodeURIComponent(domain)}` : "";
      const { timeline } = await anansiRequest<{ timeline: TimelineEntry[] }>("GET", `/v1/ledger/timeline${qs}`);
      if (timeline.length === 0) return textResult("No timeline events yet.");
      const lines = timeline.map((e) => `- ${e.at.slice(0, 10)} — ${e.kind}: ${e.claim}`);
      return textResult(["## Timeline", ...lines].join("\n"));
    } catch (err) {
      return errorResult(err);
    }
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`anansi-mcp running (API: ${baseUrl})`);
}

main().catch((err) => {
  console.error("anansi-mcp failed to start:", err);
  process.exit(1);
});
