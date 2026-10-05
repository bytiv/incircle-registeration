/**
 * Where a guide tip goes: beside its control, never over it and never under the pointer, and
 * inside the screen. Pure, so it is the same sums for a hover, a focus and a scroll.
 */

export type Side = "top" | "bottom" | "right" | "left";

export type Box = { left: number; top: number; width: number; height: number };

/** The space between the control and its tip, and the tip's margin from the screen's edges. */
const GAP = 8;
const EDGE = 8;

export const SIDES: Side[] = ["top", "bottom", "right", "left"];

export function placeTip(
  anchor: Box,
  size: { w: number; h: number },
  view: { w: number; h: number },
  order: Side[] = SIDES,
  pointer?: { x: number; y: number } | null,
): { x: number; y: number; side: Side } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const clampX = (x: number) => clamp(x, EDGE, view.w - EDGE - size.w);
  const clampY = (y: number) => clamp(y, EDGE, view.h - EDGE - size.h);
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;

  const at = (side: Side) => {
    switch (side) {
      case "top":
        return { x: clampX(cx - size.w / 2), y: anchor.top - GAP - size.h };
      case "bottom":
        return { x: clampX(cx - size.w / 2), y: anchor.top + anchor.height + GAP };
      case "right":
        return { x: anchor.left + anchor.width + GAP, y: clampY(cy - size.h / 2) };
      case "left":
        return { x: anchor.left - GAP - size.w, y: clampY(cy - size.h / 2) };
    }
  };
  const fits = (p: { x: number; y: number }) =>
    p.x >= EDGE - 0.5 && p.y >= EDGE - 0.5 && p.x + size.w <= view.w - EDGE + 0.5 && p.y + size.h <= view.h - EDGE + 0.5;
  const covers = (p: { x: number; y: number }) =>
    !!pointer && pointer.x >= p.x - 4 && pointer.x <= p.x + size.w + 4 && pointer.y >= p.y - 4 && pointer.y <= p.y + size.h + 4;

  /* The first side that fits and keeps clear of the pointer, then the first that fits. */
  for (const side of order) {
    const p = at(side);
    if (fits(p) && !covers(p)) return { ...p, side };
  }
  for (const side of order) {
    const p = at(side);
    if (fits(p)) return { ...p, side };
  }
  /* Nothing fits beside it (it fills the screen): the top or the bottom edge, away from the pointer. */
  const low = !!pointer && pointer.y < view.h / 2;
  return { x: clampX(cx - size.w / 2), y: low ? clampY(view.h - EDGE - size.h) : EDGE, side: low ? "top" : "bottom" };
}

/** The part of a box that is on screen, or null when none of it is. */
export function onScreen(r: Box, view: { w: number; h: number }): Box | null {
  const left = Math.max(0, r.left);
  const top = Math.max(0, r.top);
  const right = Math.min(view.w, r.left + r.width);
  const bottom = Math.min(view.h, r.top + r.height);
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, top, width: right - left, height: bottom - top };
}
