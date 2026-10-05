"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps } from "motion/react";

import { cx } from "@/components/ui/cx";
import { spring } from "@/lib/motion";

/**
 * Overlays — the dialog `#ask` (L455–464), the toast `#toast` (L465–467), and
 * a side drawer built from the dialog's look (no mockup equivalent;
 * docs/DESIGN.md §5.4, §13 6.2). The scrim is `--color-scrim`.
 */

/**
 * HOW AN OVERLAY LEAVES (docs/DESIGN.md §15.4). It used to vanish the instant
 * it closed; now each layer goes out on the sheets' spring, the way it came in:
 *
 *   fade   a scrim (`.ask`, `.scrim`) fades
 *   drop   a dialog's box (`.box`) fades and drops a little
 *   side   the drawer fades back toward its edge
 */
const WAYS = {
  fade: { home: { opacity: 1 }, away: { opacity: 0 } },
  drop: { home: { opacity: 1, y: 0 }, away: { opacity: 0, y: 8 } },
  side: { home: { opacity: 1, x: 0 }, away: { opacity: 0, x: 32 } },
} as const;

type LayerProps = Omit<HTMLMotionProps<"div">, "initial" | "animate" | "exit" | "transition" | "children"> & {
  leave: keyof typeof WAYS;
  /** The layer that holds the content: while it leaves it shows a still of what it last showed. */
  still?: boolean;
  /** The element, for a caller that moves focus into it. */
  elRef?: RefObject<HTMLDivElement | null>;
  children?: ReactNode;
};

/**
 * ONE LAYER OF AN OVERLAY, a direct or deeper child of AnimatePresence. Open,
 * it is what it always was — its entrance is still the CSS one (`fadein`,
 * `pop`, `drawerin`). Closing does exactly what it did — Escape and the scrim
 * stop answering, focus goes back, the page behind scrolls again, the content
 * unmounts, all at the same moment as before — and only the picture lingers
 * while it leaves:
 *
 *  - it stops answering: inert, no pointer, hidden from assistive tech;
 *  - its CSS entrance lets go of it (a filled animation outranks the inline
 *    style the spring writes), so the spring can move it;
 *  - `still`: the content becomes a still of its last frame, taken from the
 *    page in the render that sees it leave. A sheet whose title came from state
 *    the caller has just cleared does not flash blank, and nothing inside it
 *    keeps running (a drawer's hold on the page's scroll lets go at once).
 */
export function OverlayLayer({ leave, still, elRef, style, children, ...rest }: LayerProps) {
  const present = useIsPresent();
  const own = useRef<HTMLDivElement>(null);
  const el = elRef ?? own;
  const shot = useRef<string | null>(null);
  if (present) shot.current = null;
  else if (still && shot.current === null) shot.current = el.current?.innerHTML ?? "";
  // A still is new elements: their CSS entrances would play again, and their ids would be in the page twice.
  useLayoutEffect(() => {
    if (present || !still || !el.current) return;
    for (const node of el.current.querySelectorAll<HTMLElement | SVGElement>("*")) {
      node.style.animation = "none";
      node.removeAttribute("id");
    }
  }, [present, still, el]);
  const way = WAYS[leave];
  return (
    <motion.div
      {...rest}
      ref={el}
      initial={false}
      animate={way.home}
      exit={way.away}
      transition={spring.gentle}
      inert={!present}
      aria-hidden={present ? rest["aria-hidden"] : true}
      style={present ? style : { ...style, animation: "none", pointerEvents: "none" }}
      {...(still && !present ? { dangerouslySetInnerHTML: { __html: shot.current ?? "" } } : { children })}
    />
  );
}

/** Close on Escape while `open`. */
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

/**
 * A panel from the inline-end over the scrim — `.scrim` + `.drawer`.
 *
 * It takes focus when it opens and hands it back when it closes; without that,
 * the keyboard keeps scrolling the page behind the scrim. Escape and the scrim
 * close it; scrolling inside it never chains to the page. It leaves the way it
 * came (`OverlayLayer`).
 */
export function Drawer({
  open,
  onClose,
  label,
  wide,
  bare,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  wide?: boolean;
  /** No padding — the content brings its own. */
  bare?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEscape(open, onClose);
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus({ preventScroll: true });
    return () => {
      if (before && before.isConnected) before.focus({ preventScroll: true });
    };
  }, [open]);
  return (
    <AnimatePresence>
      {open ? <OverlayLayer key="scrim" leave="fade" className="scrim" onClick={onClose} /> : null}
      {open ? (
        <OverlayLayer
          key="drawer"
          leave="side"
          still
          elRef={panel}
          tabIndex={-1}
          className={cx("drawer", wide && "wide", bare && "bare")}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          data-sc=""
        >
          {children}
        </OverlayLayer>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * A dialog — the mockup's `#ask` as `.ask .box`: a 17px title, a 13px muted
 * body, then equal-width actions. `actions` render in `.aa`; give each button
 * `no` (cancel), `go` (blue confirm) or `yes` (the danger confirm).
 *
 *   <Dialog open title="Delete this moment?" onClose={close}
 *     actions={<><button className="no" onClick={close}>Cancel</button>
 *               <button className="yes" onClick={del}>Delete</button></>}>
 *     What it collected goes with it.
 *   </Dialog>
 */
export function Dialog({
  open,
  onClose,
  title,
  kicker,
  children,
  actions,
  label,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** A small tracked line above the title. */
  kicker?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** Accessible name; defaults to the title when it is a string. */
  label?: string;
}) {
  useEscape(open, onClose);
  return (
    <AnimatePresence>
      {open ? (
        <OverlayLayer key="ask" leave="fade" className="ask" onClick={onClose}>
          <OverlayLayer
            leave="drop"
            still
            className="box"
            role="dialog"
            aria-modal="true"
            aria-label={label ?? (typeof title === "string" ? title : undefined)}
            onClick={(e) => e.stopPropagation()}
          >
            {kicker ? <div className="lb">{kicker}</div> : null}
            <b>{title}</b>
            {typeof children === "string" ? <p>{children}</p> : children}
            {actions ? <div className="aa">{actions}</div> : null}
          </OverlayLayer>
        </OverlayLayer>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * The toast — `.toast` (the mockup's `#toast`): ink, white 13px, centred 26px
 * above the bottom. Render it while there is a message; it rises in on mount.
 */
export function Toast({ children }: { children: ReactNode }) {
  return (
    <div className="toast" role="status">
      {children}
    </div>
  );
}
