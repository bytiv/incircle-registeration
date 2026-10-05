"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { Layout } from "@/components/admin/AdminShell";
import { ConfirmSheet } from "@/components/admin/ConfirmSheet";
import { NextAction, OwnerSelect, Tick, useLeadEdits, type LeadWrites } from "@/components/admin/lead";
import { AddDrawer } from "@/components/admin/people/AddDrawer";
import { useLeaving } from "@/components/admin/people/bits";
import type { NewPerson } from "@/components/admin/people/types";
import { Avatar, Btn, cx, usePending, usePendingKeys, useHeldKeys } from "@/components/admin/ui";
import type { AdminPerson, AdminSnapshot } from "@/lib/admin/model";
import { personImpactLines, ZERO_PERSON_IMPACT, type PersonAsk, type PersonImpact } from "@/lib/admin/runs";
import { LEAD_CAT_LABEL, LEAD_CATS, type LeadCat } from "@/lib/leads";
import { spring } from "@/lib/motion";

export type PeopleViewProps = {
  layout: Layout;
  snapshot: AdminSnapshot;
  query: string;
  onQuery: (v: string) => void;
  /** all · a category (lib/leads.ts LEAD_CATS) · unassigned · removed */
  filter: string;
  onFilter: (v: string) => void;
  sort: string;
  dir: number;
  onSort: (col: string) => void;
  /** The drawer on the right — with the editor already open when `edit` is true. */
  openPerson: (id: string, edit?: boolean) => void;
  /** The error line's words for the last write that failed — the add drawer says them inside itself. */
  lastError: string;
  /** The names every Owner drop-down offers (the `lead_owners` setting). */
  owners: string[];
  /** Opens the owners list (AdminRoot's OwnersSheet). */
  openOwners: () => void;
  /** A category, the owner, the next action — each resolves once the refreshed list is on screen; null when it failed. */
  writes: LeadWrites;
  /* Each resolves once the refreshed list is on screen, with the route's answer; null when it failed. */
  onAdd: (person: NewPerson) => Promise<unknown>;
  onBulk: (text: string) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  onRestore: () => Promise<unknown>;
  onRestoreOne: (id: string) => Promise<unknown>;
  onPurgeOne: (id: string, confirm: boolean) => Promise<PersonAsk | null>;
  /** Everyone on the removed list, for good — the same two steps. */
  onPurgeAll: (confirm: boolean) => Promise<(PersonAsk & { count?: number }) | null>;
  exportHref: string;
};

/** Where a person is, as shown: on this list, or under Removed. */
type Place = "list" | "removed";

/** A list arriving or leaving: rows rise in, fade out, and the rest glide into place. */
const rowMotion = {
  layout: "position" as const,
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.14 } },
  transition: spring.smooth,
};

/** The categories' column heads, on two lines (the file's POTENTIAL / CLIENT). */
const CAT_HEAD: Record<LeadCat, [string, string]> = {
  potential_client: ["Potential", "client"],
  current_client: ["Current", "client"],
  potential_collab: ["Potential", "collab"],
  potential_speaker: ["Potential", "speaker"],
};
const UNASSIGNED = "__unassigned__";

/** Where they stand on the list: the small chip by their name. */
function standing(p: AdminPerson): { word: string; tone: string; title: string } {
  if (p.regStatus === "confirmed") return { word: "Confirmed", tone: "done", title: "Signed up on the page and confirmed: they hold a seat" };
  if (p.regStatus) return { word: "Registered", tone: "wait", title: "Signed up on the page; not confirmed yet (Registrations)" };
  return { word: "Added", tone: "", title: "You added them here" };
}

/**
 * LEAD MANAGEMENT — everyone on this event's list, as leads (InCircle-One-System.html, "Lead
 * management"; it was People, Belal 2026-10-05: "this is the name we should use instead of
 * people"): every sign-up, confirmed or not, and everyone added by hand.
 *
 * The counts are the filters (one row of tiles, the chosen one ringed in blue): everyone, each
 * category, the unassigned, and REMOVED, where the people taken off the list wait to come back (or
 * to be erased for good). Then search, the owner filter, OWNERS (the names the drop-downs offer),
 * Export and Add someone, then one row per person: their name (it opens them), the four
 * categories as ticks (a person can hold several), who owns them, and the next action, typed where
 * it shows. EDIT opens the person drawer with the editor open; REMOVE (twice) takes them off.
 *
 * What they did at the event is not here (no history: Belal, 2026-10-05) — nobody is in a room yet.
 */
export function PeopleView({
  snapshot,
  query,
  onQuery,
  filter,
  onFilter,
  sort,
  dir,
  onSort,
  openPerson,
  lastError,
  owners,
  openOwners,
  writes,
  onAdd,
  onBulk,
  onRemove,
  onRestore,
  onRestoreOne,
  onPurgeOne,
  onPurgeAll,
  exportHref,
}: PeopleViewProps) {
  const q = query.trim().toLowerCase();

  /*
   * WAITING ON THE DATABASE. A row that leaves this list — Remove, Bring back — goes the moment it
   * is pressed (its exit is the list's own), held until the refreshed list agrees; a failure lets
   * go and it rises back in, the error line saying why. Other rows stay live throughout.
   */
  const serverPlace = useMemo(() => {
    const m: Record<string, Place> = {};
    for (const p of snapshot.people) m[p.id] = "list";
    for (const p of snapshot.removedPeople) m[p.id] = "removed";
    return m;
  }, [snapshot.people, snapshot.removedPeople]);
  const place = useHeldKeys<Place>(serverPlace, 20_000);
  /* Removed from their own drawer: gone from here as the drawer closes. */
  const leavingIds = useLeaving();
  const whereOf = (id: string): Place | undefined => (leavingIds.has(id) ? "removed" : place.shownOf(id));
  const everyone = [...snapshot.people, ...snapshot.removedPeople];
  const people = everyone.filter((p) => whereOf(p.id) === "list");
  const edits = useLeadEdits(snapshot.people, writes);
  const [rowPending, runRow] = usePendingKeys();
  /** Moves a row at once, and back if the write fails. */
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
  const [ownerF, setOwnerF] = useState("");

  /* Arm-twice for Remove, one id at a time so nothing stays hot. */
  const [armDelId, setArmDelId] = useState<string | null>(null);
  const armT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armT.current) clearTimeout(armT.current);
    },
    [],
  );
  const tapDelete = (id: string) => {
    if (armDelId !== id) {
      setArmDelId(id);
      if (armT.current) clearTimeout(armT.current);
      armT.current = setTimeout(() => setArmDelId(null), 3500);
      return;
    }
    if (armT.current) clearTimeout(armT.current);
    setArmDelId(null);
    move(id, "removed", () => onRemove(id), "remove");
  };
  const bringBack = (p: AdminPerson) => move(p.id, "list", () => onRestoreOne(p.id), "restore");
  const [restoringAll, runRestoreAll] = usePending();
  const bringAllBack = (all: AdminPerson[]) =>
    void runRestoreAll(async () => {
      for (const p of all) place.hold(p.id, "list");
      if ((await onRestore()) === null) for (const p of all) place.release(p.id);
    });

  /*
   * The purge sheet — the one irreversible control on this page. It opens at once and the dry
   * run's answer rises into it (a plain read: nothing re-renders behind it); confirmed, the button
   * turns until the refreshed list has landed, the row fades out and the sheet closes on it.
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

  /* The owners the filter offers: the list, and any name still given to somebody after it left the list. */
  const ownerNames = [...owners, ...people.map((p) => edits.owner(p)).filter((o): o is string => !!o && !owners.includes(o))].filter(
    (o, i, all) => all.indexOf(o) === i,
  );
  useEffect(() => {
    if (ownerF && ownerF !== UNASSIGNED && !ownerNames.includes(ownerF)) setOwnerF("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerF, ownerNames.join("\n")]);

  const matches = (p: AdminPerson) =>
    !q || `${p.name} ${p.title} ${p.company ?? ""} ${p.regEmail ?? ""} ${p.phone ?? ""} ${edits.owner(p) ?? ""} ${p.lead.next}`.toLowerCase().includes(q);

  /* The counts, as shown: a tick pressed a moment ago already counts. */
  const of = (n: number) => (people.length ? n / people.length : 0);
  const unassigned = people.filter((p) => !edits.owner(p)).length;
  const tiles: { key: string; label: string; count: number; dot: string; share?: number; guide: string }[] = [
    { key: "all", label: "Everyone", count: people.length, dot: "all", guide: "Shows everyone on the list." },
    ...LEAD_CATS.map((c) => {
      const n = people.filter((p) => edits.cat(p, c)).length;
      return { key: c, label: LEAD_CAT_LABEL[c], count: n, dot: `cat-${c}`, share: of(n), guide: `Shows the people marked ${LEAD_CAT_LABEL[c].toLowerCase()}.` };
    }),
    { key: "unassigned", label: "Unassigned", count: unassigned, dot: "idle", share: of(unassigned), guide: "Shows the people nobody looks after yet." },
  ];
  if (removedCount > 0) {
    tiles.push({ key: "removed", label: "Removed", count: removedCount, dot: "gone", guide: "Shows the people taken off the list; nothing of theirs is deleted and they can come back." });
  }

  const showingRemoved = filter === "removed";

  let rows = people.filter((p) => {
    if ((LEAD_CATS as readonly string[]).includes(filter)) return edits.cat(p, filter as LeadCat);
    if (filter === "unassigned") return !edits.owner(p);
    return true;
  });
  if (ownerF === UNASSIGNED) rows = rows.filter((p) => !edits.owner(p));
  else if (ownerF) rows = rows.filter((p) => edits.owner(p) === ownerF);
  rows = rows.filter(matches);
  const sorters: Record<string, (a: AdminPerson, b: AdminPerson) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    // The unassigned last, whichever way the list runs.
    owner: (a, b) => (edits.owner(a) ?? "￿").localeCompare(edits.owner(b) ?? "￿") || a.name.localeCompare(b.name),
  };
  rows = [...rows].sort((a, b) => (sorters[sort] || sorters.name)(a, b) * dir);

  const removedRows = removedAll
    .filter((p) => !q || `${p.name} ${p.title} ${p.regEmail ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const subOf = (p: AdminPerson) => [p.rawTitle, p.company].filter(Boolean).join(" · ");
  const sortKey = sorters[sort] ? sort : "name";

  const emptyLine = q
    ? `Nobody matches “${query.trim()}”.`
    : filter === "unassigned"
      ? "Everyone has an owner."
      : (LEAD_CATS as readonly string[]).includes(filter)
        ? `Nobody is marked ${LEAD_CAT_LABEL[filter as LeadCat].toLowerCase()} yet.`
        : ownerF
          ? "Nobody has this owner."
          : "";

  const head = (key: string, label: string, className?: string) => (
    <th className={className} aria-sort={sortKey === key ? (dir === 1 ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        className={cx("lt-sort", sortKey === key && "on")}
        onClick={() => onSort(key)}
        data-guide={`Sorts the list by ${label.toLowerCase()}; press again to reverse it.`}
      >
        {label}
        {sortKey === key ? <i aria-hidden>{dir === 1 ? "▲" : "▼"}</i> : null}
      </button>
    </th>
  );

  return (
    <div>
      {/* The counts, which are also the filters. */}
      <div className="ppl-tiles lead-tiles" role="tablist" aria-label="Show">
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
            placeholder="Search by name, company, email, owner or next action"
            aria-label="Search leads"
          />
        </label>
        {showingRemoved ? null : (
          <select
            className={cx("lead-ownerf", ownerF && "on")}
            value={ownerF}
            onChange={(e) => setOwnerF(e.target.value)}
            aria-label="Show the leads of"
            data-guide="Shows only the leads one person looks after."
          >
            <option value="">All owners</option>
            <option value={UNASSIGNED}>Unassigned</option>
            {ownerNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        )}
        <Btn onClick={openOwners} data-action="owners" data-guide="Opens the list of owners: the names the Owner drop-downs offer.">
          Owners{owners.length ? <em className="lead-btnn">{owners.length}</em> : null}
        </Btn>
        <Btn href={exportHref} data-guide="Downloads everyone on the list as a spreadsheet, with their steps, categories, owner and next action.">
          Export
        </Btn>
        <Btn tone="primary" onClick={() => setAddOpen(true)} data-action="add-someone" data-guide="Opens a panel to add one person or a list.">
          + Add someone
        </Btn>
      </div>

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
                      <button type="button" className="prow-open" onClick={() => openPerson(p.id)}>
                        <span aria-hidden>
                          <Avatar person={p} size={38} />
                        </span>
                        <span className="prow-who">
                          <b>
                            <span className="nm">{p.name}</span>
                          </b>
                          {subOf(p) ? <span>{subOf(p)}</span> : null}
                        </span>
                      </button>
                      <span className="prow-acts">
                        <Btn sm tone="primary" pending={rowPending(p.id) === "restore"} onClick={() => bringBack(p)} data-guide="Puts them back on the list.">
                          Bring back
                        </Btn>
                        <Btn sm tone="care" onClick={() => askPurge(p.id)} data-guide="Erases them and their details, after a typed word; this cannot be undone.">
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
          <div className="card flush lt-card">
            <div className="regq lt lt-lead">
              <table>
                <thead>
                  <tr>
                    {head("name", "Person", "lt-who")}
                    {LEAD_CATS.map((c) => (
                      <th key={c} className={cx("c", `lt-cat-${c}`)} title={LEAD_CAT_LABEL[c]}>
                        {CAT_HEAD[c][0]}
                        <br />
                        {CAT_HEAD[c][1]}
                      </th>
                    ))}
                    {head("owner", "Owner")}
                    <th>NEXT ACTION</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {rows.map((p) => {
                      const st = standing(p);
                      const first = p.name.split(/\s+/)[0] || p.name;
                      return (
                        <motion.tr key={p.id} {...rowMotion} data-person-id={p.id}>
                          <td className="lt-who">
                            <button type="button" className="lt-open" onClick={() => openPerson(p.id)} title="Open their record" data-guide="Opens their record.">
                              <Avatar person={p} size={34} />
                              <span className="min-w-0">
                                <b className="lt-name">
                                  <span className="nm">{p.name}</span>
                                  {p.isTeam ? <span className="ppl-chip host">Host</span> : null}
                                  <span className={cx("lchip", st.tone)} title={st.title}>
                                    {st.word}
                                  </span>
                                </b>
                                {subOf(p) ? <span className="block text-meta text-muted">{subOf(p)}</span> : null}
                              </span>
                            </button>
                          </td>
                          {LEAD_CATS.map((c) => (
                            <td key={c} className="c">
                              <Tick
                                tone={c}
                                on={edits.cat(p, c)}
                                onClick={() => edits.setCat(p, c, !edits.cat(p, c))}
                                label={`${first}: ${LEAD_CAT_LABEL[c]}`}
                                data-guide={`Marks them as a ${LEAD_CAT_LABEL[c].toLowerCase()}; a person can hold several.`}
                              />
                            </td>
                          ))}
                          <td>
                            <OwnerSelect
                              value={edits.owner(p)}
                              owners={owners}
                              onChange={(o) => edits.setOwner(p, o)}
                              onAddOwner={openOwners}
                              label={`Owner of ${p.name}`}
                            />
                          </td>
                          <td>
                            <NextAction value={p.lead.next} onSave={(v) => edits.setNext(p, v)} label={`Next action for ${p.name}`} />
                          </td>
                          <td>
                            <div className="regacts">
                              <Btn sm onClick={() => openPerson(p.id, true)} data-action="edit" data-guide="Opens their details to change them.">
                                Edit
                              </Btn>
                              <Btn
                                sm
                                tone="care"
                                className="regarm"
                                armed={armDelId === p.id}
                                pending={rowPending(p.id) === "remove"}
                                onClick={() => tapDelete(p.id)}
                                data-action="remove"
                                data-guide="Press twice: takes them off the list; nothing of theirs is deleted and Removed brings them back."
                              >
                                {armDelId === p.id ? "Tap again" : "Remove"}
                              </Btn>
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
            {!rows.length ? (
              people.length ? (
                <div className="lt-empty">
                  <b>{q ? "Nobody matches" : "Nobody here"}</b>
                  {emptyLine}
                </div>
              ) : (
                <div className="lt-empty">
                  <b>Nobody on the list yet</b>
                  Sign-ups arrive here from the public page, or add someone yourself.
                  <div>
                    <Btn tone="primary" onClick={() => setAddOpen(true)}>
                      + Add someone
                    </Btn>
                  </div>
                </div>
              )
            ) : (
              <p className="lt-foot">
                {rows.length === people.length ? `${people.length} on the list` : `${rows.length} of ${people.length}`}
                {unassigned ? ` · ${unassigned} unassigned` : ""}
              </p>
            )}
          </div>
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
