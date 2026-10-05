"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FlowAction } from "@/lib/admin/flow";
import { takesRow, wholeRow, type Arrival } from "@/lib/roomSync";
import type { EventStateRow } from "@/lib/supabase/types";

/**
 * The host's view of `event_state` — the registration page's settings and the
 * list's `roster_seq`.
 *
 * CIB's hook of the same name, with one difference: CIB hears the row over
 * Supabase Realtime (with a 15 s poll as the backstop), because fifty phones
 * and a wall move with it. Registration has none of those, and the browser
 * never talks to Supabase here, so the backstop is the whole mechanism: the
 * row is re-read through /api/admin/state every 15 s while the tab is visible,
 * and the moment it is looked at again. Everything else is CIB's:
 *
 *   - A PRESS SHOWS WHEN THE ROUTE ANSWERS. /api/admin/state answers with the
 *     row its write returned; `apply` takes it through the seq guard, so the
 *     control moves the moment the route answers.
 *   - `latest` is the newest row taken by any road, for a press that rewrites
 *     a whole value and must build on the newest.
 *   - Every row goes through one guard (lib/roomSync.ts `takesRow`): an answer
 *     or a fresh server render is taken only when newer; a read when not older,
 *     so a poll that read before a press and lands after it cannot flip the
 *     control back.
 */
const POLL_MS = 15000;

export type AdminEventState = {
  /** The newest row this page has taken. */
  state: EventStateRow;
  /** A row the page was handed (a POST's answer), taken through the seq guard when newer. */
  apply: (row: EventStateRow | null | undefined) => void;
  /** The newest row, read at the moment of use (not the one this render saw). */
  latest: () => EventStateRow;
};

/** What POST /api/admin/state answers: the row it wrote or found (`state`). */
export type RoomAnswer = { state?: EventStateRow; changed?: boolean };

/**
 * A press: an action, or one built from the newest row when its turn in the line comes (AdminRoot
 * `post`), so two quick presses that each rewrite a whole value both land.
 */
export type Press<A = FlowAction> = A | ((latest: EventStateRow) => A);

/**
 * AdminRoot's `send`: queued behind every other press, it resolves once the answer is on screen,
 * with the answer, or with null when it failed (the error line says why). It never rejects.
 */
export type Send = (press: Press) => Promise<RoomAnswer | null>;

export function useAdminEventState(eventId: string, initial: EventStateRow): AdminEventState {
  const [state, setState] = useState<EventStateRow>(initial);
  const lastSeq = useRef<number>(initial?.seq ?? -1);
  const newest = useRef<EventStateRow>(initial);

  /** Every row, whichever road it came by, through the one guard. */
  const take = useCallback((row: EventStateRow | null | undefined, via: Arrival) => {
    if (!row || !takesRow(lastSeq.current, row, via)) return;
    const whole = wholeRow(newest.current, row);
    lastSeq.current = whole.seq;
    newest.current = whole;
    setState(whole);
  }, []);

  const apply = useCallback((row: EventStateRow | null | undefined) => take(row, "answer"), [take]);
  const latest = useCallback(() => newest.current, []);

  // A fresh server render (router.refresh after a mutation) brings the row as it read it.
  useEffect(() => {
    take(initial, "render");
  }, [initial, take]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    const refetch = async () => {
      try {
        const res = await fetch("/api/admin/state", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as { state?: EventStateRow };
        if (body.state && !cancelled) take(body.state, "read");
      } catch {
        /* offline for a moment: the next poll, or the tab coming back, catches up */
      }
    };

    // A hidden tab polls for nobody; the visibilitychange listener refetches the moment it is
    // looked at again.
    const poll = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refetch();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refetch);

    return () => {
      cancelled = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refetch);
    };
  }, [eventId, take]);

  return { state, apply, latest };
}
