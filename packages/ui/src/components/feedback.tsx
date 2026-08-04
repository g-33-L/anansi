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
      className={cn("flex gap-3 rounded-md border px-4 py-3 text-sm shadow-[inset_3px_0_0_currentColor]", ALERT_VARIANT[variant], className)}
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
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[var(--rule-strong)] bg-card p-10 text-center sm:p-12",
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
    <Card className={cn("relative overflow-hidden p-5", className)}>
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-[var(--rule-strong)]" />
      <p className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-foreground">{value}</p>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
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
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[#9eabc0] transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </button>
  );

  return (
    <div
      data-language={language}
      className={cn(
        "group relative overflow-hidden rounded-lg border border-[#283649] bg-[#101925] text-[#e6edf7] shadow-[var(--shadow-paper)]",
        className
      )}
    >
      {language ? (
        <div className="flex items-center justify-between border-b border-[#283649] bg-[#151f2d] py-2 pl-4 pr-1.5">
          <span className="font-mono text-[0.625rem] uppercase tracking-[0.1em] text-[#9eabc0]">{language}</span>
          {copyButton}
        </div>
      ) : (
        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          {copyButton}
        </div>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-[0.8125rem] leading-6 text-[#e6edf7]">
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
