"use client";

import { motion } from "motion/react";
import { createPortal } from "react-dom";

import { spring } from "@/lib/motion";

import { useLayerRect } from "./float";

/** Near the limit means the last fifth, or the last 20 characters, whichever comes first. */
export function nearLimit(length: number, limit: number | null): boolean {
  if (limit === null) return false;
  return length >= limit * 0.8 || limit - length <= 20;
}

/**
 * THE SMALL HINT UNDER A TEXT BEING TYPED — drawn in the tools' layer beside the scaled screen,
 * so it stays crisp at any scale. It says only what helps right now: how much room is left as
 * the limit nears, and, in body text, that Shift+Enter starts a new line. Otherwise nothing.
 */
export function EditHint({
  anchor,
  layer,
  length,
  limit,
  multiline,
}: {
  anchor: HTMLElement | null;
  layer: HTMLElement | null;
  length: number;
  limit: number | null;
  multiline?: boolean;
}) {
  const rect = useLayerRect(anchor, layer, length);
  const near = nearLimit(length, limit);
  if (!layer || !rect || (!near && !multiline)) return null;
  const left = limit === null ? 0 : Math.max(0, limit - length);
  const room = left === 0 ? `The most it takes: ${limit}` : `${left} left`;
  return createPortal(
    <motion.div
      className="mo-hint"
      data-full={near && left === 0 ? "" : undefined}
      style={{ left: rect.left, top: rect.top + rect.height + 8 }}
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.snappy}
      aria-live="polite"
    >
      {multiline ? <span className="mo-hint-k">Shift + Enter for a new line</span> : null}
      {near ? <b>{room}</b> : null}
    </motion.div>,
    layer,
  );
}
