/*
 * @anansi/ui — Badge.
 */
import { type ComponentProps } from "react";
import { cn } from "../cn.js";
import { semanticText } from "../lib/utils.js";

export type BadgeVariant = "default" | "primary" | "success" | "warning" | "danger" | "temporal" | "outline";

// text-{color} on bg-{color}/15 fails WCAG AA in light mode (verified: the tint and
// the text share a hue, so as the tint darkens toward the text color, contrast can
// only fall, never recover — no alpha value fixes it). semanticText() mixes the label
// color toward --foreground instead, which passes >=4.5:1 in both themes.
const BADGE_VARIANT: Record<BadgeVariant, string> = {
  default: "bg-muted text-muted-foreground",
  primary: cn("bg-primary/15", semanticText("primary")),
  success: cn("bg-success/15", semanticText("success")),
  warning: cn("bg-warning/15", semanticText("warning")),
  danger: cn("bg-destructive/15", semanticText("destructive")),
  temporal: cn("bg-temporal/15", semanticText("temporal")),
  outline: "border border-border text-foreground",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: ComponentProps<"span"> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-2 py-1 font-mono text-[0.625rem] font-medium uppercase tracking-[0.08em]",
        BADGE_VARIANT[variant],
        className
      )}
      {...props}
    />
  );
}
