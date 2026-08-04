# `@anansi/ui` Component Library

Every export from `@anansi/ui`. All accept `className` (merged via `cn`) and forward native props unless noted. Import from the package root only.

## Theme
| Export | Signature | Notes |
|---|---|---|
| `ThemeProvider` | `{ children, defaultTheme?="dark", storageKey?="anansi-theme" }` | Sets `data-theme`, persists to localStorage, no-flash (layout effect). |
| `useTheme` | `() → { theme, setTheme(t), toggle() }` | Throws outside a provider. |
| `Theme` | `"dark" \| "light"` | type |

## Actions — `components/button.tsx`
| Export | Props | Variants / sizes |
|---|---|---|
| `Button` | `ComponentProps<"button"> & { variant?, size?, loading? }` | variant `primary\|secondary\|outline\|ghost\|destructive`; size `sm\|md\|lg`. `loading` shows Spinner + sets `disabled`/`aria-busy`. |
| `LinkButton` | `ComponentProps<"a"> & { variant?, size?, disabled? }` | Same look; `disabled` strips `href`/tabindex, sets `aria-disabled`, swallows clicks. |
| types | `ButtonVariant`, `ButtonSize`, `ButtonProps`, `LinkButtonProps` | |

## Surfaces
| Export | Props | Notes |
|---|---|---|
| `Card` + `CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter` | `ComponentProps<div/h3/p>` | Composable card; `bg-card`, hairline border, `shadow-sm`. |
| `Badge` | `ComponentProps<"span"> & { variant? }` | variant `default\|primary\|success\|warning\|danger\|temporal\|outline` (uses `semanticText`). |

## Layout & typography — `components/layout.tsx`
| Export | Props | Notes |
|---|---|---|
| `Container` | `div` | `max-w-6xl`, `px-6`, centered. |
| `Section` | `section` | vertical rhythm `py-16 sm:py-24`. |
| `Eyebrow` | `p` | uppercase tracked label, brand amber via `semanticText`. |
| `Heading` | `h2 & { level?: 1\|2\|3\|4 }` | renders `h{level}`; level 1 uses `font-display` + `text-5xl`. |
| `Text` | `p & { muted? }` | body copy; `muted` → `text-muted-foreground`. |
| `Divider` | `hr` | hairline top border. |

## Forms — `components/forms.tsx`
| Export | Props | Notes |
|---|---|---|
| `Input`, `Textarea` | native (forwardRef) | shared control style; focus ring; disabled state. |
| `Select` | native `select` (forwardRef) | custom chevron, `appearance-none`. |
| `Checkbox` | native `input` (forwardRef) | `accent-[var(--primary)]`, focus ring. |
| `Label` | native `label` | |
| `Field` | `{ label?, hint?, error?, htmlFor?, children, className? }` | wraps a control with label + hint/error (error takes precedence). |

## Feedback — `components/feedback.tsx`
| Export | Props | Notes |
|---|---|---|
| `Alert` | `div & { variant?: info\|success\|warning\|danger }` | `role="alert"`, icon + `semanticText`. |
| `Spinner` | `svg` | `aria-hidden`, `animate-spin`, inherits `currentColor`. |
| `EmptyState` | `{ icon?, title, description?, action? }` | dashed border, centered; for first-run/empty lists. |
| `StatCard` | `{ label, value, hint? }` | metric tile on `Card`. |
| `CodeBlock` | `{ code, language? }` | mono, copy button (clipboard, 1.5s confirm), optional language header. |
| `Skeleton` | `div` | `motion-safe:animate-pulse`, `aria-hidden`. |

## Data — `components/data.tsx`
| Export | Props | Notes |
|---|---|---|
| `Table` | `ComponentProps<"table">` | unopinionated styled `<table>`; caller styles `thead/tbody/th/td`. |
| `Breadcrumbs` | `{ items: Crumb[] }` where `Crumb = { label, href? }` | `nav>ol`, chevron separators, `aria-current="page"` on last. |

## Overlays — `components/overlays.tsx` (accessible, dependency-free)
| Export | Props | A11y / behavior |
|---|---|---|
| `Dialog` | `{ open, onOpenChange?, title?, description?, children }` | portal, `role="dialog"` + `aria-modal`, focus-in + **Tab focus-trap**, Esc close, body scroll-lock, backdrop click. |
| `Tabs` | `{ items: {value,label,content,disabled?}[], value?, defaultValue?, onValueChange? }` | roving tabindex, Arrow/Home/End, `role=tab/tabpanel`. |
| `Tooltip` | `{ label, children, side?, align? }` | hover+focus, portal, viewport-flip (`lib/position`), `role="tooltip"` + `aria-describedby`. |
| `DropdownMenu` | `{ trigger, items: DropdownItem[], side?, align? }` | `role=menu/menuitem`, Arrow nav, Esc + outside-click close, `aria-haspopup/expanded`. `DropdownItem = { label, onSelect?, icon?, disabled?, destructive? }`. |
| `Toast` | `{ variant?: default\|success\|warning\|danger\|info, children, onClose? }` | `role="status"` `aria-live`, variant icon, optional dismiss. Presentational — queue/provider is a Phase-6 add. |
| `CommandPalette` | `{ open, onClose?, actions: CommandAction[], placeholder? }` | ⌘K modal, `fuzzyMatch` filter, Up/Down/Enter/Esc, `role=listbox/option`. `CommandAction = { id, label, hint?, onSelect? }`. |

## Icons — `components/icons.tsx`
12 stroke icons (`CheckIcon`, `MinusIcon`, `ChevronDown/Right/UpDownIcon`, `XIcon`, `SearchIcon`, `AlertCircle/CheckCircle/AlertTriangle/InfoIcon`, `CopyIcon`) — `currentColor`, size via `className` (`size-4`). Used internally; exported for app use.

## Utilities
`cn(...classes)` — clsx + tailwind-merge conflict resolution.

---
**Status note (Phase 3):** primitives + overlays are production-real and AA-verified. `Toast` ships presentational (no global queue) and a `Table` subcomponent set is intentionally deferred to Phase 6 when the app dashboard defines real usage — noted so nothing here is a hidden placeholder.
