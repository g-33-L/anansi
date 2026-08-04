/*
 * @anansi/ui — Table + Breadcrumbs.
 * Table is an unopinionated styled <table> (callers style their own thead/tbody/
 * th/td), preserving the primitive the marketing site already builds on.
 */
import { type ComponentProps } from "react";
import { cn } from "../cn.js";
import { ChevronRightIcon } from "./icons.js";

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <table className={cn("w-full border-collapse text-left text-sm", className)} {...props} />
  );
}

export interface Crumb {
  label: string;
  href?: string;
}

export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center font-mono text-[0.6875rem] tracking-[0.02em]", className)}>
      <ol className="flex items-center gap-1.5">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-1.5">
              {c.href && !last ? (
                <a href={c.href} className="text-muted-foreground transition-colors hover:text-foreground">
                  {c.label}
                </a>
              ) : (
                <span
                  className={last ? "text-foreground" : "text-muted-foreground"}
                  aria-current={last ? "page" : undefined}
                >
                  {c.label}
                </span>
              )}
              {!last && <ChevronRightIcon className="size-3.5 text-muted-foreground" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
