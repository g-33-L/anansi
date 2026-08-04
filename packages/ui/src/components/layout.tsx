/*
 * @anansi/ui — layout & typography primitives.
 */
import { type ComponentProps } from "react";
import { cn } from "../cn.js";
import { semanticText } from "../lib/utils.js";

export function Container({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-6xl px-6", className)} {...props} />;
}

export function Section({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("py-16 sm:py-24", className)} {...props} />;
}

export function Eyebrow({ className, ...props }: ComponentProps<"p">) {
  // NOTE(a11y): the original plain `text-primary` measures 2.7:1 against
  // `background` in light mode (fails WCAG AA 4.5:1) — mid-lightness silk amber as
  // *text* rather than a fill. semanticText() keeps the brand-amber read while
  // passing >=4.5:1 in both themes; see lib/utils.ts.
  return (
    <p
      className={cn(
        "text-sm font-semibold uppercase tracking-widest",
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
    1: "text-4xl sm:text-5xl font-semibold tracking-tight font-display",
    2: "text-3xl font-semibold tracking-tight",
    3: "text-xl font-semibold tracking-tight",
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
