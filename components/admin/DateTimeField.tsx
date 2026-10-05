"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";

import { cx } from "@/components/admin/ui";
import { fold, spring } from "@/lib/motion";

/**
 * A DATE AND A TIME, PICKED IN THE CONTROL ROOM'S OWN LOOK (Belal, 2026-09-30: "a time picker with
 * our colors … very simplified and nice … much better than mm/dd/yyyy").
 *
 * - Closed, it reads the date the way the rest of the control room does ("Thu 12 Nov 2026 · 09:30"),
 *   or a quiet line asking for one.
 * - A click unfolds a month in place, under the field — no floating layer for a dialog to clip —
 *   and the hour and minute under it. A day is one click; the time starts at 09:00. The months
 *   slide as you page through them, and every month is six weeks tall, so nothing jumps.
 * - Clear empties it; Done (or Escape) folds it away.
 *
 * The value is a wall time in the EVENT's zone, "2026-11-12T09:30", or "" for none
 * (lib/admin/eventClock.ts `toEventInput` / `fromEventInput` convert it to and from the stored
 * instant), so the server and the browser always agree on what it shows.
 */

type Parts = { y: number; m: number; d: number; hh: number; mi: number };

const pad = (n: number) => String(n).padStart(2, "0");
function parse(v: string): Parts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v);
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3], hh: +m[4], mi: +m[5] } : null;
}
const toValue = (p: Parts) => `${p.y}-${pad(p.m + 1)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mi)}`;

/* Formatted from the parts themselves (a UTC date built from them), so no zone can move the day. */
const DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const LONG = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const MONTH = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const WEEK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/* The months slide the way you page, a little; the word above them rises in with them. */
const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 18 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -18 }),
};
const lift = {
  enter: (dir: number) => ({ opacity: 0, y: dir >= 0 ? 6 : -6 }),
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
};

/** Six weeks from the Sunday on or before the 1st: the same height for every month. */
function monthGrid(y: number, m: number): { y: number; m: number; d: number }[] {
  const lead = utc(y, m, 1).getUTCDay();
  return Array.from({ length: 42 }, (_, i) => {
    const at = utc(y, m, 1 - lead + i);
    return { y: at.getUTCFullYear(), m: at.getUTCMonth(), d: at.getUTCDate() };
  });
}

export function DateTimeField({
  value,
  onChange,
  placeholder = "Pick a date and time",
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const sel = parse(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ y: number; m: number; dir: number }>(() => {
    const now = new Date();
    return { y: sel?.y ?? now.getFullYear(), m: sel?.m ?? now.getMonth(), dir: 0 };
  });
  const days = useMemo(() => monthGrid(view.y, view.m), [view.y, view.m]);
  const now = new Date();
  const today = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };

  const label = sel ? `${DAY.format(utc(sel.y, sel.m, sel.d))} · ${pad(sel.hh)}:${pad(sel.mi)}` : "";
  const page = (step: number) =>
    setView((v) => {
      const at = new Date(Date.UTC(v.y, v.m + step, 1));
      return { y: at.getUTCFullYear(), m: at.getUTCMonth(), dir: step };
    });
  const toggle = () => {
    if (disabled) return;
    if (!open && sel) setView({ y: sel.y, m: sel.m, dir: 0 });
    setOpen((o) => !o);
  };
  const pick = (day: { y: number; m: number; d: number }) => {
    onChange(toValue({ ...day, hh: sel?.hh ?? 9, mi: sel?.mi ?? 0 }));
    if (day.m !== view.m || day.y !== view.y) setView({ y: day.y, m: day.m, dir: day.y * 12 + day.m > view.y * 12 + view.m ? 1 : -1 });
  };
  const setTime = (hh: number, mi: number) => {
    if (sel) onChange(toValue({ ...sel, hh, mi }));
  };
  const minutes = sel && !MINUTES.includes(sel.mi) ? [...MINUTES, sel.mi].sort((a, b) => a - b) : MINUTES;
  /* Escape folds the month, and stops there: a dialog around it must not close too. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className={cx("dtf", open && "open")} onKeyDown={onKeyDown}>
      <div className="dtf-field">
        <button
          type="button"
          className="dtf-btn"
          onClick={toggle}
          disabled={disabled}
          aria-expanded={open}
          data-action="pick-date"
          data-guide={open ? "Folds the month away." : "Opens a month to pick the day, then the time."}
        >
          <svg className="dtf-ic" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
            <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2.25" />
            <path d="M2.5 6.5h11M5.5 1.75v3M10.5 1.75v3" />
          </svg>
          <span className={cx("dtf-v", !sel && "is-empty")}>{label || placeholder}</span>
        </button>
        {sel && !disabled ? (
          <button type="button" className="dtf-clear" onClick={() => onChange("")} aria-label="Clear the date" title="Clear the date">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="m3.5 3.5 5 5M8.5 3.5l-5 5" />
            </svg>
          </button>
        ) : null}
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="cal" {...fold} transition={spring.smooth} style={{ overflow: "hidden" }}>
            <div className="dtf-pop">
              <div className="dtf-head">
                <button type="button" className="dtf-nav" onClick={() => page(-1)} aria-label="The month before" data-guide="Shows the month before.">
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M7.5 3 4.5 6l3 3" />
                  </svg>
                </button>
                <div className="dtf-month" aria-live="polite">
                  <AnimatePresence mode="popLayout" initial={false} custom={view.dir}>
                    <motion.span
                      key={`${view.y}-${view.m}`}
                      custom={view.dir}
                      variants={lift}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={spring.snappy}
                    >
                      {MONTH.format(utc(view.y, view.m, 1))}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <button type="button" className="dtf-nav" onClick={() => page(1)} aria-label="The month after" data-guide="Shows the month after.">
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m4.5 3 3 3-3 3" />
                  </svg>
                </button>
              </div>

              <div className="dtf-week" aria-hidden>
                {WEEK.map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="dtf-grid-wrap">
                <AnimatePresence mode="popLayout" initial={false} custom={view.dir}>
                  <motion.div
                    key={`${view.y}-${view.m}`}
                    className="dtf-grid"
                    custom={view.dir}
                    variants={slide}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={spring.smooth}
                  >
                    {days.map((day) => {
                      const inMonth = day.m === view.m;
                      const isSel = !!sel && sel.y === day.y && sel.m === day.m && sel.d === day.d;
                      const isToday = today.y === day.y && today.m === day.m && today.d === day.d;
                      return (
                        <button
                          type="button"
                          key={`${day.y}-${day.m}-${day.d}`}
                          className={cx("dtf-day", !inMonth && "out", isSel && "on", isToday && "today")}
                          onClick={() => pick(day)}
                          aria-pressed={isSel}
                          aria-label={LONG.format(utc(day.y, day.m, day.d))}
                        >
                          {day.d}
                        </button>
                      );
                    })}
                  </motion.div>
                </AnimatePresence>
              </div>

              <div className={cx("dtf-time", !sel && "off")} title={sel ? undefined : "Pick a day first"}>
                <span className="mini">TIME</span>
                <span className="dtf-sel">
                  <select value={sel?.hh ?? 9} disabled={!sel} onChange={(e) => setTime(+e.target.value, sel?.mi ?? 0)} aria-label="Hour">
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {pad(h)}
                      </option>
                    ))}
                  </select>
                </span>
                <b aria-hidden>:</b>
                <span className="dtf-sel">
                  <select value={sel?.mi ?? 0} disabled={!sel} onChange={(e) => setTime(sel?.hh ?? 9, +e.target.value)} aria-label="Minute">
                    {minutes.map((mi) => (
                      <option key={mi} value={mi}>
                        {pad(mi)}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="dtf-acts">
                  {sel ? (
                    <button type="button" className="dtf-quiet" onClick={() => onChange("")}>
                      Clear
                    </button>
                  ) : null}
                  <button type="button" className="dtf-done" onClick={() => setOpen(false)}>
                    Done
                  </button>
                </span>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
