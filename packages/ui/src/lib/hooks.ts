/*
 * @anansi/ui — internal hooks. Not part of the public API surface (not re-exported
 * from index.tsx). Small, dependency-free focus/interaction utilities shared by the
 * interactive components (Dialog, DropdownMenu, Tooltip, CommandPalette, Tabs, Toast).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** useLayoutEffect that no-ops (falls back to useEffect) outside the browser, so
 *  importing this file doesn't trigger the SSR "useLayoutEffect does nothing on the
 *  server" warning in apps that render @anansi/ui on the server (e.g. Next.js). */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Controlled-or-uncontrolled state, the shadcn/Radix pattern: pass `value` +
 * `onChange` to control it externally, or just `defaultValue` to let it manage
 * its own state. Powers Tabs' `value`/`defaultValue`/`onValueChange`.
 */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: {
  value?: T;
  defaultValue: T;
  onChange?: (value: T) => void;
}): [T, (next: T) => void] {
  const [internal, setInternal] = useState<T>(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? (value as T) : internal;

  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setInternal(next);
      onChange?.(next);
    },
    [isControlled, onChange]
  );

  return [current, setValue];
}

/** Calls `handler` when Escape is pressed while `enabled`. */
export function useEscapeKey(handler: () => void, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handlerRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

/** Calls `handler` on pointerdown outside every node in `refs`, while `enabled`. */
export function useOutsideClick(
  refs: Array<RefObject<HTMLElement | null>>,
  handler: (event: PointerEvent) => void,
  enabled = true
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      const isInside = refs.some((ref) => ref.current?.contains(target));
      if (!isInside) handlerRef.current(e);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [refs, enabled]);
}

/** Locks page scroll (via `overflow:hidden` on <body>) while `locked`. Belt-and-braces
 *  alongside native <dialog> modal behavior, which doesn't reliably block touch-scroll
 *  of the page behind it in every engine. Restores the previous value on unlock. */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [locked]);
}

/** Stable numeric id, unique per mount, for wiring aria-* relationships without
 *  colliding across multiple instances of the same component. Wraps React's useId
 *  (SSR-safe) so call sites don't need to import it separately. */
export { useId } from "react";
