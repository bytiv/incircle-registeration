"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { Layout } from "@/components/admin/AdminShell";
import { ConfirmSheet } from "@/components/admin/ConfirmSheet";
import { AddDrawer } from "@/components/admin/people/AddDrawer";
import { useLeaving } from "@/components/admin/people/bits";
import type { NewPerson } from "@/components/admin/people/types";
import { Avatar, Btn, cx, LinkBtn, StatePill, Swap, useHeldKeys, usePending, usePendingKeys } from "@/components/admin/ui";
import { eventDay } from "@/lib/admin/eventClock";
import type { AdminPerson, AdminSnapshot } from "@/lib/admin/model";
import { personImpactLines, ZERO_PERSON_IMPACT, type PersonAsk, type PersonImpact } from "@/lib/admin/runs";
import { fold, spring } from "@/lib/motion";
import { holdsSeat, registrationCapacity, type RegStatus } from "@/lib/registration";
import type { EventStateRow } from "@/lib/supabase/types";

export type PeopleViewProps = {
  layout: Layout;
  snapshot: AdminSnapshot;
  state: EventStateRow;
  query: string;
  onQuery: (v: string) => void;
  /** all · signed · added · removed */
  filter: string;
  onFilter: (v: string) => void;
  sort: string;
  dir: number;
  onSort: (col: string) => void;
  /** The drawer on the right — with the editor already open when `edit` is true. */
  openPerson: (id: string, edit?: boolean) => void;
  /** The error line's words for the last write that failed — the add drawer says them inside itself. */
  lastError: string;
  /** Sign-ups on the Registration page, not confirmed yet — a pointer, not a list. */
  waiting: number;
  openRegistrationPage: () => void;
  /* Each resolves once the refreshed list is on screen, with the route's answer; null when it failed. */
  onAdd: (person: NewPerson) => Promise<unknown>;
  onBulk: (text: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  onRestore: () => Promise<unknown>;
  onRestoreOne: (id: string) => Promise<unknown>;
  onPurgeOne: (id: string, confirm: boolean) => Promise<PersonAsk | null>;
  /** Everyone on the removed list, for good — the same two steps. */
  onPurgeAll: (confirm: boolean) => Promise<(PersonAsk & { count?: number }) | null>;
  /** Back to the Registration page's queue, as approved — the one way off this list that is not a removal. */
  onRegStatus: (id: string, status: RegStatus | null) => Promise<unknown>;
  exportHref: string;
};

/** Where a person is, as shown: on this list, back in the Registration page's queue, or under Removed. */
type Place = "list" | "queue" | "removed";

/** A list arriving or leaving: rows rise in, fade out, and the rest glide into place. */
const rowMotion = {
  layout: "position" as const,
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.14 } },
  transition: spring.smooth,
};

/** Came through the registration page and was confirmed — not added by the host. */
const signedUp = (p: AdminPerson) => p.regStatus === "confirmed";

/**
 * PEOPLE — one list: everyone who is coming.
 *
 * CIB's People page, for registration: the invited list and the sign-ups the
 * host confirmed. The counts are the filters (one row of tiles, the chosen one
 * ringed in blue): everyone, who signed up through the page, who the host
 * added, and REMOVED, where the people taken off the list wait to come back
 * (or to be erased for good). Then search and the two actions, then one card
 * per person. The whole card opens them; it lifts and catches a sheen of blue
 * under the pointer. Its buttons are real buttons — To registration, Edit,
 * Remove.
 *
 * CIB's event-day columns (in the app now, check-in, the screen a phone is on)
 * are not here: nobody is in a room yet. The card shows how they got on the
 * list, when they registered, and their address.
 *
 * Sign-ups that are not confirmed yet are NOT here. They queue on the
 * Registration page, and confirming one there puts them on this list; TO
 * REGISTRATION on a card sends them back.
 *
 * Nothing unfolds under a card. EDIT opens the person drawer with the editor
 * already open; ADD SOMEONE opens a drawer of its own (AddDrawer).
 */
export function PeopleView({
  snapshot,
  state,
  query,
  onQuery,
  filter,
  onFilter,
  sort,
  dir,
  onSort,
  openPerson,
  lastError,
  waiting,
  openRegistrationPage,
  onAdd,
  onBulk,
  onRemove,
  onRestore,
  onRestoreOne,
  onPurgeOne,
  onPurgeAll,
  onRegStatus,
  exportHref,
}: PeopleViewProps) {
  const q = query.trim().toLowerCase();

  /*
   * WAITING ON THE DATABASE. A card that leaves this list — Remove, To registration, Bring back —
   * goes the moment it is pressed (its exit is the list's own), held until the refreshed list
   * agrees; a failure lets go and it rises back in, the error line saying why. Other cards stay
   * live throughout.
   */
  const serverPlace = useMemo(() => {
    const m: Record<string, Place> = {};
    for (const p of snapshot.people) m[p.id] = holdsSeat(p.regStatus) ? "list" : "queue";
    for (const p of snapshot.removedPeople) m[p.id] = "removed";
    return m;
  }, [snapshot.people, snapshot.removedPeople]);
  const place = useHeldKeys<Place>(serverPlace, 20_000);
  /* Removed from their own drawer: gone from here as the drawer closes. */
  const leavingIds = useLeaving();
  const whereOf = (id: string): Place | undefined => (leavingIds.has(id) ? "removed" : place.shownOf(id));
  const everyone = [...snapshot.people, ...snapshot.removedPeople];
  const people = everyone.filter((p) => whereOf(p.id) === "list");
  const [rowPending, runRow] = usePendingKeys();
  /** Moves a card at once, and back if the write fails. */
  const move = (id: string, to: Place, write: () => Promise<unknown>, what: string) =>
    void runRow(
      id,
      async () => {
        place.hold(id, to);
        if ((await write()) === null) place.release(id);
      },
      what,
    );

  const [addOpen, setAddOpen] = useState(false);

  /* Arm-twice for the per-card erasers, one id each so nothing stays hot. */
  const [armDelId, setArmDelId] = useState<string | null>(null);
  const [armBackId, setArmBackId] = useState<string | null>(null);
  const armT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armT.current) clearTimeout(armT.current);
    },
    [],
  );
  const arm = (set: (v: string | null) => void, id: string, fire: () => void, current: string | null) => {
    if (current !== id) {
      set(id);
      if (armT.current) clearTimeout(armT.current);
      armT.current = setTimeout(() => set(null), 3500);
      return;
    }
    if (armT.current) clearTimeout(armT.current);
    set(null);
    fire();
  };
  const tapDelete = (id: string) => arm(setArmDelId, id, () => move(id, "removed", () => onRemove(id), "remove"), armDelId);
  const tapBack = (id: string) => arm(setArmBackId, id, () => move(id, "queue", () => onRegStatus(id, "approved"), "back"), armBackId);
  const bringBack = (p: AdminPerson) => move(p.id, holdsSeat(p.regStatus) ? "list" : "queue", () => onRestoreOne(p.id), "restore");
  const [restoringAll, runRestoreAll] = usePending();
  const bringAllBack = (all: AdminPerson[]) =>
    void runRestoreAll(async () => {
      for (const p of all) place.hold(p.id, holdsSeat(p.regStatus) ? "list" : "queue");
      if ((await onRestore()) === null) for (const p of all) place.release(p.id);
    });

  /*
   * The purge sheet — the one irreversible control on this page. It opens at once and the dry
   * run's answer rises into it (a plain read: nothing re-renders behind it); confirmed, the button
   * turns until the refreshed list has landed, the card fades out and the sheet closes on it.
   */
  const [purge, setPurge] = useState<{ id: string | null; name: string; count: number; impact: PersonImpact | null } | null>(null);
  const [, runPurgeRead] = usePending();
  const [purging, runPurge] = usePending();
  const askPurge = (id: string) =>
    void runPurgeRead(async () => {
      const who = snapshot.removedPeople.find((p) => p.id === id);
      if (!who) return;
      setPurge({ id, name: who.name, count: 1, impact: null });
      const body = await onPurgeOne(id, false);
      if (!body?.needsConfirm) {
        setPurge(null);
        return;
      }
      setPurge((s) => (s && s.id === id ? { ...s, impact: body.personImpact ?? ZERO_PERSON_IMPACT } : s));
    });
  const askPurgeAll = (count: number) =>
    void runPurgeRead(async () => {
      setPurge({ id: null, name: `all ${count} removed people`, count, impact: null });
      const body = await onPurgeAll(false);
      if (!body?.needsConfirm) {
        setPurge(null);
        return;
      }
      const n = body.count ?? count;
      setPurge((s) => (s && s.id === null ? { id: null, name: `all ${n} removed people`, count: n, impact: body.personImpact ?? ZERO_PERSON_IMPACT } : s));
    });
  const confirmPurge = () =>
    void runPurge(async () => {
      if (!purge) return;
      if (purge.id) await onPurgeOne(purge.id, true);
      else await onPurgeAll(true);
      setPurge(null);
    });

  /* The REMOVED tile goes when the last of them is back or gone (as shown: a Bring back counts at once). */
  const removedAll = everyone.filter((p) => whereOf(p.id) === "removed");
  const removedCount = Math.max(0, snapshot.removedCount - snapshot.removedPeople.length) + removedAll.length;
  useEffect(() => {
    if (filter === "removed" && removedCount === 0) onFilter("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, removedCount]);

  const matches = (p: AdminPerson) =>
    !q || `${p.name} ${p.title} ${p.company ?? ""} ${p.regEmail ?? ""} ${p.phone ?? ""}`.toLowerCase().includes(q);

  const capacity = registrationCapacity(state);
  const signed = people.filter(signedUp);
  const added = people.filter((p) => !signedUp(p));

  /* `share` draws the tile's bar: its part of the list (Everyone: of the seats, when there is a cap). */
  const of = (n: number) => (people.length ? n / people.length : 0);
  const tiles: { key: string; label: string; count: number; dot: string; of?: number; share?: number; guide: string }[] = [
    {
      key: "all",
      label: "Everyone",
      count: people.length,
      dot: "all",
      of: capacity > 0 ? capacity : undefined,
      share: capacity > 0 ? Math.min(1, people.length / capacity) : undefined,
      guide: "Shows everyone on the list.",
    },
    { key: "signed", label: "Signed up", count: signed.length, dot: "done", share: of(signed.length), guide: "Shows the people who registered on the page and you confirmed." },
    { key: "added", label: "Added by you", count: added.length, dot: "idle", share: of(added.length), guide: "Shows the people you added here yourself." },
  ];
  if (removedCount > 0) {
    tiles.push({ key: "removed", label: "Removed", count: removedCount, dot: "gone", guide: "Shows the people taken off the list; nothing of theirs is deleted and they can come back." });
  }

  const showingRemoved = filter === "removed";

  let rows = people.filter((p) => {
    if (filter === "signed") return signedUp(p);
    if (filter === "added") return !signedUp(p);
    return true;
  });
  rows = rows.filter(matches);
  const sorters: Record<string, (a: AdminPerson, b: AdminPerson) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    status: (a, b) => Number(signedUp(b)) - Number(signedUp(a)) || a.name.localeCompare(b.name),
    registered: (a, b) => (a.registeredAt ?? "~").localeCompare(b.registeredAt ?? "~") || a.name.localeCompare(b.name),
    email: (a, b) => (a.regEmail ?? "~").localeCompare(b.regEmail ?? "~") || a.name.localeCompare(b.name),
  };
  rows = [...rows].sort((a, b) => (sorters[sort] || sorters.name)(a, b) * dir);

  const removedRows = removedAll
    .filter((p) => !q || `${p.name} ${p.title} ${p.regEmail ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const subOf = (p: AdminPerson) => [p.rawTitle, p.company].filter(Boolean).join(" · ");

  /** Name, face, chips: the part of a card that is its button. */
  const who = (p: AdminPerson) => (
    <button type="button" className="prow-open" onClick={() => openPerson(p.id)}>
      <span aria-hidden>
        <Avatar person={p} size={38} />
      </span>
      <span className="prow-who">
        <b>
          <span className="nm">{p.name}</span>
          {p.isTeam ? <span className="ppl-chip host">Host</span> : null}
        </b>
        {subOf(p) ? <span>{subOf(p)}</span> : null}
      </span>
    </button>
  );

  const emptyLine = q
    ? `Nobody matches “${query.trim()}”.`
    : filter === "signed"
      ? "Nobody has signed up and been confirmed yet."
      : filter === "added"
        ? "You have not added anyone yourself."
        : "";

  return (
    <div>
      {/* The counts, which are also the filters. */}
      <div className="ppl-tiles" role="tablist" aria-label="Show">
        <AnimatePresence initial={false}>
          {tiles.map((t) => {
            const on = filter === t.key || (t.key === "all" && !tiles.some((x) => x.key === filter));
            return (
              <motion.button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                className="ppl-tile"
                onClick={() => onFilter(t.key)}
                data-tile={t.key}
                data-guide={t.guide}
                {...(t.key === "removed"
                  ? {
                      initial: { flexGrow: 0, opacity: 0 },
                      animate: { flexGrow: 1, opacity: 1 },
                      exit: { flexGrow: 0, opacity: 0 },
                      transition: spring.smooth,
                    }
                  : null)}
              >
                {on ? <motion.span layoutId="ppl-tile-on" className="ppl-tile-on" transition={spring.snappy} aria-hidden /> : null}
                <span className="ppl-tile-l">
                  <i className={cx("ppl-dot", t.dot)} aria-hidden />
                  {t.label}
                </span>
                <span className="ppl-tile-n">
                  <b key={t.count}>{t.count}</b>
                  {t.of ? <small>of {t.of}</small> : null}
                </span>
                {t.share !== undefined ? (
                  <span className="ppl-tile-bar" aria-hidden>
                    <u className={t.dot} style={{ width: `${Math.round(t.share * 1000) / 10}%` }} />
                  </span>
                ) : null}
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="ppl-bar">
        <label className="ppl-search">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <circle cx="8.8" cy="8.8" r="5.6" />
            <path d="m13 13 3.6 3.6" />
          </svg>
          <input
            type="search"
            className="fld"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search by name, company, email or phone"
            aria-label="Search people"
          />
        </label>
        <Btn href={exportHref} data-guide="Downloads everyone on the list as a spreadsheet.">
          Export
        </Btn>
        <Btn
          tone="primary"
          onClick={() => setAddOpen(true)}
          data-action="add-someone"
          data-guide="Opens a panel to add one person or a list."
        >
          + Add someone
        </Btn>
      </div>

      {/* Sign-ups waiting on the Registration page: a pointer, not a list. */}
      <AnimatePresence initial={false}>
        {waiting > 0 ? (
          <motion.div key="waiting" {...fold} transition={spring.smooth} style={{ overflow: "hidden" }}>
            <div className="ppl-wait">
              <i className="ppl-dot wait" aria-hidden />
              <span>
                <b>{waiting}</b> sign-up{waiting === 1 ? "" : "s"} waiting for you
              </span>
              <LinkBtn tone="blue" onClick={openRegistrationPage}>
                Registration page ›
              </LinkBtn>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div key={showingRemoved ? "removed" : "list"} className="ppl-tabin">
        {showingRemoved ? (
          <>
            <div className="ppl-rmhead">
              <p>Taken off the list. Nothing of theirs is deleted.</p>
              {removedCount > 1 ? (
                <>
                  <Btn sm tone="primary" pending={restoringAll} onClick={() => bringAllBack(removedAll)} data-guide="Puts all of them back on the list.">
                    Bring all {removedCount} back
                  </Btn>
                  <Btn
                    sm
                    tone="care"
                    onClick={() => askPurgeAll(removedCount)}
                    data-guide="Erases everyone on this list and their details, after a typed word; this cannot be undone."
                  >
                    Delete all for good
                  </Btn>
                </>
              ) : null}
            </div>
            <div className="ppl-list is-removed" role="list" aria-label="Removed">
              <AnimatePresence initial={false}>
                {removedRows.map((p) => (
                  <motion.div key={p.id} role="listitem" className="ppl-slot" {...rowMotion}>
                    <div className="prow is-removed" data-person-row="">
                      <span className="prow-sheen" aria-hidden />
                      {who(p)}
                      <span className="prow-acts">
                        <Btn sm tone="primary" pending={rowPending(p.id) === "restore"} onClick={() => bringBack(p)} data-guide="Puts them back on the list.">
                          Bring back
                        </Btn>
                        <Btn
                          sm
                          tone="care"
                          onClick={() => askPurge(p.id)}
                          data-guide="Erases them and their details, after a typed word; this cannot be undone."
                        >
                          Delete for good
                        </Btn>
                      </span>
                      <span className="prow-go" aria-hidden>
                        ›
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            {!removedRows.length && removedCount > 0 ? (
              <div className="ppl-empty">
                <b>Nobody matches</b>
                None of the {removedCount} removed match “{query.trim()}”.
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div className="ppl-list" role="list" aria-label="People">
              <div className="ppl-head">
                {(
                  [
                    ["name", "Person", "c-n"],
                    ["status", "Status", "c-s"],
                    ["registered", "Registered", "c-t"],
                    ["email", "Email", "c-w"],
                  ] as [string, string, string][]
                ).map(([key, label, cls]) => (
                  <span key={key} className={cls}>
                    <button
                      type="button"
                      className={cx(sort === key && "on")}
                      onClick={() => onSort(key)}
                      data-guide={`Sorts the list by ${label.toLowerCase()}; press again to reverse it.`}
                    >
                      {label}
                      {sort === key ? <i aria-hidden>{dir === 1 ? "▲" : "▼"}</i> : null}
                    </button>
                  </span>
                ))}
              </div>
              <AnimatePresence initial={false}>
                {rows.map((p) => {
                  const viaPage = signedUp(p);
                  return (
                    <motion.div key={p.id} role="listitem" className="ppl-slot" {...rowMotion}>
                      <div className="prow" data-person-row="" data-person-id={p.id}>
                        <span className="prow-sheen" aria-hidden />
                        {who(p)}
                        <span className="prow-st">
                          <Swap k={viaPage ? "signed" : "added"}>
                            {viaPage ? (
                              <StatePill tone="done" title="Came through the registration page; you confirmed them">
                                Signed up
                              </StatePill>
                            ) : (
                              <StatePill title="You added them here">Added</StatePill>
                            )}
                          </Swap>
                        </span>
                        <span className="prow-t">{p.registeredAt ? eventDay(p.registeredAt) : <span className="dash">—</span>}</span>
                        <span className="prow-where" title={p.regEmail ?? undefined} dir="ltr">
                          {p.regEmail ?? <span className="dash">—</span>}
                        </span>
                        <span className="prow-acts">
                          {viaPage ? (
                            <Btn
                              sm
                              className="ctx"
                              armed={armBackId === p.id}
                              pending={rowPending(p.id) === "back"}
                              onClick={() => tapBack(p.id)}
                              data-guide="Press twice: sends them back to the Registration page's queue, approved; their seat opens up."
                            >
                              {armBackId === p.id ? "Tap again" : "To registration"}
                            </Btn>
                          ) : null}
                          <Btn sm onClick={() => openPerson(p.id, true)} data-action="edit" data-guide="Opens their details to change them.">
                            Edit
                          </Btn>
                          <Btn
                            sm
                            tone="care"
                            armed={armDelId === p.id}
                            pending={rowPending(p.id) === "remove"}
                            onClick={() => tapDelete(p.id)}
                            data-action="remove"
                            data-guide="Press twice: takes them off the list; nothing of theirs is deleted and Removed brings them back."
                          >
                            {armDelId === p.id ? "Tap again" : "Remove"}
                          </Btn>
                        </span>
                        <span className="prow-go" aria-hidden>
                          ›
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
            {!rows.length ? (
              people.length ? (
                <div className="ppl-empty">
                  <b>{q ? "Nobody matches" : "Nobody here"}</b>
                  {emptyLine}
                </div>
              ) : (
                <div className="ppl-empty">
                  <b>Nobody on the list yet</b>
                  Add someone, or confirm a sign-up on the Registration page.
                  <div>
                    <Btn tone="primary" onClick={() => setAddOpen(true)}>
                      + Add someone
                    </Btn>
                  </div>
                </div>
              )
            ) : (
              <p className="ppl-foot">
                {rows.length === people.length ? `${people.length} on the list` : `${rows.length} of ${people.length}`}
              </p>
            )}
          </>
        )}
      </div>

      <AddDrawer open={addOpen} onClose={() => setAddOpen(false)} lastError={lastError} onAdd={onAdd} onBulk={onBulk} />

      <ConfirmSheet
        open={purge !== null}
        kicker="DELETE FOR GOOD"
        title={purge ? `Erase ${purge.name} from the database?` : ""}
        blurb={
          purge && purge.id === null
            ? `Unlike Remove, this cannot be undone. ${purge.count} people go, with their details and photos.`
            : "Unlike Remove, this cannot be undone. Their details and photo go with them; the directory keeps their name for a later event."
        }
        impact={purge?.impact ? personImpactLines(purge.impact) : []}
        impactLabel="WHAT GOES WITH THEM"
        impactEmpty="Their registration details, their photo and their place on the list."
        word="DELETE"
        actionLabel={purge && purge.id === null ? `ERASE ${purge.count} PEOPLE` : "ERASE THIS PERSON"}
        busy={purging}
        reading={purge !== null && purge.impact === null}
        onCancel={() => {
          if (!purging) setPurge(null);
        }}
        onConfirm={confirmPurge}
      />
    </div>
  );
}
