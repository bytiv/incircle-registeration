"use client";

import "./guide.css";

import { useEffect, useRef, useState } from "react";

import { useGuide } from "./GuideProvider";
import { onScreen, placeTip, SIDES, type Box, type Side } from "./place";

/**
 * THE GUIDE'S ONE TOOLTIP LAYER — mounted once, by AdminShell, for the whole control room.
 *
 * While the guide is on, a control that carries `data-guide` (or, as the fallback, a button or a
 * link with a `title`) says its sentence in a small deep-blue tip beside it, a beat after the
 * pointer rests on it or the keyboard lands on it:
 *
 *   - beside the control, never over it and never under the pointer; it flips at the screen's
 *     edges and follows the control when the page scrolls or moves;
 *   - it rises and fades in on the shared tokens (--dur-snappy, --ease-out) and fades out when the
 *     pointer leaves, a press lands, Escape is pressed or the control goes;
 *   - the native `title` tip is held back while the guide talks, and put back afterwards;
 *   - a screen reader hears the sentence once: as the control's description (aria-describedby,
 *     while it shows) when it came from `data-guide`, or through the title that is still there;
 *   - it takes no focus and no clicks (pointer-events: none), so nothing is ever trapped;
 *   - a control that cannot be pressed right now still says why: the mockup's disabled buttons
 *     take no pointer events (app/cib.css), so the layer looks under the pointer for them.
 *
 * Off — or on a screen without hover (touch) — nothing listens and nothing is drawn.
 */

/** The first tip waits a beat, so passing over a control on the way somewhere says nothing. */
const DELAY_MS = 400;
/** While the guide is already talking, the next control answers almost at once. */
const WARM_MS = 90;
/** How long after a tip goes the next still counts as "already talking". */
const WARM_FOR_MS = 600;
/** A tip's fade (--dur-snappy): its words are cleared once it has gone. */
const FADE_MS = 220;
/** A focus that follows a press is the mouse's, not the keyboard's. */
const PRESS_FOCUS_MS = 300;

const TIP_IDS = ["cib-guide-a", "cib-guide-b"] as const;

/** What the `title` fallback counts as a control: a button or a link. */
const CONTROL = "button, a, [role='button'], [role='link']";
/** A control that cannot be pressed right now, with something to say. */
const OFF = ":is(button:disabled, [aria-disabled='true']):is([data-guide], [title])";

export function GuideLayer() {
  const { on } = useGuide();
  const canHover = useCanHover();
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const live = on && canHover;

  useEffect(() => {
    if (!live || !a.current || !b.current) return;
    return startGuide([a.current, b.current]);
  }, [live]);

  if (!live) return null;
  /* Two tips, taking turns, so one fades out where it was while the next rises in at its control. */
  return (
    <>
      <div ref={a} id={TIP_IDS[0]} className="guide-tip" role="tooltip" />
      <div ref={b} id={TIP_IDS[1]} className="guide-tip" role="tooltip" />
    </>
  );
}

/** A screen that can hover: touch screens keep the guide out of the way. */
function useCanHover(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: hover)");
    const update = () => setCan(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return can;
}

type Target = { el: HTMLElement; text: string; fromTitle: boolean };

/** Letters and digits only: a title that just repeats the label says nothing new. */
const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

function startGuide(tips: HTMLElement[]): () => void {
  /** The control the guide is about, and whether the pointer or the keyboard brought it. */
  let cur: Target | null = null;
  let via: "pointer" | "focus" | null = null;
  /** The tip speaking for `cur`, and whether it is on screen. */
  let tip: HTMLElement | null = null;
  let open = false;
  let turn = 0;
  let showT: ReturnType<typeof setTimeout> | undefined;
  const clearT = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  let lastClose = -Infinity;
  /** Pressed or dismissed: quiet until the pointer (or the focus) leaves it. */
  let muted: HTMLElement | null = null;
  let pointer: { x: number; y: number } | null = null;
  let downAt = -Infinity;
  let raf = 0;
  let placedKey = "";
  /** The native title that would show over the guide's tip, held back while the pointer is on it. */
  let stash: { el: HTMLElement; title: string } | null = null;
  /** The aria-describedby the guide added, and what was there before. */
  let described: { el: HTMLElement; prev: string | null } | null = null;

  const view = () => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight });
  const titleOf = (el: Element) => (stash && stash.el === el ? stash.title : el.getAttribute("title"));

  /** The innermost element with a guide: `data-guide`, or a button or link with a title. */
  function resolve(start: Element | null): Target | null {
    for (let n: Element | null = start; n && n !== document.body; n = n.parentElement) {
      if (!(n instanceof HTMLElement)) continue;
      const g = n.getAttribute("data-guide");
      if (g !== null) {
        const text = g.trim();
        return text ? { el: n, text, fromTitle: false } : null;
      }
      const t = titleOf(n)?.trim();
      if (t && n.matches(CONTROL)) return bare(t) !== bare(n.textContent ?? "") ? { el: n, text: t, fromTitle: true } : null;
    }
    return null;
  }

  /**
   * A disabled control under the pointer. It takes no pointer events, so the event lands on
   * something around it: look inside that for a control that cannot be pressed and holds the point.
   */
  function offAt(node: Element | null, x: number, y: number): Target | null {
    if (!node) return null;
    for (const el of Array.from(node.querySelectorAll<HTMLElement>(OFF))) {
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const t = resolve(el);
      if (t) return t;
    }
    return null;
  }

  /** The element whose title the browser would show at this point. */
  function nearestTitled(start: Element | null): HTMLElement | null {
    for (let n: Element | null = start; n && n !== document.documentElement; n = n.parentElement) {
      if (n instanceof HTMLElement && titleOf(n)) return n;
    }
    return null;
  }

  function holdTitle(el: HTMLElement | null) {
    if (stash?.el === el) return;
    giveTitle();
    const title = el?.getAttribute("title");
    if (!el || !title) return;
    stash = { el, title };
    el.removeAttribute("title");
  }
  function giveTitle() {
    if (!stash) return;
    const { el, title } = stash;
    stash = null;
    if (el.isConnected && !el.hasAttribute("title")) el.setAttribute("title", title);
  }

  function describe() {
    if (!cur || !tip) return;
    /* A title still on the control already tells a screen reader, and so does a name that says
       the same words: said once, not twice. */
    if (cur.fromTitle && cur.el.hasAttribute("title")) return;
    if (bare(cur.el.getAttribute("aria-label") ?? cur.el.textContent ?? "") === bare(cur.text)) return;
    const prev = cur.el.getAttribute("aria-describedby");
    described = { el: cur.el, prev };
    cur.el.setAttribute("aria-describedby", prev ? `${prev} ${tip.id}` : tip.id);
  }
  function undescribe() {
    if (!described) return;
    const { el, prev } = described;
    described = null;
    if (prev === null) el.removeAttribute("aria-describedby");
    else el.setAttribute("aria-describedby", prev);
  }

  /** The next tip, closed at once (it may still be fading from the control before last), with its words. */
  function take(text: string): HTMLElement {
    const el = tips[turn];
    turn = (turn + 1) % tips.length;
    clearTimeout(clearT.get(el));
    el.removeAttribute("data-open");
    el.style.transition = "none";
    el.textContent = text;
    void el.offsetWidth;
    el.style.transition = "";
    return el;
  }
  function close(el: HTMLElement | null) {
    if (!el) return;
    if (el.hasAttribute("data-open")) {
      el.removeAttribute("data-open");
      lastClose = performance.now();
    }
    clearTimeout(clearT.get(el));
    clearT.set(
      el,
      setTimeout(() => {
        if (el !== tip && !el.hasAttribute("data-open")) el.textContent = "";
      }, FADE_MS + 60),
    );
  }

  /** `display: contents` has no box of its own: its children's, together. */
  function rectOf(el: HTMLElement): Box | null {
    const r = el.getBoundingClientRect();
    if (r.width || r.height) return r;
    let box: { l: number; t: number; r: number; b: number } | null = null;
    for (const c of Array.from(el.children)) {
      const cr = c.getBoundingClientRect();
      if (!cr.width && !cr.height) continue;
      box = box
        ? { l: Math.min(box.l, cr.left), t: Math.min(box.t, cr.top), r: Math.max(box.r, cr.right), b: Math.max(box.b, cr.bottom) }
        : { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom };
    }
    return box ? { left: box.l, top: box.t, width: box.r - box.l, height: box.b - box.t } : null;
  }

  /**
   * A side the page asks for first: `data-guide-at` on the control or around it. Around it, the tip
   * sits beside that whole area, level with the control (the rail says right: every tip of the
   * rail lands on the page, just past its edge).
   */
  function askedFor(el: HTMLElement, vis: Box): { order: Side[]; anchor: Box } {
    const host = el.closest<HTMLElement>("[data-guide-at]");
    const at = host?.getAttribute("data-guide-at") as Side | null | undefined;
    if (!host || !at || !SIDES.includes(at)) return { order: SIDES, anchor: vis };
    const order = [at, ...SIDES.filter((s) => s !== at)];
    if (host === el) return { order, anchor: vis };
    const h = host.getBoundingClientRect();
    return {
      order,
      anchor: at === "left" || at === "right" ? { left: h.left, width: h.width, top: vis.top, height: vis.height } : { left: vis.left, width: vis.width, top: h.top, height: h.height },
    };
  }

  /** Puts the tip beside its control; false when the control is not on screen. */
  function place(first: boolean): boolean {
    if (!cur || !tip) return false;
    const v = view();
    const r = rectOf(cur.el);
    const vis = r ? onScreen(r, v) : null;
    if (!vis) return false;
    const key = `${Math.round(vis.left)},${Math.round(vis.top)},${Math.round(vis.width)},${Math.round(vis.height)},${v.w},${v.h},${tip.textContent}`;
    if (!first && key === placedKey) return true;
    placedKey = key;
    const { order, anchor } = askedFor(cur.el, vis);
    const { x, y, side } = placeTip(anchor, { w: tip.offsetWidth, h: tip.offsetHeight }, v, order, pointer);
    /* First placing: no transition, so it rises from its own side of the control, not from the last place. */
    if (first) tip.style.transition = "none";
    tip.dataset.side = side;
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
    if (first) {
      void tip.offsetWidth;
      tip.style.transition = "";
    }
    return true;
  }

  function show() {
    if (!cur || !tip || !cur.el.isConnected) return;
    if (!place(true)) return;
    open = true;
    tip.setAttribute("data-open", "");
    follow();
  }

  /** The tip follows its control while it shows: a scroll, a fold opening above it, a resize. */
  function follow() {
    if (raf) return;
    const frame = () => {
      raf = 0;
      if (!cur || !tip || !open) return;
      if (!cur.el.isConnected || !place(false)) {
        drop();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }

  /** The guide stops talking about the current control. */
  function drop() {
    clearTimeout(showT);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    undescribe();
    const was = tip;
    tip = null;
    open = false;
    cur = null;
    via = null;
    close(was);
  }

  /** The guide turns to a control (or to none). */
  function want(t: Target | null, source: "pointer" | "focus") {
    if (t && cur && t.el === cur.el) {
      via = source;
      if (t.text !== cur.text) retext(t.text);
      return;
    }
    const warm = open || performance.now() - lastClose < WARM_FOR_MS;
    if (cur) drop();
    if (!t) return;
    cur = t;
    via = source;
    tip = take(t.text);
    describe();
    showT = setTimeout(show, warm ? WARM_MS : DELAY_MS);
  }

  function retext(text: string) {
    if (!cur || !tip) return;
    cur = { ...cur, text };
    tip.textContent = text;
    if (open) place(false);
  }

  /* React may re-render a control while the guide holds its title (or change its words): keep the
     title held, and say the new words. */
  const mo = new MutationObserver((records) => {
    if (stash && stash.el.hasAttribute("title")) {
      stash.title = stash.el.getAttribute("title") ?? stash.title;
      stash.el.removeAttribute("title");
    }
    const c = cur;
    if (!c || !records.some((r) => r.target === c.el)) return;
    const g = c.el.getAttribute("data-guide");
    const text = (g ?? titleOf(c.el) ?? "").trim();
    if (!text) drop();
    else if (text !== c.text) retext(text);
  });
  mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["title", "data-guide"] });

  /** The pointer is over `target` at x, y: the guide turns to what is there. */
  function pointerAt(target: EventTarget | null, x: number, y: number, buttons: number) {
    pointer = { x, y };
    const node = target instanceof Element ? target : null;
    const t = offAt(node, x, y) ?? resolve(node);
    if (muted && t?.el !== muted) muted = null;
    /* Over a control with a guide, the native title keeps quiet; anywhere else it is back. */
    holdTitle(t ? nearestTitled(node) : null);
    if (!t || t.el === muted || buttons !== 0) {
      if (via === "pointer" || buttons !== 0) drop();
      return;
    }
    want(t, "pointer");
  }
  /* A move is looked at once a frame: within one element it can still cross a disabled control. */
  let moved: { target: EventTarget | null; x: number; y: number; buttons: number } | null = null;
  let moveRaf = 0;

  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== "touch") pointerAt(e.target, e.clientX, e.clientY, e.buttons);
  };
  const onOut = (e: PointerEvent) => {
    if (e.pointerType === "touch" || e.relatedTarget) return;
    /* Out of the window. */
    pointer = null;
    moved = null;
    muted = null;
    giveTitle();
    if (via === "pointer") drop();
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    pointer = { x: e.clientX, y: e.clientY };
    moved = { target: e.target, x: e.clientX, y: e.clientY, buttons: e.buttons };
    if (!moveRaf)
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        if (moved) pointerAt(moved.target, moved.x, moved.y, moved.buttons);
      });
  };
  const onDown = (e: PointerEvent) => {
    downAt = performance.now();
    if (cur) {
      /* A press on the control (a disabled one takes the press on what is around it) quiets it. */
      const r = cur.el.getBoundingClientRect();
      const onIt = (e.target instanceof Node && cur.el.contains(e.target)) || (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
      if (onIt) muted = cur.el;
      drop();
    }
  };
  const onFocusIn = (e: FocusEvent) => {
    if (performance.now() - downAt < PRESS_FOCUS_MS) return;
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (!el) return;
    let keyboard = true;
    try {
      keyboard = el.matches(":focus-visible");
    } catch {
      /* an old browser: every focus counts */
    }
    if (!keyboard) return;
    const t = resolve(el);
    if (muted && t?.el !== muted) muted = null;
    if (!t || t.el === muted) {
      if (via === "focus") drop();
      return;
    }
    want(t, "focus");
  };
  const onFocusOut = () => {
    if (via === "focus") drop();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!cur) return;
    /* Escape dismisses it where it is; pressing the focused control is a press. */
    if (e.key === "Escape" || (via === "focus" && (e.key === "Enter" || e.key === " "))) {
      muted = cur.el;
      drop();
    }
  };
  const onLeave = () => {
    pointer = null;
    moved = null;
    giveTitle();
    drop();
  };
  const onHidden = () => {
    if (document.visibilityState === "hidden") onLeave();
  };

  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", onOut, true);
  document.addEventListener("pointermove", onMove, { capture: true, passive: true });
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("blur", onLeave);

  return () => {
    document.removeEventListener("pointerover", onOver, true);
    document.removeEventListener("pointerout", onOut, true);
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("focusout", onFocusOut, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("visibilitychange", onHidden);
    window.removeEventListener("blur", onLeave);
    mo.disconnect();
    if (moveRaf) cancelAnimationFrame(moveRaf);
    drop();
    giveTitle();
    for (const t of clearT.values()) clearTimeout(t);
  };
}
