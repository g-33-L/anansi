/*
 * @anansi/ui — public API barrel.
 *
 * Re-exports the component library. Internal helpers (`lib/*`) are intentionally
 * NOT exported. Component implementations live in `./components/*`; import from
 * "@anansi/ui" only. See DESIGN_SYSTEM.md + COMPONENT_LIBRARY.md.
 */
export { cn } from "./cn.js";

export * from "./components/theme.js"; // Theme, ThemeProvider, useTheme
export * from "./components/button.js"; // Button, LinkButton (+ variant/size types)
export * from "./components/badge.js"; // Badge (+ BadgeVariant)
export * from "./components/card.js"; // Card, CardHeader/Title/Description/Content/Footer
export * from "./components/layout.js"; // Container, Section, Eyebrow, Heading, Text, Divider
export * from "./components/feedback.js"; // Alert, Spinner, EmptyState, StatCard, CodeBlock, Skeleton
export * from "./components/forms.js"; // Input, Textarea, Label, Field, Select, Checkbox
export * from "./components/data.js"; // Table, Breadcrumbs (+ Crumb)
export * from "./components/overlays.js"; // Dialog, Tabs, Tooltip, DropdownMenu, Toast, CommandPalette
export * from "./components/icons.js"; // 12 line icons (CheckIcon, ChevronDownIcon, XIcon, …)
