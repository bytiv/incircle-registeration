"use client";

/* eslint-disable @next/next/no-img-element -- the page's own picture, small */

import "@/components/moments/moments.css";

import { useEffect, useId, useRef, useState } from "react";

import { Btn, Eyebrow, LinkBtn, SaveState, Toggle, useHeld, usePending } from "@/components/admin/ui";
import { cx } from "@/components/moments/ui/cx";
import { eventDay } from "@/lib/admin/eventClock";
import type { FlowAction } from "@/lib/admin/flow";
import { SITE_URL } from "@/lib/env";
import { registrationCapacity } from "@/lib/registration";
import { getSetting } from "@/lib/settings";
import { plainText } from "@/lib/sitePage";
import type { EventStateRow } from "@/lib/supabase/types";
 
/**
 * REGISTRATION PAGE — the public page (incircle.community).
 *
 * On top, the page's address and the publish switch. Then THE PAGE: a small likeness of it and
 * the two ways onto it — EDIT THE PAGE opens it with every word, the picture, the album and the
 * form editable where they show, PREVIEW opens it exactly as visitors see it (Belal, 2026-10-05:
 * "the editing will be on the page itself") — and beside it the one thing that is not on the
 * page: the seats. The sign-ups it brings in are worked on Registrations
 * (components/admin/RegistrationsView.tsx).
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

export function RegistrationView({
  state,
  event,
  open,
  publish,
  send,
  ready,
  seated,
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
  /** Seats held: the invited roster and the confirmed sign-ups. */
  seated: number;
}) {
  /*
   * WAITING ON THE DATABASE (§15.4): the switch moves when pressed and pulses until the server
   * agrees; a seat count that did not save says so. A failure lets go of what it held.
   */
  const publicSw = useHeld(open, 20_000);
  const [publishing, runPublish] = usePending();
  const flipPublic = () =>
    void runPublish(async () => {
      const v = !publicSw.shown;
      publicSw.hold(v);
      if ((await publish(v)) === null) publicSw.release();
    });
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

  const seatsLeft = Math.max(0, seatsShown - seated);

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
