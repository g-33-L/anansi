/*
 * @anansi/ui — interactive overlays: Dialog, Tabs, Tooltip, DropdownMenu, Toast,
 * CommandPalette. Dependency-free; built on lib/hooks + lib/position + lib/utils.
 * Accessible: focus management, ARIA roles, keyboard nav; dark/light via tokens.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../cn.js";
import {
  XIcon,
  SearchIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  AlertCircleIcon,
  InfoIcon,
} from "./icons.js";
import {
  useEscapeKey,
  useOutsideClick,
  useBodyScrollLock,
  useControllableState,
  useIsomorphicLayoutEffect,
  useId,
} from "../lib/hooks.js";
import { computePosition, type Side, type Align, type PositionResult } from "../lib/position.js";
import { fuzzyMatch } from "../lib/utils.js";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* ───────────────────────── Dialog ───────────────────────── */

export interface DialogProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function Dialog({ open, onOpenChange, title, description, children, className }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEscapeKey(() => onOpenChange?.(false), open);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel).focus();
  }, [open]);

  if (!open) return null;

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange?.(false)} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          "relative w-full max-w-lg rounded-lg border border-border bg-popover p-6 text-popover-foreground shadow-lg focus:outline-none",
          className
        )}
      >
        {onOpenChange && (
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon className="size-4" />
          </button>
        )}
        {title && (
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h2>
        )}
        {description && (
          <p id={descId} className="mt-1 text-sm text-muted-foreground">
            {description}
          </p>
        )}
        <div className={cn(title || description ? "mt-4" : undefined)}>{children}</div>
      </div>
    </div>,
    document.body
  );
}

/* ───────────────────────── Tabs ───────────────────────── */

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}
export interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function Tabs({ items, value, defaultValue, onValueChange, className }: TabsProps) {
  const [active, setActive] = useControllableState({
    value,
    defaultValue: defaultValue ?? items[0]?.value ?? "",
    onChange: onValueChange,
  });
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: ReactKeyboardEvent) {
    const enabled = items.filter((it) => !it.disabled);
    const idx = enabled.findIndex((it) => it.value === active);
    let next: number;
    if (e.key === "ArrowRight") next = (idx + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    else return;
    e.preventDefault();
    const nextValue = enabled[next]?.value;
    if (nextValue) {
      setActive(nextValue);
      listRef.current?.querySelector<HTMLElement>(`[data-tab-value="${nextValue}"]`)?.focus();
    }
  }

  return (
    <div className={className}>
      <div ref={listRef} role="tablist" onKeyDown={onKeyDown} className="flex gap-1 border-b border-border">
        {items.map((it) => {
          const selected = it.value === active;
          return (
            <button
              key={it.value}
              type="button"
              role="tab"
              id={`${baseId}-tab-${it.value}`}
              data-tab-value={it.value}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${it.value}`}
              tabIndex={selected ? 0 : -1}
              disabled={it.disabled}
              onClick={() => setActive(it.value)}
              className={cn(
                "relative -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
                it.disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {it.label}
            </button>
          );
        })}
      </div>
      {items.map((it) => (
        <div
          key={it.value}
          role="tabpanel"
          id={`${baseId}-panel-${it.value}`}
          aria-labelledby={`${baseId}-tab-${it.value}`}
          hidden={it.value !== active}
          className="pt-4"
        >
          {it.value === active ? it.content : null}
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────── Tooltip ───────────────────────── */

export function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
}: {
  label: ReactNode;
  children: ReactNode;
  side?: Side;
  align?: Align;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PositionResult | null>(null);
  const tipId = useId();

  useIsomorphicLayoutEffect(() => {
    if (!open || !triggerRef.current || !tipRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    setPos(computePosition(rect, { width: tip.width, height: tip.height }, { side, align }));
  }, [open, side, align]);

  return (
    <span
      ref={triggerRef}
      className="inline-flex"
      tabIndex={0}
      aria-describedby={open ? tipId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            id={tipId}
            style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className="pointer-events-none z-50 max-w-xs rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md"
          >
            {label}
          </div>,
          document.body
        )}
    </span>
  );
}

/* ───────────────────────── DropdownMenu ───────────────────────── */

export interface DropdownItem {
  label: string;
  onSelect?: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
}

export function DropdownMenu({
  trigger,
  items,
  side = "bottom",
  align = "start",
  className,
}: {
  trigger: ReactNode;
  items: DropdownItem[];
  side?: Side;
  align?: Align;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PositionResult | null>(null);

  useEscapeKey(() => setOpen(false), open);
  useOutsideClick([triggerRef, menuRef], () => setOpen(false), open);

  useIsomorphicLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    setPos(computePosition(rect, { width: menu.width, height: menu.height }, { side, align }));
  }, [open, side, align]);

  function onMenuKeyDown(e: ReactKeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const nodes = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []
    );
    if (nodes.length === 0) return;
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "ArrowDown" ? (current + 1) % nodes.length : (current - 1 + nodes.length) % nodes.length;
    nodes[next].focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center"
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onKeyDown={onMenuKeyDown}
            style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
            className={cn(
              "z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md",
              className
            )}
          >
            {items.map((it, i) => (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  it.onSelect?.();
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
                  it.destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-accent"
                )}
              >
                {it.icon}
                {it.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

/* ───────────────────────── Toast ───────────────────────── */

export type ToastVariant = "default" | "success" | "warning" | "danger" | "info";

const TOAST_ICON: Record<ToastVariant, ReactNode> = {
  default: null,
  success: <CheckCircleIcon className="size-4 text-success" />,
  warning: <AlertTriangleIcon className="size-4 text-warning" />,
  danger: <AlertCircleIcon className="size-4 text-destructive" />,
  info: <InfoIcon className="size-4 text-info" />,
};

export function Toast({
  variant = "default",
  children,
  onClose,
  className,
}: {
  variant?: ToastVariant;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-md border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md",
        className
      )}
    >
      {TOAST_ICON[variant]}
      <div className="flex-1">{children}</div>
      {onClose && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onClose}
          className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── CommandPalette ───────────────────────── */

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  onSelect?: () => void;
}

export function CommandPalette({
  open,
  onClose,
  actions = [],
  placeholder = "Type a command or search…",
}: {
  open?: boolean;
  onClose?: () => void;
  actions?: CommandAction[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  useEscapeKey(() => onClose?.(), !!open);
  useBodyScrollLock(!!open);

  const results = useMemo(
    () =>
      actions
        .map((a) => ({ a, m: fuzzyMatch(`${a.label} ${a.hint ?? ""}`, query) }))
        .filter((r) => r.m.matched)
        .sort((x, y) => x.m.score - y.m.score)
        .map((r) => r.a),
    [actions, query]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  if (!open) return null;

  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const action = results[activeIndex];
      if (action) {
        action.onSelect?.();
        onClose?.();
      }
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]">
      <div className="absolute inset-0 bg-black/50" onClick={() => onClose?.()} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        className="relative w-full max-w-xl overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Command"
            className="h-11 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul role="listbox" className="max-h-80 overflow-y-auto p-1">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">No results.</li>
          ) : (
            results.map((a, i) => (
              <li
                key={a.id}
                role="option"
                aria-selected={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => {
                  a.onSelect?.();
                  onClose?.();
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between rounded-sm px-3 py-2 text-sm",
                  i === activeIndex ? "bg-accent text-foreground" : "text-muted-foreground"
                )}
              >
                <span>{a.label}</span>
                {a.hint && <span className="text-xs text-muted-foreground">{a.hint}</span>}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body
  );
}
