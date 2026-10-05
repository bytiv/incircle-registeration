"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

import { FaceImg } from "@/components/admin/FaceImg";
import { OverlayLayer, Drawer as UiDrawer } from "@/components/ui/Overlay";
import { cx } from "@/components/ui/cx";
import { initials, personFaceStyle, type AdminPerson } from "@/lib/admin/model";
import { fold, spring } from "@/lib/motion";

/**
 * The control room's pieces, on the mockup's own classes (docs/DESIGN.md
 * §13 6.2). Every export keeps the name and props it had — the views and the
 * moment page import them — and each now renders the mockup's markup:
 *
 *   Card → .card (+ .lb)            Eyebrow → .lb (blue / warn / ok)
 *   Btn → .btn, .btn.g, …           LinkBtn → .back
 *   Toggle → .swrow + .sw           StatePill → .pill (+ .live dot)
 *   Stat → .st                      Tabs → .tabs
 *   SearchBox, Field → .fld, .mini  Ping → the live dot
 *   Drawer → .scrim + .drawer       Checks → .anrow ticks
 *   KvRows → .lrowk
 *   Names → .anch                   Avatar → .av
 *   Collapse → .allset              Sheet → .ask .box
 *
 * The premium layer (docs/DESIGN.md §15) adds, for the control room:
 *
 *   Hero → .hero (the brand gradient band)
 *   ActiveEventBand → .hero.evband (the active event, slim, over a page of its data)
 *   SettingsGroup, SettingsRow → .setgroup, .setcard, .setrow (grouped lists)
 *   SaveState → .savestate (a dot and a word, crossfading)
 *   usePending, useHeld, usePendingKeys, useHeldKeys, Reveal, Swap, Skeleton → waiting on the database (§15.4)
 *
 * and moves Tabs (a thumb that slides on a spring) and Collapse (it unfolds to
 * its height) with lib/motion.ts. The shell's MotionConfig honours reduced motion.
 *
 * New screens use components/ui directly; these stay for what already calls them.
 */

export { cx };

export function Card({
  children,
  className,
  style,
  danger,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** The danger zone: a melon border, a danger label. */
  danger?: boolean;
}) {
  return (
    <div className={cx("card", danger && "danger", className)} style={style}>
      {children}
    </div>
  );
}

/**
 * A kicker — `.lb`. `blue` names the live context, `warn` is a callout to act
 * on (orange-700), `ok` is done. (`cy`, `warm`, `mint` are the old names, kept
 * so older callers compile.)
 */
export type EyebrowTone = "blue" | "warn" | "ok" | "cy" | "warm" | "mint";

export function Eyebrow({
  children,
  tone,
  className,
  style,
}: {
  children: ReactNode;
  tone?: EyebrowTone;
  className?: string;
  style?: CSSProperties;
}) {
  const t =
    tone === "cy" || tone === "blue"
      ? "blue"
      : tone === "warm" || tone === "warn"
        ? "warn"
        : tone === "mint" || tone === "ok"
          ? "ok"
          : undefined;
  return (
    <div className={cx("lb", t, className)} style={style}>
      {children}
    </div>
  );
}

/**
 * `primary` is the blue `.btn` (the one commit of a view), `secondary` the
 * white `.btn.g` (everything else), `care` a secondary that turns melon on
 * hover (needs a second look), `danger` the confirm-delete fill, `ink` the ink
 * fill. `ramp`, `glass` and `solid` are the old names for primary, secondary
 * and danger, kept so older callers compile.
 */
export type BtnTone = "primary" | "secondary" | "care" | "danger" | "ink" | "ramp" | "glass" | "solid";

const TONE: Record<BtnTone, string> = {
  primary: "btn",
  secondary: "btn g",
  care: "btn g care",
  danger: "btn danger",
  ink: "btn ink",
  ramp: "btn",
  glass: "btn g",
  solid: "btn danger",
};

/** A button — `.btn` and its tones. With `href` it is a link that looks the same (the hall screen, the CSV). */

export function Btn({
  children,
  onClick,
  tone = "secondary",
  sm,
  armed,
  pending,
  disabled,
  title,
  href,
  target,
  rel,
  className,
  style,
  ...data
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: BtnTone;
  sm?: boolean;
  /** The arm-twice state: an orange ring, and the label says "Tap again". */
  armed?: boolean;
  /**
   * The press landed and the database is answering: a small turning ring takes the label's place,
   * the button keeps its colour and size, and a second press does nothing (§15.4, "waiting on the
   * database").
   */
  pending?: boolean;
  disabled?: boolean;
  title?: string;
  href?: string;
  target?: string;
  rel?: string;
  className?: string;
  style?: CSSProperties;
  /** `data-*` attributes pass through to the element (tests and hooks find buttons by them). */
  [key: `data-${string}`]: string | undefined;
}) {
  const cls = cx(TONE[tone], sm && "sm", armed && "armed", pending && "is-pending", className);
  if (href) {
    return (
      <a
        className={cls}
        href={disabled ? undefined : href}
        target={target}
        rel={rel}
        title={title}
        style={style}
        onClick={onClick}
        aria-disabled={disabled || undefined}
        {...data}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={pending ? undefined : onClick}
      disabled={disabled}
      aria-busy={pending || undefined}
      title={title}
      style={style}
      {...data}
    >
      {children}
    </button>
  );
}

/**
 * The quiet text action — `.back` (L380): "Ungroup", "Settings ›", "Reset".
 * `blue` or `warn` colour it (`cy` and `warm` are the old names).
 */
export function LinkBtn({
  children,
  onClick,
  tone,
  disabled,
  title,
  href,
  target,
  rel,
  className,
  style,
  guide,
  ...data
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "blue" | "warn" | "cy" | "warm";
  disabled?: boolean;
  title?: string;
  href?: string;
  target?: string;
  rel?: string;
  className?: string;
  style?: CSSProperties;
  /** Guide mode's sentence for it (components/admin/guide): what pressing it does. */
  guide?: string;
  /** `data-*` attributes pass through to the element (as on Btn). */
  [key: `data-${string}`]: string | undefined;
}) {
  const cls = cx(
    "back flat",
    (tone === "cy" || tone === "blue") && "blue",
    (tone === "warm" || tone === "warn") && "warn",
    className,
  );
  if (href) {
    return (
      <a className={cls} href={href} target={target} rel={rel} title={title} style={style} onClick={onClick} data-guide={guide} {...data}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title} style={style} data-guide={guide} {...data}>
      {children}
    </button>
  );
}

/** A switch row — `.swrow` with `.sw` (L92–97). `care` turns the switch orange when on. */
export function Toggle({
  on,
  onClick,
  label,
  note,
  disabled,
  care,
  caps,
  pending,
  title,
  guide,
  ...data
}: {
  on: boolean;
  onClick: () => void;
  label: ReactNode;
  note?: ReactNode;
  disabled?: boolean;
  care?: boolean;
  /** The small tracked label of a compact toggle ("PUBLIC PAGE"). */
  caps?: boolean;
  /** The switch already shows the new state; the database is answering (a soft pulse). */
  pending?: boolean;
  title?: string;
  /** Guide mode's sentence for it (components/admin/guide): what switching it does. */
  guide?: string;
  /** `data-*` attributes pass through to the element (as on Btn). */
  [key: `data-${string}`]: string | undefined;
}) {
  return (
    <button
      type="button"
      role="switch"
      className={cx("swrow", caps && "caps", pending && "is-pending")}
      onClick={pending ? undefined : onClick}
      disabled={disabled}
      aria-checked={on}
      aria-busy={pending || undefined}
      title={title}
      data-guide={guide}
      {...data}
    >
      <span>
        <b>{label}</b>
        {note ? <span>{note}</span> : null}
      </span>
      <span className={cx("sw", !on && "off", on && care && "warn")} aria-hidden>
        <u />
      </span>
    </button>
  );
}

/** A state pill — `.pill` with a dot: live (danger tint, pulsing), held (orange), done (success), info (blue). */
export function StatePill({
  tone,
  children,
  title,
}: {
  tone?: "live" | "held" | "done" | "info" | "";
  children: ReactNode;
  title?: string;
}) {
  const t = tone === "live" ? "onair" : tone === "held" ? "held" : tone === "done" ? "ok" : tone === "info" ? "info" : undefined;
  return (
    <span className={cx("pill", t)} title={title}>
      <i />
      {children}
    </span>
  );
}

/**
 * A value that changes rolls in, never snaps (docs/DESIGN.md §15.4): a count, a round's number, a
 * word. The old one lifts out as the new one rises in. Not for a ticking clock.
 */
export function Roll({ value }: { value: string | number }) {
  return (
    <span className="roll">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={String(value)}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={spring.snappy}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ══ WAITING ON THE DATABASE (docs/DESIGN.md §15.4) ═══════════════════════
 * Belal, 2026-09-30: "things wait for the database to respond and then BAM … we should have a
 * smoother experience". One small set of pieces, used everywhere, so the feel can be changed in
 * one place later (the timings are lib/motion.ts and the --dur-* tokens):
 *
 *   usePending   a press that talks to the server: `pending` while it does, no double press
 *   useHeld      the new value shows AT ONCE and is held until the server's value agrees
 *   usePendingKeys, useHeldKeys   the same two for the rows of a list: one per row, so a press on
 *                one card never locks or hides the next
 *   Btn pending, Toggle pending   the cue on the control itself; nothing else moves
 *   Reveal       what arrives from the server rises in, never pops
 *   Swap         one state crossfades to the next (a word, a block), never snaps
 *   Skeleton     a soft placeholder where something is being read
 */

/**
 * A press that talks to the server. `run(fn)` sets `pending` until `fn` settles and ignores a
 * second press meanwhile; it resolves with fn's result (undefined when it was ignored).
 */
export function usePending(): [boolean, <T>(fn: () => Promise<T>) => Promise<T | undefined>] {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const alive = useRef(true);
  // Set on every mount, not only at first: StrictMode's rehearsal unmount must not leave it false,
  // or the cue would never let go.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try {
      return await fn();
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  }, []);
  return [pending, run];
}

/**
 * usePending for a LIST: one lock per row, so a press on one card never stops the next card's.
 * `run(key, fn, what)` ignores a second press on the same key while its first is in flight;
 * `pendingOf(key)` says which of the row's buttons was pressed (`what`), for its cue.
 */
export function usePendingKeys(): [(key: string) => string | null, <T>(key: string, fn: () => Promise<T>, what?: string) => Promise<T | undefined>] {
  const [map, setMap] = useState<Record<string, string>>({});
  const live = useRef(new Set<string>());
  const alive = useRef(true);
  // Set on every mount, not only at first: StrictMode's rehearsal unmount must not leave it false,
  // or the cue would never let go.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, what = key): Promise<T | undefined> => {
    if (live.current.has(key)) return undefined;
    live.current.add(key);
    setMap((m) => ({ ...m, [key]: what }));
    try {
      return await fn();
    } finally {
      live.current.delete(key);
      if (alive.current)
        setMap((m) => {
          const next = { ...m };
          delete next[key];
          return next;
        });
    }
  }, []);
  const pendingOf = useCallback((key: string) => map[key] ?? null, [map]);
  return [pendingOf, run];
}

/** Equal for a held value: the same primitive, or lists and maps with the same contents. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * THE NEW VALUE, SHOWN AT ONCE. `hold(v)` shows `v` right away and keeps showing it until the
 * server's value (`server`) equals it, or `ms` passes, or `release()` is called (a failed save).
 * `held` is true while it waits — the cue for `pending`.
 */
export function useHeld<T>(server: T, ms = 8000): { shown: T; held: boolean; hold: (v: T) => void; release: () => void } {
  const [held, setHeld] = useState<{ v: T } | null>(null);
  useEffect(() => {
    if (held && same(held.v, server)) setHeld(null);
  }, [server, held]);
  useEffect(() => {
    if (!held) return;
    const t = setTimeout(() => setHeld(null), ms);
    return () => clearTimeout(t);
  }, [held, ms]);
  const hold = useCallback((v: T) => setHeld({ v }), []);
  const release = useCallback(() => setHeld(null), []);
  return { shown: held ? held.v : server, held: !!held, hold, release };
}

/**
 * useHeld for the ROWS of a list: `hold(key, v)` shows `v` for that row at once and keeps it until
 * the server's value for that row (`server[key]`; undefined once the row has left the list) equals
 * it, or `ms` passes, or `release(key)` (a failed write). Every other row follows the server the
 * whole time, so a row that arrives meanwhile is never hidden behind a held copy of the list.
 */
export function useHeldKeys<T>(server: Record<string, T>, ms = 8000) {
  const [held, setHeld] = useState<Record<string, { v: T | undefined; at: number }>>({});
  useEffect(() => {
    setHeld((h) => {
      let changed = false;
      const next = { ...h };
      for (const k of Object.keys(h)) {
        if (same(h[k].v, server[k])) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : h;
    });
  }, [server]);
  useEffect(() => {
    const keys = Object.keys(held);
    if (!keys.length) return;
    const due = Math.min(...keys.map((k) => held[k].at)) + ms - Date.now();
    const t = setTimeout(
      () =>
        setHeld((h) => {
          const now = Date.now();
          const next = { ...h };
          for (const k of Object.keys(h)) if (now - h[k].at >= ms) delete next[k];
          return next;
        }),
      Math.max(0, due),
    );
    return () => clearTimeout(t);
  }, [held, ms]);
  const hold = useCallback((k: string, v: T | undefined) => setHeld((h) => ({ ...h, [k]: { v, at: Date.now() } })), []);
  const release = useCallback(
    (k: string) =>
      setHeld((h) => {
        if (!(k in h)) return h;
        const next = { ...h };
        delete next[k];
        return next;
      }),
    [],
  );
  const shownOf = (k: string): T | undefined => (k in held ? held[k].v : server[k]);
  const isHeld = (k: string) => k in held;
  return { shownOf, isHeld, hold, release };
}

/** What arrives from the server rises in (6px, the smooth spring), a beat after the one before it. */
export function Reveal({
  children,
  index = 0,
  className,
  style,
}: {
  children: ReactNode;
  /** Its place in a list: each one a beat after the last (capped). */
  index?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.smooth, delay: Math.min(index, 8) * 0.045 }}
    >
      {children}
    </motion.div>
  );
}

/** One state crossfades to the next: keyed by `k`, the old one lifts out as the new one rises in. */
export function Swap({ k, children, className }: { k: string; children: ReactNode; className?: string }) {
  return (
    <span className={cx("swap", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={k}
          style={{ display: "inline-flex" }}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={spring.snappy}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A soft placeholder where something is being read: it breathes, then what arrives replaces it. */
export function Skeleton({
  height = 16,
  width = "100%",
  radius,
  className,
  onBlue,
}: {
  height?: number | string;
  width?: number | string;
  radius?: number;
  className?: string;
  /** On the blue band (a Hero): the same breathing shine, in white. */
  onBlue?: boolean;
}) {
  return <span className={cx("skel", className)} style={{ height, width, borderRadius: radius, ...(onBlue ? ON_BLUE : null) }} aria-hidden />;
}
const ON_BLUE: CSSProperties = {
  backgroundImage: "linear-gradient(100deg, rgb(255 255 255 / 0.12) 20%, rgb(255 255 255 / 0.26) 40%, rgb(255 255 255 / 0.12) 60%)",
};

/** A stat tile — `.st` (L103–105). `flat` sits it on the sunken fill inside another card. */
export function Stat({
  label,
  value,
  sub,
  flat,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  flat?: boolean;
}) {
  return (
    <div className={cx("st", flat && "flat")}>
      <span>{label}</span>
      <b>{value}</b>
      {sub ? <div className="s">{sub}</div> : null}
    </div>
  );
}

/**
 * Tabs — `.tabs` (L377–379), with an optional count in each. The white thumb
 * is one shape that slides to the chosen tab on the snappy spring (§15.4);
 * `useId` keeps two sets of tabs on a page from sharing it.
 */
export function Tabs<K extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: K;
  onChange: (key: K) => void;
  items: { key: K; label: string; count?: string | number; title?: string; guide?: string }[];
  className?: string;
}) {
  const thumb = useId();
  return (
    <div className={cx("tabs slide", className)} role="tablist">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="tab"
          aria-selected={it.key === value}
          className={cx(it.key === value && "on")}
          onClick={() => onChange(it.key)}
          title={it.title}
          data-guide={it.guide}
        >
          {it.key === value ? (
            <motion.span layoutId={`tab-${thumb}`} className="thumb" transition={spring.snappy} aria-hidden />
          ) : null}
          <span className="tl">
            {it.label}
            {it.count !== undefined && it.count !== "" ? <em>{it.count}</em> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** A search box — a `.fld`. */
export function SearchBox({
  value,
  onChange,
  placeholder,
  sm,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  sm?: boolean;
  style?: CSSProperties;
}) {
  return (
    <input
      type="search"
      className={cx("fld", sm && "sm")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={style}
    />
  );
}

/** A labelled control — `.mini` over the field. `full` spans both columns of a `.g2`. */
export function Field({
  label,
  children,
  full,
  style,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div style={full ? { gridColumn: "1 / -1", ...style } : style}>
      <label className="mini">{label}</label>
      {children}
    </div>
  );
}

/** The live dot — `.livebtn .d` (L63). `warm` is orange, `off` a still grey. */
export function Ping({ tone }: { tone?: "warm" | "off" }) {
  return <span className={cx("ping", tone)} aria-hidden />;
}

/**
 * A panel over the page from the inline-end — the moment catalogue, a person.
 * Escape and the scrim close it; it takes focus and hands it back. `bare`
 * hands the padding to its content (PersonView brings its own).
 */
export function Drawer({
  open,
  onClose,
  wide,
  bare,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  wide?: boolean;
  bare?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <UiDrawer open={open} onClose={onClose} wide={wide} bare={bare} label={label}>
      {children}
    </UiDrawer>
  );
}

/** A tick list — `.anrow` rows with blue ticks (L440–447): the recap pages, the registration fields. */
export function Checks({
  items,
  onToggle,
  grid,
}: {
  items: { key: string; label: string; note?: string; on: boolean; disabled?: boolean }[];
  onToggle: (key: string) => void;
  grid?: boolean;
}) {
  return (
    <div className={cx("checks", grid && "grid")}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="checkbox"
          className={cx("anrow blue", it.on && "on")}
          onClick={() => onToggle(it.key)}
          disabled={it.disabled}
          aria-checked={it.on}
        >
          <span className="tick">{it.on ? "✓" : ""}</span>
          <span className="an">
            <b>{it.label}</b>
            {it.note ? <span>{it.note}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Key-value rows — `.lrowk` (L358–369): a muted key, a bold value. */
export function KvRows({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <div>
      {rows.map((r, i) => (
        <div className="lrowk" key={`${r.label}-${i}`}>
          <span className="kk">{r.label}</span>
          <span className="vv">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Names as chips — `.anch` (L485–486). */
export function Names({ names, empty = "Nobody yet" }: { names: string[]; empty?: string }) {
  if (!names.length) return <div className="text-hint text-muted">{empty}</div>;
  return (
    <div className="anch">
      {names.map((n, i) => (
        <span key={`${n}-${i}`}>{n}</span>
      ))}
    </div>
  );
}

/** A person's face — a round photo, or their initials when there is none (`.av`, 26px by default). */
export function Avatar({
  person,
  tone,
  size,
}: {
  person: AdminPerson;
  tone?: "live" | "done";
  size?: number;
}) {
  /* InCircle's avatar is a little orb with the initials in its grey-blue (app/incircle.css `.av`). */
  const style: CSSProperties = size ? { width: size, height: size, fontSize: Math.round(size * 0.32) } : {};
  return (
    <span className={cx("av", tone === "live" ? "onair" : tone)} style={style}>
      <FaceImg src={person.photo} initials={initials(person.name)} {...personFaceStyle(person)} />
    </span>
  );
}

/** A card that folds to its header — `.allset` (L339–345). */
export function Collapse({
  title,
  meta,
  open,
  onToggle,
  children,
  className,
}: {
  title: string;
  meta?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("allset", open && "open", className)}>
      <button type="button" className="ah" onClick={onToggle} aria-expanded={open}>
        <span style={{ minWidth: 0 }}>
          <b>{title}</b>
          {meta ? <span>{meta}</span> : null}
        </span>
        <span className="cv" aria-hidden>
          ▼
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="fold" {...fold} transition={spring.smooth} style={{ overflow: "hidden" }}>
            <div style={{ padding: "0 18px 16px" }}>{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/**
 * A dialog — the mockup's `#ask` box (`.ask .box`): a kicker, a title, then
 * whatever the caller asks (a form, a yes/no). `care` gives the kicker the
 * danger colour. Escape and the scrim close it. `bare` hands the whole box to
 * the children (the kicker is then only its accessible name) — for a dialog
 * with its own header, like Create an event. It leaves on the sheets' spring,
 * showing what it last showed (components/ui/Overlay.tsx `OverlayLayer`).
 */
export function Sheet({
  open,
  onClose,
  kicker,
  title,
  care,
  bare,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  kicker: string;
  title: string;
  care?: boolean;
  bare?: boolean;
  className?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open ? (
        <OverlayLayer key="ask" leave="fade" className="ask" onClick={onClose}>
          <OverlayLayer
            leave="drop"
            still
            className={cx("box", className)}
            role="dialog"
            aria-modal="true"
            aria-label={bare ? title || kicker : kicker}
            onClick={(e) => e.stopPropagation()}
          >
            {bare ? (
              children
            ) : (
              <>
                <div className="lb" style={care ? { color: "var(--color-danger)" } : undefined}>
                  {kicker}
                </div>
                <b>{title}</b>
                <div style={{ marginTop: 12 }}>{children}</div>
              </>
            )}
          </OverlayLayer>
        </OverlayLayer>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * A hero band — `.hero`: the brand gradient, white words (§15.2). The blue band
 * always means THE ACTIVE EVENT: on Manage events, on Settings and on Results. A
 * kicker, a title, one line, then whatever the caller puts under it (metrics,
 * chips, a button).
 */
export function Hero({
  kicker,
  title,
  sub,
  children,
  className,
  style,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={cx("hero", className)} style={style}>
      {kicker ? <div className="k">{kicker}</div> : null}
      <h2>{title}</h2>
      {sub ? <div className="s">{sub}</div> : null}
      {children}
    </section>
  );
}

/**
 * THE ACTIVE EVENT, said at the top of a page that shows its data (Belal, 2026-09-30: "show in
 * the results page … what is the current active event, so we don't get confused"). The slim
 * blue band — `.hero.evband`: the name with an "Active event" pill beside it (never above it),
 * its date when it has one, and one way out (to Manage events, where another event can be made
 * active).
 */
export function ActiveEventBand({ name, when, action }: { name: ReactNode; when?: ReactNode; action?: ReactNode }) {
  return (
    <section className="hero solo evband" aria-label="The active event">
      <div className="evband-tt">
        <h2 className="hero-t">
          <span className="t">{name}</span>
          <span className="pill active" title="The phones, the hall and this control room follow this event">
            <i />
            Active event
          </span>
        </h2>
        {when ? <div className="s">{when}</div> : null}
      </div>
      {action}
    </section>
  );
}

/**
 * A settings group — `.setgroup`: a small tracked label (and an optional line
 * at its end) over one white card of rows (§15.6). `id` makes it a place a
 * link can land on.
 */
export function SettingsGroup({
  label,
  aside,
  id,
  children,
}: {
  label: string;
  aside?: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className="setgroup" id={id} aria-label={label}>
      <div className="gh">
        <b>{label}</b>
        {aside ? <span>{aside}</span> : null}
      </div>
      <div className="setcard">{children}</div>
    </section>
  );
}

/**
 * One row of a settings group — `.setrow`: an optional icon tile, a title (with
 * chips beside it), one line under it, and the control at the inline-end.
 */
export function SettingsRow({
  icon,
  soft,
  title,
  line,
  children,
  ...data
}: {
  /** A glyph in the blue tile at the start. */
  icon?: ReactNode;
  /** The pale tile instead of the gradient one. */
  soft?: boolean;
  title: ReactNode;
  line?: ReactNode;
  children?: ReactNode;
  [key: `data-${string}`]: string | undefined;
}) {
  return (
    <div className="setrow" {...data}>
      {icon ? (
        <span className={cx("ic", soft && "soft")} aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="tt">
        <b>{title}</b>
        {line ? <span>{line}</span> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * A calm save state — `.savestate`: a dot and a word that crossfade between
 * "All changes saved", "Unsaved changes" and "Saving…" (§15.5). It is a
 * status, so a screen reader hears it change.
 */
export function SaveState({ state, labels }: { state: "saved" | "dirty" | "saving"; labels?: Partial<Record<"saved" | "dirty" | "saving", string>> }) {
  const words = { saved: "All changes saved", dirty: "Unsaved changes", saving: "Saving…", ...labels };
  return (
    <span className="savestate" data-state={state} role="status" aria-live="polite">
      <i aria-hidden />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          transition={{ duration: 0.16 }}
        >
          {words[state]}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
