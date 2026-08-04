#!/usr/bin/env tsx
/**
 * E2E smoke test — run against a real deployed environment.
 *
 * Usage:
 *   BASE_URL=https://anansimemory.com \
 *   API_KEY=ans_... \
 *   tsx apps/api/scripts/smoke-test.ts
 *
 * Exit 0 = all checks passed. Exit 1 = at least one check failed.
 */

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error("ERROR: API_KEY env var is required");
  process.exit(1);
}

const TEST_USER = `smoke-${Date.now()}`;
let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  ✓  ${label}`);
  passed++;
}

function fail(label: string, detail?: string) {
  console.error(`  ✗  ${label}${detail ? `\n       ${detail}` : ""}`);
  failed++;
}

async function get(path: string) {
  return fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
}

async function post(path: string, body: unknown) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

console.log(`\nAnansi smoke test → ${BASE_URL}\n`);

// ─── 1. Health check ──────────────────────────────────────────────────────────
console.log("1. Health");
{
  const r = await fetch(`${BASE_URL}/health`);
  const j = await r.json() as Record<string, unknown>;
  if (r.status === 200 && j.status === "ok") {
    ok(`GET /health → 200 { status: "ok" }`);
  } else {
    fail(`GET /health`, `status=${r.status} body=${JSON.stringify(j)}`);
  }
}

// ─── 2. Auth enforcement ──────────────────────────────────────────────────────
console.log("\n2. Auth enforcement");
{
  const r = await fetch(`${BASE_URL}/v1/context?userId=x`); // no auth header
  if (r.status === 401) {
    ok("No API key → 401");
  } else {
    fail("No API key should return 401", `got ${r.status}`);
  }
}
{
  const r = await fetch(`${BASE_URL}/v1/context?userId=x`, {
    headers: { Authorization: "Bearer ans_fakekeyxxx" },
  });
  if (r.status === 401) {
    ok("Bad API key → 401");
  } else {
    fail("Bad API key should return 401", `got ${r.status}`);
  }
}

// ─── 3. Ingest ────────────────────────────────────────────────────────────────
console.log("\n3. Ingest");
{
  const r = await post("/v1/ingest", {
    userId: TEST_USER,
    content: "Smoke test: user prefers TypeScript and is building a memory API.",
    sourceType: "conversation",
    sourceId: `smoke:${Date.now()}`,
  });
  const j = await r.json() as Record<string, unknown>;
  if (r.status === 202 && j.queued === true && typeof j.id === "string") {
    ok(`POST /v1/ingest → 202 { queued: true, id: "${(j.id as string).slice(0, 8)}..." }`);
  } else {
    fail("POST /v1/ingest", `status=${r.status} body=${JSON.stringify(j)}`);
  }
}

// Ingest a second chunk to ensure we have data
{
  const r = await post("/v1/ingest", {
    userId: TEST_USER,
    content: "Smoke test: user is working on a BullMQ-based ingestion pipeline.",
    sourceType: "conversation",
    sourceId: `smoke:${Date.now()}:2`,
  });
  if (r.status === 202) ok("Second ingest chunk → 202");
  else fail("Second ingest chunk", `status=${r.status}`);
}

// ─── 4. Context (immediate — pre-synthesis) ───────────────────────────────────
console.log("\n4. Context (pre-synthesis)");
{
  const r = await get(`/v1/context?userId=${TEST_USER}&q=typescript`);
  const j = await r.json() as Record<string, unknown>;
  if (r.status === 200 && Array.isArray(j.static) && Array.isArray(j.dynamic)) {
    ok(`GET /v1/context → 200 shape valid (static[], dynamic[])`);
  } else {
    fail("GET /v1/context shape", `status=${r.status} body=${JSON.stringify(j).slice(0, 200)}`);
  }
}

// ─── 5. Ingest validation ─────────────────────────────────────────────────────
console.log("\n5. Input validation");
{
  const r = await post("/v1/ingest", { content: "missing userId" });
  if (r.status === 400) ok("Missing userId → 400");
  else fail("Missing userId should return 400", `got ${r.status}`);
}
{
  const r = await post("/v1/ingest", { userId: TEST_USER, content: "" });
  if (r.status === 400) ok("Empty content → 400");
  else fail("Empty content should return 400", `got ${r.status}`);
}

// ─── 6. Search ────────────────────────────────────────────────────────────────
console.log("\n6. Search");
{
  const r = await post("/v1/search", {
    userId: TEST_USER,
    query: "typescript memory",
    limit: 5,
  });
  const j = await r.json() as Record<string, unknown>;
  if (r.status === 200 && Array.isArray(j.results) && typeof j.total === "number") {
    ok(`POST /v1/search → 200 { results[${(j.results as unknown[]).length}], total: ${j.total} }`);
  } else {
    fail("POST /v1/search", `status=${r.status} body=${JSON.stringify(j).slice(0, 200)}`);
  }
}

// ─── 7. Entities ─────────────────────────────────────────────────────────────
console.log("\n7. Entity graph");
{
  const r = await get(`/v1/entities?userId=${TEST_USER}`);
  const j = await r.json() as Record<string, unknown>;
  if (r.status === 200 && Array.isArray(j.entities)) {
    ok(`GET /v1/entities → 200 { entities[${(j.entities as unknown[]).length}] }`);
  } else {
    fail("GET /v1/entities", `status=${r.status} body=${JSON.stringify(j).slice(0, 200)}`);
  }
}

// ─── 8. Rate limit headers (not exhausting the limit, just checking shape) ────
console.log("\n8. Rate limit");
{
  const r = await get(`/v1/context?userId=${TEST_USER}`);
  // We don't enforce RateLimit-* headers yet, but a 200 means the path is live
  if (r.status === 200) ok("Rate limit path alive (no 429 on single request)");
  else if (r.status === 429) fail("Already rate-limited — increase limit or use a fresh key");
  else fail("Unexpected status from rate-limit check", `got ${r.status}`);
}

// ─── 9. Privacy + Terms pages ────────────────────────────────────────────────
console.log("\n9. Legal pages");
for (const path of ["/privacy", "/terms"]) {
  const r = await fetch(`${BASE_URL}${path}`);
  const text = await r.text();
  if (r.status === 200 && text.includes("Anansi")) {
    ok(`GET ${path} → 200 (HTML rendered)`);
  } else {
    fail(`GET ${path}`, `status=${r.status}`);
  }
}

// ─── 10. Cleanup ─────────────────────────────────────────────────────────────
console.log("\n10. Cleanup");
{
  const r = await fetch(`${BASE_URL}/v1/memory?userId=${TEST_USER}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const j = await r.json() as Record<string, unknown>;
  if (r.status === 200 && typeof j.deleted === "number") {
    ok(`DELETE /v1/memory → 200 { deleted: ${j.deleted} }`);
  } else {
    fail("DELETE /v1/memory", `status=${r.status} body=${JSON.stringify(j)}`);
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`  ${passed + failed} checks — ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log("  All checks passed. ✓\n");
  process.exit(0);
} else {
  console.error(`  ${failed} check(s) failed. ✗\n`);
  process.exit(1);
}
