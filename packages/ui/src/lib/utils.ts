/*
 * @anansi/ui — small pure-function utilities shared across components.
 */

export type SemanticColor = "primary" | "success" | "warning" | "destructive" | "info" | "temporal";

/**
 * Readable text color for a semantic hue, on any surface, in either theme.
 *
 * Why this exists: `text-{color}` (e.g. `text-warning`) is tuned to read as a solid
 * fill (buttons, solid chips) and, measured against WCAG's own luminance formula,
 * several of the semantic tokens fall under 4.5:1 as small/thin TEXT directly on
 * `background`/`card` in light mode (e.g. plain `text-primary` measures 2.7:1 on
 * `background` in light mode — verified with an OKLCH contrast script during the
 * Phase 3 audit). Mixing 65% of the token toward `--foreground` in OKLCH space pulls
 * it toward near-black in light mode / stays near-white in dark mode (whatever
 * `--foreground` already resolves to), which is exactly the direction needed to
 * restore contrast without hand-tuning per mode. Verified >=4.5:1 (most >=6:1) for
 * every semantic color, both themes, against both `background` and `card`.
 *
 * Use for text (badge/alert/toast labels, status text). Keep using the plain
 * `bg-{color}` / `border-{color}` utilities for fills, icons, and borders — those
 * aren't text and don't need this.
 */
export function semanticText(color: SemanticColor): string {
  return `text-[color-mix(in_oklch,var(--${color})_65%,var(--foreground)_35%)]`;
}

/**
 * Case-insensitive subsequence fuzzy match (every character of `query` appears in
 * `text`, in order, not necessarily contiguous) with a rough score for ranking —
 * tighter, earlier matches score lower (better). Intentionally simple: no
 * transposition/typo tolerance, no dependency. Powers CommandPalette filtering.
 */
export function fuzzyMatch(text: string, query: string): { matched: boolean; score: number } {
  if (!query.trim()) return { matched: true, score: 0 };
  const t = text.toLowerCase();
  const q = query.toLowerCase();

  let ti = 0;
  let qi = 0;
  let firstMatch = -1;
  let lastMatch = -1;

  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      if (firstMatch === -1) firstMatch = ti;
      lastMatch = ti;
      qi++;
    }
    ti++;
  }

  if (qi < q.length) return { matched: false, score: Infinity };
  const span = lastMatch - firstMatch;
  return { matched: true, score: span + firstMatch * 0.5 };
}
