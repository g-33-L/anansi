import type { LedgerView } from "./ledger.js";
import type { Divergence, TimelineEntry } from "./ledger-diff.js";

// PR-6: the human-readable "living procedure" view. Renders a ledger reconstruction
// + divergences + timeline as a Markdown report — the format the demo prints and a
// person (or an agent) can read directly. Pure: no I/O.

export interface LedgerReportInput {
  domain: string;
  view: LedgerView;
  divergences: Divergence[];
  timeline: TimelineEntry[];
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

export function renderLedgerReport(input: LedgerReportInput): string {
  const { domain, view, divergences, timeline } = input;
  const lines: string[] = [];

  const at = view.asOf ? `as of ${day(view.asOf)}` : "current";
  const known = view.asOfKnowledge ? `, as known ${day(view.asOfKnowledge)}` : "";
  lines.push(`# Ledger report — ${domain} (${at}${known})`, "");

  // How the company operates — observed practice first, then candidates.
  lines.push("## How the company operates");
  if (view.claims.length === 0) {
    lines.push("_No attestations yet._");
  } else {
    for (const c of view.claims) {
      const flags = [c.status, c.disputed ? "disputed" : null].filter(Boolean).join(", ");
      const since = c.validFrom ? ` (since ${day(c.validFrom)})` : "";
      lines.push(`- ${c.claim}${since} — ${flags}, confidence ${pct(c.confidence)}`);
    }
  }
  lines.push("");

  // Doc vs reality — the moat moment.
  lines.push("## Doc vs reality");
  if (divergences.length === 0) {
    lines.push("_No documented-vs-observed divergences._");
  } else {
    for (const d of divergences) {
      const changed = d.changedAt ? ` (changed ~${day(d.changedAt)})` : "";
      lines.push(`- **${d.claimKey}**: docs say "${d.documented.claim}", but the team does "${d.observed.claim}"${changed}`);
    }
  }
  lines.push("");

  // Timeline of change.
  lines.push("## Timeline");
  if (timeline.length === 0) {
    lines.push("_No timeline events yet._");
  } else {
    for (const e of timeline) lines.push(`- ${day(e.at)} — ${e.kind}: ${e.claim}`);
  }

  return lines.join("\n");
}
