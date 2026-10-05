/**
 * HOW A PAGE'S COPY OF THE ROOM STAYS IN STEP WITH THE SERVER — the rules the live hooks keep
 * (lib/admin/useAdminEventState.ts, lib/useStages.ts) and the line the control room's presses
 * wait in (components/admin/AdminRoot.tsx `post`). No React and no Supabase in here, so they are
 * tested on their own: roomSync.test.ts.
 */

/**
 * The roads a row of `event_state` arrives by:
 *
 *   push     the realtime echo of a write
 *   answer   a POST's own answer: the row the write returned
 *   render   a fresh server render (router.refresh after a mutation)
 *   read     a refetch: the 15 s poll, SUBSCRIBED, a tab or the network coming back
 */
export type Arrival = "push" | "answer" | "render" | "read";

/**
 * THE SEQ GUARD. Every write to the row bumps `seq` (supabase/01_schema.sql), so a row says how
 * new it is, and a page keeps the newest it has seen:
 *
 *  - a push, an answer or a render is taken only when NEWER: the same write reaching the page by
 *    two roads (its answer, then its echo) changes nothing the second time;
 *  - a read is taken when NOT OLDER. A poll that read the row before a press and lands after the
 *    press's echo is older — taking it flipped the control back for up to 15 s. The same seq is
 *    taken, so a read can still repair a row that arrived incomplete.
 *
 * Compared as numbers: the seeded row starts at seq 0, and that value is real.
 */
export function takesRow(lastSeq: number, row: { seq?: number | null } | null | undefined, via: Arrival): boolean {
  if (!row || typeof row.seq !== "number") return false;
  return via === "read" ? row.seq >= lastSeq : row.seq > lastSeq;
}

/**
 * A ROW AS REALTIME DELIVERS IT, MADE WHOLE. Postgres keeps a large value out of line (TOAST: a
 * jsonb past about 2 KB — `event_state.settings` once the agenda and the waiting screens are
 * written, a big moment's `config`), and an UPDATE that leaves such a value unchanged does not
 * carry it: Supabase Realtime's row simply has no such key (measured on the local stack: a room
 * move arrives without `settings`, a settings write with it). Replacing the page's row with it
 * dropped the agenda, the waiting screens' setup and every setting from the phones and the hall
 * until they read the row again. The value did not change, so the row the page already has
 * supplies it; a key the payload carries (null included) always wins.
 */
export function wholeRow<T extends object>(prev: T | null | undefined, row: T): T {
  return prev ? { ...prev, ...row } : row;
}

/** A change to one `stages` row, as realtime reports it (a DELETE carries only the key). */
export type StageChange<T> = { type: "UPDATE"; row: T } | { type: "DELETE"; id: string | null | undefined };

/**
 * THE RUN OF SHOW, PATCHED IN PLACE. An UPDATE replaces its row by id where it stands — the order
 * is untouched, so nothing keyed on position moves — made whole from the row it replaces (a big
 * config left unchanged is not in the payload: `wholeRow`); a DELETE drops its row. A row the list
 * does not hold is left alone either way (another event's, or one the next refetch brings), and
 * the same array comes back, so nothing re-renders for it.
 */
export function patchStages<T extends { id: string }>(prev: T[], change: StageChange<T>): T[] {
  const id = change.type === "UPDATE" ? change.row.id : change.id;
  const at = id ? prev.findIndex((s) => s.id === id) : -1;
  if (at === -1) return prev;
  const next = [...prev];
  if (change.type === "UPDATE") next[at] = wholeRow(prev[at], change.row);
  else next.splice(at, 1);
  return next;
}

/**
 * ONE AFTER THE OTHER — the line every press in the control room waits in. `turn(task)` starts
 * `task` once every task before it has settled and resolves with its result; a task that fails
 * never holds up the line.
 *
 * The route re-reads the row and reduces against it, so two presses in flight would both read the
 * same state and the second would be lost; in line, each is reduced against the state the one
 * before it produced. And a press BUILT inside its task, from the newest row, composes with the
 * press before it: two quick ticks of a list both land, where two lists built from the same
 * render would each drop the other's tick.
 */
export function oneAtATime(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  };
}
