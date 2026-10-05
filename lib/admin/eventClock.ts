import { EVENT_TZ } from "@/lib/env";

/**
 * Every clock the control room prints is the EVENT's, not the server's
 * (Part 15): a run that ended at 21:40 in Cairo reads 21:40 whether the panel
 * is open in Cairo or on a Vercel box in Virginia. Shared by Results' run cards
 * and the recap chooser, so two screens cannot format one evening two ways.
 */
const fmt = (opts: Intl.DateTimeFormatOptions) => {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: EVENT_TZ, ...opts });
  } catch {
    return new Intl.DateTimeFormat("en-GB", opts);
  }
};

const DAY = fmt({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
const CLOCK = fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "Fri 21 Aug 2026", or a dash for nothing. */
export function eventDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : DAY.format(d);
}

/** "21:40", or a dash for nothing. */
export function eventClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : CLOCK.format(d);
}

/** "1h 12m" — how long an evening lasted; blank when we never saw it start. */
export function eventDuration(from: string | null, to: string | null): string {
  if (!from || !to) return "";
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${String(mins % 60).padStart(2, "0")}m` : `${mins}m`;
}

/*
 * THE EVENT'S DATE, AS THE HOST PICKS IT — "2026-11-12T09:30", a wall time in the event's zone
 * (components/admin/DateTimeField.tsx). The stored value is an instant (events.starts_at); these
 * two convert between them in EVENT_TZ, never the browser's or the server's zone, so the picker
 * shows 09:30 in Cairo whether the panel is rendered on a server in Virginia or opened in London.
 */
const PARTS = (() => {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: EVENT_TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return new Intl.DateTimeFormat("en-US", { hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
})();
function wall(ms: number): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const p = PARTS.formatToParts(new Date(ms));
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour") % 24, mi: n("minute"), s: n("second") };
}
const pad2 = (n: number) => String(n).padStart(2, "0");

/** An instant as the event's wall time for the picker: "2026-11-12T09:30", or "" for none. */
export function toEventInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const w = wall(ms);
  return `${w.y}-${pad2(w.mo)}-${pad2(w.d)}T${pad2(w.h)}:${pad2(w.mi)}`;
}

/** The event's wall time back to an instant (ISO), or null for "" or anything unreadable. */
export function fromEventInput(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = (ms: number) => {
    const w = wall(ms);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - ms;
  };
  let ms = asUtc - offset(asUtc);
  // Across a daylight-saving change the offset at the answer can differ from the first guess's.
  const again = asUtc - offset(ms);
  if (again !== ms) ms = again;
  return new Date(ms).toISOString();
}
