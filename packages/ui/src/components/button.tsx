/*
 * @anansi/ui — Button, LinkButton.
 */
import { forwardRef, type ComponentProps, type MouseEvent } from "react";
import { cn } from "../cn.js";
import { Spinner } from "./feedback.js";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium " +
  "transition-all duration-150 ease-standard active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:active:scale-100";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90 active:opacity-95 shadow-sm",
  secondary: "bg-secondary text-secondary-foreground hover:bg-muted",
  outline: "border border-border bg-transparent text-foreground hover:bg-accent hover:border-border",
  ghost: "bg-transparent text-foreground hover:bg-accent",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90 active:opacity-95 shadow-sm",
};

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-6 text-base",
};

const SPINNER_SIZE: Record<ButtonSize, string> = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-4",
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows an inline spinner and disables the button. Sets aria-busy. */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      type = "button",
      children,
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)}
      {...props}
    >
      {loading && <Spinner className={SPINNER_SIZE[size]} />}
      {children}
    </button>
  )
);
Button.displayName = "Button";

export interface LinkButtonProps extends ComponentProps<"a"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Anchors have no native disabled state: this strips href/tabindex, sets
   *  aria-disabled, and swallows clicks, styled to match Button's disabled look. */
  disabled?: boolean;
}

export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(
  ({ className, variant = "primary", size = "md", disabled = false, onClick, href, ...props }, ref) => (
    <a
      ref={ref}
      href={disabled ? undefined : href}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (disabled) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)}
      {...props}
    />
  )
);
LinkButton.displayName = "LinkButton";
