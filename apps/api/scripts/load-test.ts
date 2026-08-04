#!/usr/bin/env tsx
// Load test — drives the two hot paths (POST /v1/ingest, GET /v1/context) at a
// fixed concurrency and reports latency percentiles + error rate, so the p95/p99
// and failure ceiling are known numbers before launch rather than a surprise.
//
//   ANANSI_API_KEY=ans_... BASE_URL=https://anansimemory.com \
//     pnpm --filter @anansi/api load-test -- --rps=20 --duration=30 --users=200
//
// Flags (all optional):
//   --base=<url>        default $BASE_URL or http://localhost:3000
//   --rps=<n>           target requests/sec (default 10)
//   --duration=<sec>    test length (default 20)
//   --users=<n>         distinct userIds to spread across (default 50)
//   --mix=<0..1>        fraction of requests that are context reads (default 0.7)
//
// Uses a fixed dispatch schedule (not closed-loop), so a slow server produces a
// growing backlog you can see in the tail latencies rather than silently
// throttling the offered load. Read-only against real data except for the
// ingest fraction, which writes throwaway `loadtest:*` users — clean up with
// DELETE /v1/user afterward, or point at a staging key.

const arg = (n: string, d: string): string =>
  process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;

const BASE = arg("base", process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_KEY = process.env.ANANSI_API_KEY;
const RPS = Number(arg("rps", "10"));
const DURATION = Number(arg("duration", "20"));
const USERS = Number(arg("users", "50"));
const MIX = Number(arg("mix", "0.7")); // fraction of context (read) requests

if (!API_KEY) {
  console.error("ANANSI_API_KEY is required (use a Scale/Enterprise or staging key — this generates real usage).");
  process.exit(2);
}
if (![RPS, DURATION, USERS, MIX].every(Number.isFinite) || RPS <= 0 || DURATION <= 0) {
  console.error("Invalid flags — rps/duration must be positive numbers.");
  process.exit(2);
}

interface Sample { ms: number; ok: boolean; status: number; kind: "ingest" | "context" }
const samples: Sample[] = [];
const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

async function oneRequest(): Promise<void> {
  const uid = `loadtest:u${Math.floor(Math.random() * USERS)}`;
  const isContext = Math.random() < MIX;
  const t0 = performance.now();
  try {
    let res: Response;
    if (isContext) {
      res = await fetch(`${BASE}/v1/context?userId=${encodeURIComponent(uid)}&q=preferences`, { headers });
    } else {
      res = await fetch(`${BASE}/v1/ingest`, {
        method: "POST",
        headers,
        body: JSON.stringify({ userId: uid, content: `Load-test note ${Date.now()} — prefers TypeScript, working on a voice agent.` }),
      });
    }
    await res.text().catch(() => "");
    samples.push({ ms: performance.now() - t0, ok: res.ok, status: res.status, kind: isContext ? "context" : "ingest" });
  } catch {
    samples.push({ ms: performance.now() - t0, ok: false, status: 0, kind: isContext ? "context" : "ingest" });
  }
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function report(label: string, subset: Sample[]): void {
  if (subset.length === 0) return;
  const lat = subset.map((s) => s.ms).sort((a, b) => a - b);
  const errs = subset.filter((s) => !s.ok);
  const byStatus = new Map<number, number>();
  for (const e of errs) byStatus.set(e.status, (byStatus.get(e.status) ?? 0) + 1);
  console.log(
    `  ${label.padEnd(9)} n=${String(subset.length).padStart(5)}  ` +
    `p50=${pct(lat, 50).toFixed(0).padStart(5)}ms  p95=${pct(lat, 95).toFixed(0).padStart(6)}ms  ` +
    `p99=${pct(lat, 99).toFixed(0).padStart(6)}ms  max=${lat[lat.length - 1].toFixed(0).padStart(6)}ms  ` +
    `errors=${errs.length}${errs.length ? ` (${[...byStatus].map(([s, c]) => `${s || "net"}×${c}`).join(",")})` : ""}`
  );
}

async function main(): Promise<void> {
  const total = RPS * DURATION;
  const gapMs = 1000 / RPS;
  console.log(`\nLoad test → ${BASE}`);
  console.log(`  ${RPS} rps × ${DURATION}s = ${total} requests, ${USERS} users, ${Math.round(MIX * 100)}% context / ${Math.round((1 - MIX) * 100)}% ingest\n`);

  const started = performance.now();
  const inflight: Promise<void>[] = [];
  for (let i = 0; i < total; i++) {
    inflight.push(oneRequest());
    const targetElapsed = i * gapMs;
    const actualElapsed = performance.now() - started;
    if (actualElapsed < targetElapsed) await new Promise((r) => setTimeout(r, targetElapsed - actualElapsed));
  }
  await Promise.all(inflight);
  const wallSec = (performance.now() - started) / 1000;

  const okRate = (samples.filter((s) => s.ok).length / samples.length) * 100;
  console.log("Results:");
  report("overall", samples);
  report("context", samples.filter((s) => s.kind === "context"));
  report("ingest", samples.filter((s) => s.kind === "ingest"));
  console.log(`\n  wall=${wallSec.toFixed(1)}s  achieved=${(samples.length / wallSec).toFixed(1)} rps  success=${okRate.toFixed(1)}%`);
  console.log(`\n  Cleanup: DELETE /v1/user for loadtest:u0..u${USERS - 1} (or use a staging key).\n`);

  // Non-zero exit if the run looks unhealthy — useful as a gate.
  if (okRate < 99) process.exit(1);
}

main().catch((err) => {
  console.error("[load-test] failed:", err);
  process.exit(1);
});
