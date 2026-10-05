"use client";

/* eslint-disable @next/next/no-img-element -- the page's own picture, small */

import "@/components/moments/moments.css";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Avatar, Btn, Eyebrow, LinkBtn, Roll, SaveState, SearchBox, StatePill, Swap, Toggle, useHeld, useHeldKeys, usePending, usePendingKeys } from "@/components/admin/ui";
import { cx } from "@/components/moments/ui/cx";
import { eventDay } from "@/lib/admin/eventClock";
import type { FlowAction } from "@/lib/admin/flow";
import type { AdminPerson } from "@/lib/admin/model";
import { SITE_URL } from "@/lib/env";
import { spring } from "@/lib/motion";
import { ATTENDEE_LABEL, registrationCapacity, type RegStatus } from "@/lib/registration";
import { getSetting } from "@/lib/settings";
import { plainText } from "@/lib/sitePage";
import type { EventStateRow } from "@/lib/supabase/types";

/**
 * REGISTRATION PAGE — the public page (incircle.community), and the queue it fills.
 *
 * On top, the page's address and the publish switch. Then the queue: every sign-up not
 * confirmed yet, New (approve, or decline) and Approved (confirm, and they join People).
 * Then THE PAGE: a small likeness of it and the two ways onto it — EDIT THE PAGE opens it with
 * every word, the picture, the album and the form editable where they show, PREVIEW opens it
 * exactly as visitors see it (Belal, 2026-10-05: "the editing will be on the page itself") —
 * and beside it the only two things that are not on the page: approval and seats.
 *
 * The seat count is `reg_capacity` (0, shown as ∞, keeps the page open) — and the invited
 * roster holds seats alongside the confirmed sign-ups, which is why a room with 70 seats
 * and 93 invited people reads as full. Raise the seats, or trim the roster, and it opens up.
 */

/** The most seats the server keeps (lib/settings.ts SETTING_RULES). */
const SEATS_MAX = 10_000;
/** The seat field's text as a number: empty is 0 (the page stays open), anything else a whole number ≥ 0, or null. */
function parseSeats(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.min(SEATS_MAX, Math.round(n)) : null;
}
const seatsText = (n: number) => (n > 0 ? String(n) : "");

/** A sign-up row: it rises in, fades out when it leaves the queue, and glides when the queue re-sorts. */
const rowMotion = {
  layout: "position" as const,
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: { duration: 0.14 } },
  transition: spring.smooth,
};
type QueueStatus = "new" | "approved";

export function RegistrationView({
  state,
  event,
  open,
  publish,
  send,
  ready,
  counts,
  queue,
  onRegStatus,
  onDecline,
  openPerson,
}: {
  state: EventStateRow;
  /** The event's own name, date and location (edited in Settings): the page's date line. */
  event: { name: string; startsAt: string | null; venue: string | null };
  /** `events.is_public` — the page takes sign-ups for this event. */
  open: boolean;
  /** Put this event on the public page (taking any other down), or take it off. Resolves once it is on screen; null when it failed. */
  publish: (on: boolean) => Promise<unknown>;
  /** A setting, through the room's writer: resolves with the room's answer, null when it failed. */
  send: (action: FlowAction) => Promise<unknown>;
  /** False until the schema has been run. */
  ready: boolean;
  /** From the roster: sign-ups in the pipeline, seats held (invited + confirmed), the invited alone, New alone, New + Approved. */
  counts: { registered: number; seated: number; invited: number; waiting: number; queue: number };
  /** New and Approved sign-ups — the people this page is for. New first. */
  queue: AdminPerson[];
  /** approved: they count as vetted · confirmed: they hold a seat and join People. Null when it failed. */
  onRegStatus: (id: string, status: RegStatus | null) => Promise<unknown>;
  /** Off this event, into People's REMOVED pill — reversible there. Null when it failed. */
  onDecline: (id: string) => Promise<unknown>;
  /** The drawer on the right — with the editor already open when `edit` is true. */
  openPerson: (id: string, edit?: boolean) => void;
}) {
  /*
   * WAITING ON THE DATABASE (§15.4): each switch moves when pressed and pulses until the server
   * agrees; each sign-up's pill and buttons change at once and a row that leaves the queue fades
   * out; a seat count that did not save says so. A failure lets go of what it held.
   */
  const publicSw = useHeld(open, 20_000);
  const [publishing, runPublish] = usePending();
  const flipPublic = () =>
    void runPublish(async () => {
      const v = !publicSw.shown;
      publicSw.hold(v);
      if ((await publish(v)) === null) publicSw.release();
    });
  const approveSw = useHeld(getSetting(state, "reg_approve"));
  const [approving, runApprove] = usePending();
  const flipApprove = () =>
    void runApprove(async () => {
      const v = !approveSw.shown;
      approveSw.hold(v);
      if ((await send({ type: "setting", key: "reg_approve", value: v })) === null) approveSw.release();
    });
  const approve = approveSw.shown;
  const capacity = registrationCapacity(state);
  const page = getSetting(state, "reg_page");
  const when = [event.startsAt ? eventDay(event.startsAt) : null, event.venue].filter(Boolean).join(" · ");

  /* The page's address — the deployed origin when we know it, this one otherwise. */
  const [origin, setOrigin] = useState(SITE_URL);
  useEffect(() => {
    if (!SITE_URL) setOrigin(window.location.origin);
  }, []);
  const url = `${origin}/`;
  const [copied, setCopied] = useState(false);
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the address shows it; a host can select it */
    }
  };

  /* ---- Seats: typed, then saved 700ms after the last key ---- */
  const seatsId = useId();
  const [seatsDraft, setSeatsDraft] = useState(seatsText(capacity));
  const [seatsFailed, setSeatsFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const lastSeats = useRef(capacity);
  useEffect(() => {
    // The field follows the saved count unless the host is mid-change.
    const prev = lastSeats.current;
    lastSeats.current = capacity;
    setSeatsDraft((d) => (parseSeats(d) === prev ? seatsText(capacity) : d));
  }, [capacity]);
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  const seatsParsed = parseSeats(seatsDraft);
  const seatsDirty = seatsParsed !== null && seatsParsed !== capacity;
  useEffect(() => {
    if (!seatsDirty || seatsParsed === null) return;
    const t = setTimeout(() => {
      setSeatsFailed(false);
      void sendRef.current({ type: "setting", key: "reg_capacity", value: seatsParsed }).then((res) => {
        if (res === null) setSeatsFailed(true);
      });
    }, 700);
    return () => clearTimeout(t);
  }, [seatsDirty, seatsParsed, retry]);
  const seatsShown = seatsParsed ?? capacity;

  /* ---- The queue --------------------------------------------------------- */
  /* Each sign-up's status as shown: the pressed one's at once (undefined once it has left the queue). */
  const serverStatus = useMemo(
    () => Object.fromEntries(queue.map((p) => [p.id, (p.regStatus === "approved" ? "approved" : "new") as QueueStatus])),
    [queue],
  );
  const status = useHeldKeys<QueueStatus>(serverStatus, 20_000);
  const [rowPending, runRow] = usePendingKeys();
  type Press = "approve" | "confirm" | "unapprove" | "decline";
  const press = (id: string, what: Press) =>
    void runRow(
      id,
      async () => {
        status.hold(id, what === "approve" ? "approved" : what === "unapprove" ? "new" : undefined);
        const res =
          what === "decline" ? await onDecline(id) : await onRegStatus(id, what === "approve" ? "approved" : what === "confirm" ? "confirmed" : "new");
        if (res === null) status.release(id);
      },
      what,
    );
  const shownQueue = queue.flatMap((p) => {
    const st = status.shownOf(p.id);
    return st ? [{ ...p, regStatus: st as RegStatus }] : [];
  });
  /* The seats held, as shown: a sign-up confirmed a moment ago already holds one. */
  const seatedShown = counts.seated + queue.filter((p) => !status.shownOf(p.id) && status.isHeld(p.id) && rowPending(p.id) === "confirm").length;
  const seatsLeft = Math.max(0, seatsShown - seatedShown);

  const [q, setQ] = useState("");
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
    press(id, "decline");
  };
  const needle = q.trim().toLowerCase();
  const rows = shownQueue
    .filter((p) => !needle || `${p.name} ${p.title} ${p.company ?? ""} ${p.regEmail ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => (a.regStatus === "new" ? 0 : 1) - (b.regStatus === "new" ? 0 : 1) || a.name.localeCompare(b.name));
  const newCount = shownQueue.filter((p) => p.regStatus === "new").length;
  const subOf = (p: AdminPerson) => [p.rawTitle, p.company].filter(Boolean).join(" · ") || "—";

  return (
    <div>
      {!ready ? (
        <div className="note">
          <b>NOT SET UP YET</b>
          Run <code>supabase/01_schema.sql</code> in Supabase. Until then the page stays closed.
        </div>
      ) : null}

      <div className="reglink">
        <span className="reglink-url" title={url} dir="ltr">
          {url}
        </span>
        <LinkBtn tone="blue" className="reglink-copy" onClick={() => void copyLink()}>
          {copied ? "Copied" : "Copy"}
        </LinkBtn>
        <LinkBtn href="/" target="_blank" rel="noreferrer">
          Open ↗
        </LinkBtn>
        <span className="reglink-rule" aria-hidden />
        <Toggle
          on={publicSw.shown}
          caps
          pending={publishing}
          disabled={!ready}
          onClick={flipPublic}
          label="PUBLIC PAGE"
          title={publicSw.shown ? "Take the form down (sign-ups are kept; the page stays up and says registration opens soon)" : "Open the form on the page"}
        />
      </div>

      <section aria-label="Sign-ups">
        <div className="reghead">
          <div className="min-w-0 flex-1">
            <Eyebrow tone="blue">SIGN-UPS</Eyebrow>
            <h2 className="text-section">
              Waiting for you{shownQueue.length ? <> · <Roll value={shownQueue.length} /></> : ""}
            </h2>
          </div>
          {seatsShown > 0 ? (
            <span className={cx("regseats", seatsLeft === 0 && "none")}>
              <Roll value={seatsLeft} /> of <Roll value={seatsShown} /> seats left
            </span>
          ) : null}
          {shownQueue.length > 6 ? <SearchBox sm value={q} onChange={setQ} placeholder="Search" style={{ width: 220 }} /> : null}
        </div>
        <div className="card flush">
          <div className="regq">
            <table>
              <thead>
                <tr>
                  <th>PERSON</th>
                  <th>EMAIL</th>
                  <th>REGISTERED</th>
                  <th>STATUS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {rows.map((p) => {
                    const isNew = p.regStatus === "new";
                    const working = rowPending(p.id);
                    return (
                      <motion.tr key={p.id} {...rowMotion}>
                        <td>
                          <button type="button" className="flex items-center gap-3" onClick={() => openPerson(p.id)} title="Open their record" data-guide="Opens their record.">
                            <Avatar person={p} />
                            <span className="min-w-0">
                              <b className="block">
                                {p.name}
                                {p.attendee ? <span className={cx("regkind", p.attendee === "first" && "new")}>{ATTENDEE_LABEL[p.attendee]}</span> : null}
                              </b>
                              <span className="block text-meta text-muted">{subOf(p)}</span>
                            </span>
                          </button>
                        </td>
                        <td className="text-text-2" title={p.regEmail ?? undefined} dir="ltr">
                          {p.regEmail ?? "—"}
                        </td>
                        <td className="text-text-2">{p.registeredAt ? eventDay(p.registeredAt) : "—"}</td>
                        <td>
                          <Swap k={isNew ? "new" : "approved"}>{isNew ? <StatePill tone="held">New</StatePill> : <StatePill>Approved</StatePill>}</Swap>
                        </td>
                        <td>
                          <div className="regacts">
                            {isNew ? (
                              <Btn sm tone="primary" pending={working === "unapprove" || working === "approve"} onClick={() => press(p.id, "approve")} title="One step from a seat" data-guide="Approves the sign-up: one step from a seat.">
                                Approve
                              </Btn>
                            ) : (
                              <Btn sm tone="primary" pending={working === "approve" || working === "confirm"} onClick={() => press(p.id, "confirm")} title="A seat, and a place in People" data-guide="Gives them a seat and a place in People.">
                                Confirm
                              </Btn>
                            )}
                            {isNew ? null : (
                              <Btn sm onClick={() => press(p.id, "unapprove")} title="Back to New" data-guide="Moves them back to New.">
                                Unapprove
                              </Btn>
                            )}
                            <Btn sm onClick={() => openPerson(p.id, true)} title="Their details" data-action="edit" data-guide="Opens their details to change them.">
                              Edit
                            </Btn>
                            <Btn
                              sm
                              tone="care"
                              className="regarm"
                              armed={armId === p.id}
                              pending={working === "decline"}
                              onClick={() => tapDecline(p.id)}
                              title="Off the list (undo under People › Removed)"
                              data-action="decline"
                              data-guide="Press twice: takes them off the list; People › Removed brings them back."
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
            <p className="text-hint text-muted" style={{ padding: 30, textAlign: "center", margin: 0 }}>
              {shownQueue.length ? "No match." : ready ? "Nobody is waiting." : "Not set up yet."}
            </p>
          ) : (
            <p className="text-meta text-muted" style={{ padding: "10px 12px", borderTop: "1px solid var(--color-line-soft)" }}>
              <Roll value={newCount} /> new · <Roll value={shownQueue.length - newCount} /> approved
            </p>
          )}
        </div>
      </section>

      <section className="regsite" aria-label="The page">
        <div className="regsite-page card">
          <a className="regsite-thumb" href="/" target="_blank" rel="noreferrer" aria-label="Open the page in a new tab" tabIndex={-1}>
            <span className="regsite-nav" aria-hidden>
              <i />
              <b>InCircle</b>
              <em />
            </span>
            <span className="regsite-orb" aria-hidden />
            <span className="regsite-h">{plainText(page.intro.heading)}</span>
            <span className="regsite-btn" aria-hidden>
              {page.nav.cta || "Register"}
            </span>
            <img className="regsite-photo" src={page.hero.image} alt="" />
          </a>
          <div className="regsite-copy">
            <Eyebrow tone="blue">THE PAGE</Eyebrow>
            <h2 className="text-section">Edited where it shows</h2>
            <p className="regsite-line">
              Every word, the picture, the album and the form are changed on the page itself, and save as you go. Preview shows it exactly as visitors see
              it.
            </p>
            <div className="regsite-acts">
              <Btn tone="primary" href="/?edit=1" data-guide="Opens the page with everything on it editable.">
                Edit the page
              </Btn>
              <Btn href="/" data-guide="Opens the page as a visitor sees it.">
                Preview
              </Btn>
            </div>
            <p className="regsite-meta">
              {when ? <>The date on the page reads “{when}”.</> : <>The page shows no date yet.</>} The event&apos;s day and place are set in Settings.
            </p>
          </div>
        </div>

        <aside className="regsite-rules card" aria-label="Sign-up rules">
          <div className="regsite-ruleshead">
            <Eyebrow tone="blue">RULES</Eyebrow>
            {seatsFailed && seatsDirty ? (
              <LinkBtn tone="warn" onClick={() => setRetry((n) => n + 1)} guide="Sends the seat count again.">
                Try again
              </LinkBtn>
            ) : null}
            <SaveState state={seatsFailed && seatsDirty ? "dirty" : seatsDirty ? "saving" : "saved"} labels={{ dirty: "Not saved" }} />
          </div>
          <Toggle
            on={approve}
            pending={approving}
            onClick={flipApprove}
            label="Approve each sign-up"
            note={approve ? "New sign-ups wait here for you" : "New sign-ups land as Approved"}
          />
          <div className="regopt">
            <label htmlFor={seatsId}>
              <b>Seats</b>
              {seatsShown > 0 ? <span className={cx(seatsLeft === 0 && "none")}>{seatsLeft} left</span> : <span>No limit</span>}
            </label>
            <input
              id={seatsId}
              className={cx("fld", seatsParsed === null && "bad")}
              type="number"
              inputMode="numeric"
              min={0}
              max={SEATS_MAX}
              step={1}
              placeholder="∞"
              title="Empty keeps the page open"
              data-guide="The most people who can sign up; empty means no limit."
              value={seatsDraft}
              onChange={(e) => setSeatsDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  setSeatsDraft(seatsText(capacity));
                  e.currentTarget.blur();
                }
              }}
              onBlur={() => setSeatsDraft((d) => (parseSeats(d) === null ? seatsText(capacity) : seatsText(parseSeats(d) ?? 0)))}
            />
          </div>
        </aside>
      </section>
    </div>
  );
}
