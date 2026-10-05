"use client";

import { useLayoutEffect, useState } from "react";

/** Where a thing sits inside a layer, in the layer's own pixels. */
export type LayerRect = { left: number; top: number; width: number; height: number };

const same = (a: LayerRect | null, b: LayerRect | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/** `el`'s box, measured from `layer`'s top-left corner (rounded to the half pixel, so tools never shimmer). */
export function rectIn(el: Element, layer: Element): LayerRect {
  const a = el.getBoundingClientRect();
  const b = layer.getBoundingClientRect();
  const r = (n: number) => Math.round(n * 2) / 2;
  return { left: r(a.left - b.left), top: r(a.top - b.top), width: r(a.width), height: r(a.height) };
}

/**
 * THE BOX A TOOL FOLLOWS — a text, a part of a screen — as it sits in the tools' layer (a layer
 * beside the scaled screen, so the tools stay crisp at any scale). Measured before paint, and
 * again whenever either box changes size, the window resizes, or anything scrolls (the phone's
 * own screen scrolls inside the page).
 */
export function useLayerRect(el: Element | null, layer: Element | null, watch?: unknown): LayerRect | null {
  const [rect, setRect] = useState<LayerRect | null>(null);
  useLayoutEffect(() => {
    if (!el || !layer) {
      setRect(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!el.isConnected) return;
        const next = rectIn(el, layer);
        setRect((cur) => (same(cur, next) ? cur : next));
      });
    };
    setRect(rectIn(el, layer));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(layer);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [el, layer, watch]);
  return rect;
}
