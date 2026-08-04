/*
 * @anansi/ui — layout & typography primitives.
 */
import { type ComponentProps } from "react";
import { cn } from "../cn.js";
import { semanticText } from "../lib/utils.js";

export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-7xl px-5 sm:px-8", className)} {...props} />;
}

export function Section({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("py-16 sm:py-24 lg:py-28", className)} {...props} />;
}

export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      className={cn(
        "font-mono text-[0.6875rem] font-medium uppercase tracking-[0.12em]",
        semanticText("primary"),
        className
      )}
      {...props}
    />
  );
}

export function Heading({
  level = 2,
  className,
  ...props
}: ComponentProps<"h2"> & { level?: 1 | 2 | 3 | 4 }) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
  const sizes: Record<number, string> = {
    1: "font-display text-5xl font-medium leading-[0.98] tracking-[-0.045em] sm:text-6xl lg:text-7xl",
    2: "font-display text-4xl font-medium leading-[1.03] tracking-[-0.035em] sm:text-5xl",
    3: "text-xl font-semibold tracking-[-0.025em]",
    4: "text-base font-semibold",
  };
  return <Tag className={cn(sizes[level], "text-foreground", className)} {...props} />;
}

export function Text({
  muted,
  className,
  ...props
}: ComponentProps<"p"> & { muted?: boolean }) {
  return (
    <p
      className={cn(muted ? "text-muted-foreground" : "text-foreground", className)}
      {...props}
    />
  );
}

export function Divider({ className, ...props }: ComponentProps<"hr">) {
  return <hr className={cn("border-0 border-t border-border", className)} {...props} />;
}
