"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Progress, STEPS_OF, Tick, useLeadEdits, type LeadWrites } from "@/components/admin/lead";
import { Avatar, Btn, cx, LinkBtn, useHeldKeys } from "@/components/admin/ui";
import { eventDay } from "@/lib/admin/eventClock";
import type { AdminPerson } from "@/lib/admin/model";
import { STEP_KEYS, STEP_LABEL, type StepKey } from "@/lib/leads";
import { spring } from "@/lib/motion";

/**
 * REGISTRATIONS — everyone who signed up on the public page, and the four steps the team walks each
 * of them through (InCircle-One-System.html, "Registrations"): MESSAGE · CALL · CALENDAR ·
 * CONFIRMED. The first three are the team's own record (lib/leads.ts). CONFIRMED is the seat: ticked,
 * they hold one of the evening's seats (reg_status `confirmed`, lib/registration.ts holdsSeat);
 * unticked, the seat opens again.
 *
 * On top, the counts — registered, how many reached each step, the seats left. A step's count sorts
 * the list by that step, the people still missing it first. Then search and the three filters (all,
 * missing a step, confirmed), then one row per sign-up. Their name opens them; EDIT opens their
 * details; DECLINE (twice) takes them off the list — Lead management › Removed brings them back.
 *
 * No history column (Belal, 2026-10-05): the file's "attended N / first time" is left out.
 */

type Filter = "all" | "missing" | "confirmed";
type SortKey = "name" | "registered" | StepKey | "confirmed" | "progress";
type StepCol = StepKey | "confirmed";

const COLS: StepCol[] = [...STEP_KEYS, "confirmed"];
const COL_LABEL: Record<StepCol, string> = { ...STEP_LABEL, confirmed: "Confirmed" };
/** What each count is called: how many reached that step. */
const COUNT_LABEL: Record<StepCol, string> = { message: "Messaged", call: "Called", calendar: "On the calendar", confirmed: "Confirmed" };
const COL_GUIDE: Record<StepCol, string> = {
  message: "Ticks that they have been sent a message.",
  call: "Ticks that the team has called them.",
  calendar: "Ticks that they accepted the calendar invitation.",
  confirmed: "Confirms them: they hold a seat. Untick to give the seat back.",
};

/** A row: it rises in, fades out when it leaves the list, and glides when the list re-sorts. */
const rowMotion = {
  layout: "position" as const,
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.14 } },
  transition: spring.smooth,
};

export function RegistrationsView({
  signups,
  seated,
  capacity,
  ready,
  writes,
  onDecline,
  openPerson,
  openRegistrationPage,
}: {
  /** Everyone on this event's list who registered through the page (removed ones are not here). */
  signups: AdminPerson[];
  /** Seats held, as the server counts them: the invited roster and the confirmed. */
  seated: number;
  /** `reg_capacity`; 0 = no limit. */
  capacity: number;
  /** False until the schema has been run. */
  ready: boolean;
  writes: LeadWrites;
  /** Off the list, into Lead management › Removed (reversible there). Null when it failed. */
  onDecline: (id: string) => Promise<unknown>;
  /** The drawer on the right — with the editor already open when `edit` is true. */
  openPerson: (id: string, edit?: boolean) => void;
  openRegistrationPage: () => void;
}) {
  const edits = useLeadEdits(signups, writes);

  /* DECLINE: the row goes at once, and comes back if the decline did not save. */
  const serverIn = useMemo(() => Object.fromEntries(signups.map((p) => [p.id, true as const])), [signups]);
  const present = useHeldKeys<true>(serverIn, 20_000);
  const [armId, setArmId] = useState<string | null>(null);
  const armT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armT.current) clearTimeout(armT.current);
    },
    [],
  );
  const tapDecline = (id: string) => {
    if (armId !== id) {
      setArmId(id);
      if (armT.current) clearTimeout(armT.current);
      armT.current = setTimeout(() => setArmId(null), 3500);
      return;
    }
    if (armT.current) clearTimeout(armT.current);
    setArmId(null);
    present.hold(id, undefined);
    void onDecline(id).then((res) => {
      if (res === null) present.release(id);
    });
  };
  const shown = signups.filter((p) => present.shownOf(p.id));

  /* The counts, as shown: a tick pressed a moment ago already counts. */
  const reached = (p: AdminPerson, c: StepCol) => (c === "confirmed" ? edits.confirmed(p) : edits.step(p, c));
  const count = (c: StepCol) => shown.filter((p) => reached(p, c)).length;
  const confirmedNow = count("confirmed");
  const confirmedSaved = signups.filter((p) => p.regStatus === "confirmed").length;
  const seatsTaken = Math.max(0, seated - confirmedSaved + confirmedNow);
  const seatsLeft = capacity > 0 ? Math.max(0, capacity - seatsTaken) : null;

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "registered", dir: -1 });
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === "registered" ? -1 : 1 }));

  const needle = q.trim().toLowerCase();
  const value = (p: AdminPerson, key: SortKey): number | string => {
    if (key === "name") return p.name.toLowerCase();
    if (key === "registered") return p.registeredAt ?? "";
    if (key === "progress") return edits.done(p);
    return reached(p, key) ? 1 : 0;
  };
  const rows = shown
    .filter((p) => {
      if (needle && !`${p.name} ${p.rawTitle ?? ""} ${p.company ?? ""} ${p.regEmail ?? ""} ${p.phone ?? ""}`.toLowerCase().includes(needle)) return false;
      if (filter === "missing") return edits.done(p) < STEPS_OF;
      if (filter === "confirmed") return edits.confirmed(p);
      return true;
    })
    .sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return c * sort.dir || a.name.localeCompare(b.name);
    });

  const missing = shown.filter((p) => edits.done(p) < STEPS_OF).length;
  const share = (n: number) => (shown.length ? Math.min(1, n / shown.length) : 0);
  const subOf = (p: AdminPerson) => [p.rawTitle, p.company].filter(Boolean).join(" · ");

  const head = (key: SortKey, label: string, className?: string, guide?: string) => (
    <th className={className} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        className={cx("lt-sort", sort.key === key && "on")}
        onClick={() => sortBy(key)}
        data-guide={guide ?? `Sorts the list by ${label.toLowerCase()}; press again to reverse it.`}
      >
        {label}
        {sort.key === key ? <i aria-hidden>{sort.dir === 1 ? "▲" : "▼"}</i> : null}
      </button>
    </th>
  );

  return (
    <div>
      {!ready ? (
        <div className="note">
          <b>NOT SET UP YET</b>
          Run <code>supabase/01_schema.sql</code> in Supabase. Until then nobody can sign up.
        </div>
      ) : null}

      {/* The counts. A step's count sorts the list by it, the people still missing it first. */}
      <div className="ppl-tiles reg-tiles">
        <div className="ppl-tile">
          <span className="ppl-tile-l">
            <i className="ppl-dot all" aria-hidden />
            Registered
          </span>
          <span className="ppl-tile-n">
            <b key={shown.length}>{shown.length}</b>
          </span>
        </div>
        {COLS.map((c) => {
          const on = sort.key === c;
          const n = count(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              className="ppl-tile"
              onClick={() => setSort({ key: c, dir: 1 })}
              data-guide={`Sorts the list by ${COL_LABEL[c].toLowerCase()}: the people still missing it come first.`}
            >
              {on ? <motion.span layoutId="reg-tile-on" className="ppl-tile-on" transition={spring.snappy} aria-hidden /> : null}
              <span className="ppl-tile-l">
                <i className={cx("ppl-dot", c === "confirmed" ? "done" : "idle")} aria-hidden />
                {COUNT_LABEL[c]}
              </span>
              <span className="ppl-tile-n">
                <b key={n}>{n}</b>
                {shown.length ? <small>of {shown.length}</small> : null}
              </span>
              <span className="ppl-tile-bar" aria-hidden>
                <u className={c === "confirmed" ? "done" : undefined} style={{ width: `${Math.round(share(n) * 1000) / 10}%` }} />
              </span>
            </button>
          );
        })}
        <div className="ppl-tile">
          <span className="ppl-tile-l">
            <i className={cx("ppl-dot", seatsLeft === 0 ? "gone" : "idle")} aria-hidden />
            Seats left
          </span>
          <span className="ppl-tile-n">
            {seatsLeft === null ? (
              <b>∞</b>
            ) : (
              <>
                <b key={seatsLeft}>{seatsLeft}</b>
                <small>of {capacity}</small>
              </>
            )}
          </span>
        </div>
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
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, company, email or phone"
            aria-label="Search registrations"
          />
        </label>
        <div className="lseg" role="radiogroup" aria-label="Show">
          {(
            [
              ["all", "All", "Shows everyone who signed up."],
              ["missing", "Missing a step", "Shows the people with a step still to do."],
              ["confirmed", "Confirmed", "Shows the people who are confirmed: they hold a seat."],
            ] as [Filter, string, string][]
          ).map(([k, label, guide]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} className={cx(filter === k && "on")} onClick={() => setFilter(k)} data-guide={guide}>
              {filter === k ? <motion.span layoutId="reg-seg-on" className="lseg-on" transition={spring.snappy} aria-hidden /> : null}
              <span>
                {label}
                {k === "missing" && missing ? <em>{missing}</em> : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="card flush lt-card">
        <div className="regq lt lt-reg">
          <table>
            <thead>
              <tr>
                {head("name", "Person", "lt-who")}
                <th>EMAIL</th>
                <th>PHONE</th>
                {head("registered", "Registered")}
                {COLS.map((c) => (
                  <th key={c} className="c">
                    <button
                      type="button"
                      className={cx("lt-sort", sort.key === c && "on")}
                      onClick={() => sortBy(c)}
                      data-guide={`Sorts the list by ${COL_LABEL[c].toLowerCase()}; press again to reverse it.`}
                    >
                      {COL_LABEL[c]}
                      {sort.key === c ? <i aria-hidden>{sort.dir === 1 ? "▲" : "▼"}</i> : null}
                    </button>
                  </th>
                ))}
                {head("progress", "Progress")}
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {rows.map((p) => {
                  const first = p.name.split(/\s+/)[0] || p.name;
                  return (
                    <motion.tr key={p.id} {...rowMotion}>
                      <td className="lt-who">
                        <button type="button" className="lt-open" onClick={() => openPerson(p.id)} title="Open their record" data-guide="Opens their record.">
                          <Avatar person={p} size={34} />
                          <span className="min-w-0">
                            <b className="block">{p.name}</b>
                            {subOf(p) ? <span className="block text-meta text-muted">{subOf(p)}</span> : null}
                          </span>
                        </button>
                      </td>
                      <td className="lt-dim" title={p.regEmail ?? undefined} dir="ltr">
                        {p.regEmail ?? "—"}
                      </td>
                      <td className="lt-dim" dir="ltr">
                        {p.phone ?? "—"}
                      </td>
                      <td className="lt-dim">{p.registeredAt ? eventDay(p.registeredAt) : "—"}</td>
                      {STEP_KEYS.map((k) => (
                        <td key={k} className="c">
                          <Tick on={edits.step(p, k)} onClick={() => edits.setStep(p, k, !edits.step(p, k))} label={`${first}: ${STEP_LABEL[k]}`} data-guide={COL_GUIDE[k]} />
                        </td>
                      ))}
                      <td className="c">
                        <Tick
                          tone="seat"
                          on={edits.confirmed(p)}
                          onClick={() => edits.setConfirmed(p, !edits.confirmed(p))}
                          label={`${first}: Confirmed`}
                          data-guide={COL_GUIDE.confirmed}
                        />
                      </td>
                      <td>
                        <Progress done={edits.done(p)} />
                      </td>
                      <td>
                        <div className="regacts">
                          <Btn sm onClick={() => openPerson(p.id, true)} title="Their details" data-action="edit" data-guide="Opens their details to change them.">
                            Edit
                          </Btn>
                          <Btn
                            sm
                            tone="care"
                            className="regarm"
                            armed={armId === p.id}
                            onClick={() => tapDecline(p.id)}
                            title="Off the list (undo under Lead management › Removed)"
                            data-action="decline"
                            data-guide="Press twice: takes them off the list; Lead management › Removed brings them back."
                          >
                            {armId === p.id ? "Tap again" : "Decline"}
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
          <div className="lt-empty">
            {shown.length ? (
              <>
                <b>Nobody here</b>
                {needle ? `Nobody matches “${q.trim()}”.` : filter === "missing" ? "Everyone has done all four steps." : "Nobody is confirmed yet."}
              </>
            ) : (
              <>
                <b>No sign-ups yet</b>
                {ready ? "They arrive here from the public page." : "Not set up yet."}
                <div>
                  <LinkBtn tone="blue" onClick={openRegistrationPage}>
                    Registration page ›
                  </LinkBtn>
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="lt-foot">
            {rows.length === shown.length ? `${shown.length} signed up` : `${rows.length} of ${shown.length}`} · {confirmedNow} confirmed
          </p>
        )}
      </div>
    </div>
  );
}
