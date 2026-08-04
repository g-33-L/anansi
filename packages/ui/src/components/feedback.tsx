/*
 * @anansi/ui — Alert, Spinner, EmptyState, StatCard, CodeBlock, Skeleton.
 */
import { useCallback, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "../cn.js";
import { semanticText } from "../lib/utils.js";
import { Card } from "./card.js";
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon, CheckIcon, CopyIcon, InfoIcon } from "./icons.js";

/* ───────────────────────── Alert ───────────────────────── */

export type AlertVariant = "info" | "success" | "warning" | "danger";

// See lib/utils.ts#semanticText — text-{color} directly on a same-hue bg-{color}/N
// tint cannot pass WCAG AA in light mode at any alpha (both converge on the same
// hue as alpha rises), which is what the original tint recipe did here.
const ALERT_VARIANT: Record<AlertVariant, string> = {
  info: cn("border-info/30 bg-info/10", semanticText("info")),
  success: cn("border-success/30 bg-success/10", semanticText("success")),
  warning: cn("border-warning/30 bg-warning/10", semanticText("warning")),
  danger: cn("border-destructive/30 bg-destructive/10", semanticText("destructive")),
};
const ALERT_ICON: Record<AlertVariant, typeof InfoIcon> = {
  info: InfoIcon,
  success: CheckCircleIcon,
  warning: AlertTriangleIcon,
  danger: AlertCircleIcon,
};

export function Alert({
  variant = "info",
  className,
  children,
  ...props
}: ComponentProps<"div"> & { variant?: AlertVariant }) {
  const Icon = ALERT_ICON[variant];
  return (
    <div
      role="alert"
      className={cn("flex gap-3 rounded-md border px-4 py-3 text-sm", ALERT_VARIANT[variant], className)}
      {...props}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 leading-relaxed">{children}</div>
    </div>
  );
}

/* ───────────────────────── Spinner ───────────────────────── */

export function Spinner({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-4 w-4 animate-spin text-current", className)}
      viewBox="0 0 24 24"
      fill="none"
      {...props}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ───────────────────────── EmptyState ───────────────────────── */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center",
        className
      )}
    >
      {icon && (
        <div aria-hidden="true" className="text-muted-foreground">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* ───────────────────────── StatCard ───────────────────────── */

export function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}

/* ───────────────────────── CodeBlock ───────────────────────── */

export function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context / permissions) — fail silently */
    }
  }, [code]);

  const copyButton = (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied" : "Copy code"}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </button>
  );

  return (
    <div
      data-language={language}
      className={cn(
        "group relative overflow-hidden rounded-md border border-border bg-card",
        className
      )}
    >
      {language ? (
        <div className="flex items-center justify-between border-b border-border py-1.5 pl-4 pr-1.5">
          <span className="font-mono text-xs text-muted-foreground">{language}</span>
          {copyButton}
        </div>
      ) : (
        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          {copyButton}
        </div>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-sm text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ───────────────────────── Skeleton ───────────────────────── */

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn("motion-safe:animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
