import type { Transition } from "motion/react";

/**
 * THE CONTROL ROOM'S MOTION — one set of springs for everything, so a sliding
 * tab, an unfolding card and a dialog all move with the same physics
 * (docs/DESIGN.md §15.4). Taken as they are from the editor Belal liked on his
 * portfolio (src/components/editor/motion.ts there).
 *
 * `visualDuration` is roughly how long the movement takes to look finished;
 * `bounce` is how far it overshoots. Kept small: a soft settle, never a wobble.
 *
 * Import from "motion/react". The shell wraps the control room in
 * `<MotionConfig reducedMotion="user">`, so every one of these turns into an
 * instant change for anyone who asked their system for less motion.
 */
export const spring = {
  /** Toggles, tab thumbs, the rail's highlight, small controls. */
  snappy: { type: "spring", visualDuration: 0.22, bounce: 0.18 },
  /** Cards unfolding, lists reflowing, a page settling in. */
  smooth: { type: "spring", visualDuration: 0.38, bounce: 0.12 },
  /** Larger surfaces: sheets, dialogs, the drawer. */
  gentle: { type: "spring", visualDuration: 0.5, bounce: 0.1 },
} as const satisfies Record<string, Transition>;

/**
 * The same feel for CSS transitions, where a spring cannot run:
 * `--ease-out` (fast out, long gentle settle) and `--ease-spring` (a 3% overshoot)
 * in app/cib-premium.css. This is the first, as a string for inline styles.
 */
export const SETTLE_EASING = "cubic-bezier(0.2, 0.85, 0.25, 1)";

/** A fold that opens to its natural height: the Collapse card, a disclosure. */
export const fold = {
  initial: { height: 0, opacity: 0 },
  animate: { height: "auto", opacity: 1 },
  exit: { height: 0, opacity: 0 },
} as const;

/** Something arriving: 6px up and in (the mockup's `fd`, on a spring). */
export const rise = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
} as const;
