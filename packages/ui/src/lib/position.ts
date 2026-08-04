/*
 * @anansi/ui — minimal viewport-aware trigger positioning for Tooltip and
 * DropdownMenu. Not a general-purpose floating-UI replacement: just enough to place
 * a small floating panel next to a trigger and flip it when it would overflow the
 * viewport. Pure function, easy to unit-reason about, zero dependencies.
 */
export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export interface PositionResult {
  top: number;
  left: number;
  side: Side;
}

const GAP = 8;
const VIEWPORT_PADDING = 8;

/**
 * Computes fixed-position `top`/`left` for a floating element next to `trigger`,
 * preferring `side`/`align`, flipping to the opposite side if the preferred side
 * doesn't fit, then clamping so the floating element never overflows the viewport.
 */
export function computePosition(
  trigger: DOMRect,
  floating: { width: number; height: number },
  { side = "bottom", align = "center" }: { side?: Side; align?: Align } = {}
): PositionResult {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const fits = {
    top: trigger.top >= floating.height + GAP,
    bottom: vh - trigger.bottom >= floating.height + GAP,
    left: trigger.left >= floating.width + GAP,
    right: vw - trigger.right >= floating.width + GAP,
  };

  let resolvedSide = side;
  if (!fits[side]) {
    const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
    if (fits[opposite[side]]) resolvedSide = opposite[side];
  }

  let top: number;
  let left: number;

  if (resolvedSide === "top" || resolvedSide === "bottom") {
    top = resolvedSide === "top" ? trigger.top - floating.height - GAP : trigger.bottom + GAP;
    if (align === "start") left = trigger.left;
    else if (align === "end") left = trigger.right - floating.width;
    else left = trigger.left + trigger.width / 2 - floating.width / 2;
  } else {
    left = resolvedSide === "left" ? trigger.left - floating.width - GAP : trigger.right + GAP;
    if (align === "start") top = trigger.top;
    else if (align === "end") top = trigger.bottom - floating.height;
    else top = trigger.top + trigger.height / 2 - floating.height / 2;
  }

  left = Math.min(Math.max(left, VIEWPORT_PADDING), vw - floating.width - VIEWPORT_PADDING);
  top = Math.min(Math.max(top, VIEWPORT_PADDING), vh - floating.height - VIEWPORT_PADDING);

  return { top, left, side: resolvedSide };
}
