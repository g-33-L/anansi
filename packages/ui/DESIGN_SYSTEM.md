# Anansi Design System (`@anansi/ui`)

Code-first design system. **Source of truth = code:** tokens in `src/theme.css`, components in `src/components/*`, internal helpers in `src/lib/*` (not exported). React 19 + Tailwind v4, dependency-free (runtime deps: `clsx`, `tailwind-merge` only). Dark-first with a real light mode.

## 1. Principles
"Instrument-grade memory." Precise, calm, technical, trustworthy; developer-first; enterprise-credible — the *principles* of Linear/Stripe/Vercel/WorkOS, not their look. One accent (silk amber), hairline borders, subtle elevation, restrained fast motion. No decorative gradients/glow, no AI-slop. Everything intentional.

## 2. Consuming the system
```css
/* app entry CSS, in this order */
@import "tailwindcss";
@import "@anansi/ui/theme.css";
@source "../../../packages/ui/src";   /* Tailwind v4 doesn't scan node_modules; path is app-relative */
```
```tsx
import { ThemeProvider, Button, Card } from "@anansi/ui";
// Wrap the app once:
<ThemeProvider defaultTheme="dark">…</ThemeProvider>
```
Import components only from the package root `@anansi/ui`. Never deep-import `src/lib/*`.

## 3. Color (OKLCH, shadcn-compatible names → Tailwind utilities)
Semantic runtime vars are declared in `:root` (dark) and `[data-theme="light"]`, then mapped via `@theme inline` so `bg-*`/`text-*`/`border-*` follow the active mode automatically (no `dark:` variants).

| Token → utility | Role |
|---|---|
| `background`/`foreground` | canvas / primary text |
| `card`, `popover` (+`-foreground`) | elevated surfaces |
| `muted`/`muted-foreground` | subdued surface / secondary text |
| `border`, `input`, `ring` | lines, field borders, focus ring |
| `primary`/`primary-foreground` | **silk amber** brand action |
| `secondary`, `accent` (+`-foreground`) | neutral surface / hover |
| `destructive`,`success`,`warning`,`info` (+`-foreground`) | semantics |
| `temporal` (+`-foreground`) | bi-temporal axis accent |
| `viz-1..8` (static) | categorical data-viz (graph/timeline) |

**Contrast rule (important):** `bg-{color}/N` tints share the token's hue, so `text-{color}` on them (or brand amber *as text*) can't reach WCAG AA in light mode at any alpha. Use `semanticText(color)` (`src/lib/utils.ts`) for colored **text** — it mixes the hue 65% toward `--foreground` in OKLCH, verified ≥4.5:1 in both themes. Keep `bg-*`/`border-*` for fills/borders. `Alert`, `Badge`, `Eyebrow` already use it.

**A11y token adjustments made:** dark `--destructive` L 0.62→0.57 (white-on-red hit 3.78:1); light `--ring` decoupled from `--primary` to 0.58 (focus ring was 2.68:1, under the 3:1 non-text min). Same hue/role; documented inline in `theme.css`.

## 4. Typography
`--font-sans` Inter (self-hosted variable woff2), `--font-mono` JetBrains Mono (self-hosted), `--font-display` Inter with tight tracking (used by `Heading level={1}`). Fonts load via `src/fonts.css` (`@font-face`, `font-display: swap`) with system-stack fallbacks. Body sets `font-feature-settings` for Inter stylistic sets + antialiasing.

## 5. Space · radius · motion
- **Spacing** 4px base, 8-pt rhythm. **Radius** `--radius-sm .375 / -md .5 / -lg .625 / -xl 1 / -2xl 1.5rem`.
- **Motion** `--ease-emphasized` (enter) / `--ease-standard`; 150–200ms. Buttons `active:scale-[0.98]`. All animation is `motion-safe:` / respects `prefers-reduced-motion`.

## 6. Theming
`ThemeProvider` sets `document.documentElement.dataset.theme` and persists to `localStorage` (`anansi-theme`), applied in `useLayoutEffect` (SSR-safe via `useIsomorphicLayoutEffect`) to avoid a wrong-theme flash. `useTheme() → { theme, setTheme, toggle }`.

## 7. Accessibility baseline (binding)
Every interactive element has a visible `focus-visible` ring (`--ring`). Overlays (`Dialog`, `DropdownMenu`, `Tooltip`, `Tabs`, `CommandPalette`) ship correct ARIA roles, keyboard nav (arrows/Home/End/Esc/Tab), focus trapping (Dialog) and dismissal (Esc + outside-click). Color is never the sole signal (Alert/Toast pair a hue with an icon). Targets meet AA contrast in both themes.

## 8. Structure
```
src/
  theme.css        tokens + base layer (canonical)
  fonts.css        self-hosted @font-face
  fonts/           Inter + JetBrains Mono woff2 (+ OFL/LICENSE)
  cn.ts            clsx + tailwind-merge
  index.tsx        public barrel (re-exports components/*; lib/* stays internal)
  components/       button, badge, card, layout, feedback, forms, data, overlays, icons, theme
  lib/             hooks, position, utils (internal)
```
See `COMPONENT_LIBRARY.md` for the per-component API.
