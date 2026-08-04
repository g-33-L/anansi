/*
 * @anansi/ui — form controls: Input, Textarea, Label, Field, Select, Checkbox.
 */
import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "../cn.js";
import { ChevronDownIcon } from "./icons.js";

const CONTROL_BASE =
  "w-full rounded-md border border-input bg-card text-sm text-foreground shadow-[inset_0_1px_1px_rgb(21_27_36/0.02)] " +
  "placeholder:text-muted-foreground transition-[border-color,box-shadow,background-color] focus-visible:outline-none " +
  "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(CONTROL_BASE, "flex h-10 px-3 py-2", className)} {...props} />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(CONTROL_BASE, "flex min-h-20 px-3 py-2", className)} {...props} />
  )
);
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-xs font-semibold tracking-[0.01em] text-foreground", className)} {...props} />;
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export const Select = forwardRef<HTMLSelectElement, ComponentProps<"select">>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(CONTROL_BASE, "h-10 appearance-none pl-3 pr-9", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
);
Select.displayName = "Select";

export const Checkbox = forwardRef<HTMLInputElement, ComponentProps<"input">>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "size-4 rounded border-input accent-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Checkbox.displayName = "Checkbox";
