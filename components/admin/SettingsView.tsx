"use client";

import { useState } from "react";

import { DateTimeField } from "@/components/admin/DateTimeField";
import { GuideToggle } from "@/components/admin/guide";
import { Btn, Field, Hero, SaveState, SettingsGroup, SettingsRow, Toggle, useHeld, usePending } from "@/components/admin/ui";
import { fromEventInput, toEventInput } from "@/lib/admin/eventClock";
import { EVENT_TZ } from "@/lib/env";
import { REG_EMAIL_BODY_MAX, REG_EMAIL_FILLS, REG_EMAIL_SUBJECT_MAX, type RegEmail } from "@/lib/regEmail";
import type { EventRow } from "@/lib/supabase/types";

/**
 * Settings — the event, and this control room.
 *
 * CIB's Settings page in its premium shape: one calm page of grouped lists,
 * each row a title, one line and its control.
 *
 *   the event        a blue band: its name, when and where, and whether the
 *                    public page is up — with a way to the Registration page
 *   THE EVENT        its name, date and location: the top of the public page.
 *                    (CIB keeps these on the event's own area under Manage
 *                    events; registration has one event, so they live here.)
 *   WELCOME EMAIL    what a person is sent the moment they register: on/off,
 *                    the subject and the message (lib/regEmail.ts)
 *   HELP             the guide: hover any control to learn what it does
 *   LINKS            the public registration page
 *   ACCESS           the passcode (and Sign out now), the time zone
 */
export type SettingsProps = {
  event: EventRow;
  /** "Wed 12 Aug 2026 · Cairo", or the venue alone, or "". */
  eventDate: string;
  /** `events.is_public` — the registration page is up. */
  isPublic: boolean;
  /** Name, date and location — the row itself, through /api/admin/events. Resolves once the saved row is on screen; null when it failed. */
  updateEvent: (patch: { name?: string; startsAt?: string | null; venue?: string | null }) => Promise<unknown | null>;
  openRegistrationPage: () => void;
  /** The `reg_email` setting as saved. */
  regEmail: RegEmail;
  /** Resend's keys are in the environment (lib/email.ts): without them nothing is sent. */
  emailReady: boolean;
  /** A change to the welcome email, merged into the newest saved one. Resolves with null when it failed. */
  saveRegEmail: (patch: Partial<RegEmail>) => Promise<unknown | null>;
  /** Resolves once the gate is on screen (or the press failed). */
  lockAdmin: () => Promise<void>;
};

export function SettingsView({
  event,
  eventDate,
  isPublic,
  updateEvent,
  openRegistrationPage,
  regEmail,
  emailReady,
  saveRegEmail,
  lockAdmin,
}: SettingsProps) {
  const [leaving, runLock] = usePending();

  return (
    <div className="setpage">
      <Hero
        className="solo"
        title={
          <span className="hero-t">
            {event.name}
            <span
              className={isPublic ? "pill active" : "pill"}
              title={isPublic ? "The registration page is up and taking sign-ups" : "The registration page is down"}
            >
              <i />
              {isPublic ? "Registration open" : "Registration closed"}
            </span>
          </span>
        }
        sub={eventDate || "No date or location yet — set them below"}
      >
        <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 16 }}>
          <Btn sm onClick={openRegistrationPage} data-guide="Opens the Registration page: the sign-ups waiting for you, and the page itself.">
            Registration page ›
          </Btn>
        </div>
      </Hero>

      <SettingsGroup label="THE EVENT" aside="The top of the public page">
        {/* Keyed by the saved row, so a save (or another tab's) starts the draft from what is stored. */}
        <EventFields key={`${event.name}|${event.starts_at ?? ""}|${event.venue ?? ""}`} event={event} updateEvent={updateEvent} />
      </SettingsGroup>

      <SettingsGroup label="WELCOME EMAIL" aside="Sent the moment someone registers" id="email">
        <WelcomeEmail email={regEmail} ready={emailReady} save={saveRegEmail} />
      </SettingsGroup>

      {/* Per viewer, off by default (components/admin/guide): the page header has the same switch. */}
      <SettingsGroup label="HELP" aside="On this browser only" id="guide">
        <SettingsRow icon="?" soft title="Guide" line="Show what each control does when you hover it.">
          <GuideToggle row />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="LINKS" aside="Opens in its own tab">
        <SettingsRow
          icon="▤"
          title={
            <>
              The page
              <span className="path">/</span>
            </>
          }
          line={isPublic ? "The public page and its sign-up form, as a visitor sees it." : "The public page — its form says registration opens soon until you publish it."}
          data-interface="/"
        >
          <Btn sm href="/" target="_blank" rel="noreferrer" data-guide="Opens the public page in a new tab.">
            Open ↗
          </Btn>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="ACCESS">
        <SettingsRow
          icon="◈"
          soft
          title="Admin passcode"
          line="One passcode for the team, set in the environment (ADMIN_PASSCODE) — whoever has it can open this control room."
        >
          <span className="val" aria-label="The passcode is hidden" style={{ letterSpacing: ".2em" }}>
            ••••••
          </span>
          <Btn sm pending={leaving} onClick={() => void runLock(lockAdmin)} data-guide="Signs you out of the control room; the passcode is asked again.">
            Sign out now
          </Btn>
        </SettingsRow>
        <SettingsRow icon="◷" soft title="Time zone" line="Every clock in here, set in the environment (NEXT_PUBLIC_EVENT_TZ).">
          <span className="val">{EVENT_TZ}</span>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

/**
 * The event's name, date and location — CIB's EventDetails form (its date and location) with
 * the name beside them. Saved on SAVE: the button turns from the press until the saved row is on
 * screen; a failed save says so, and the draft stays.
 */
function EventFields({
  event,
  updateEvent,
}: {
  event: EventRow;
  updateEvent: SettingsProps["updateEvent"];
}) {
  const [name, setName] = useState(event.name);
  const [venue, setVenue] = useState(event.venue ?? "");
  /* The event's wall time (lib/admin/eventClock.ts), so the server and the browser agree on it. */
  const [when, setWhen] = useState(toEventInput(event.starts_at));
  const cleanName = name.replace(/\s+/g, " ").trim();
  const dirty =
    cleanName !== event.name || venue.trim() !== (event.venue ?? "") || when !== toEventInput(event.starts_at);
  const [saving, runSave] = usePending();
  const [failed, setFailed] = useState(false);
  const save = () =>
    void runSave(async () => {
      if (!dirty || !cleanName) return;
      setFailed(false);
      const patch = {
        name: cleanName,
        venue: venue.trim() || null,
        startsAt: when ? fromEventInput(when) : null,
      };
      if ((await updateEvent(patch)) === null) setFailed(true);
    });

  return (
    <div style={{ padding: "18px 20px 20px" }} data-event-details="">
      <Field label="NAME" full>
        <input
          className="fld"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder="The event's name"
          aria-invalid={!cleanName || undefined}
        />
      </Field>
      <div className="g2" style={{ marginTop: 14 }}>
        <Field label="DATE AND TIME">
          <DateTimeField value={when} onChange={setWhen} />
        </Field>
        <Field label="LOCATION">
          <input className="fld" value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={80} placeholder="Where it happens" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3" style={{ marginTop: 16 }}>
        <Btn
          sm
          tone={dirty ? "primary" : "secondary"}
          pending={saving}
          disabled={(!dirty || !cleanName) && !saving}
          onClick={save}
          data-guide="Saves the name, the date and the location; the public page shows them on its next load."
        >
          {dirty ? "Save" : "Saved"}
        </Btn>
        <SaveState state={saving ? "saving" : dirty ? "dirty" : "saved"} labels={failed ? { dirty: "Not saved · Try again" } : undefined} />
      </div>
    </div>
  );
}

/**
 * The welcome email: its switch (saved on the press, like the public page's), and its subject and
 * message (saved on SAVE, like the event's fields). The switch shows its new state at once and
 * pulses until the server agrees; a failed press lets go of it.
 */
function WelcomeEmail({ email, ready, save }: { email: RegEmail; ready: boolean; save: SettingsProps["saveRegEmail"] }) {
  const sw = useHeld(email.on, 20_000);
  const [switching, runSwitch] = usePending();
  const flip = () =>
    void runSwitch(async () => {
      const v = !sw.shown;
      sw.hold(v);
      if ((await save({ on: v })) === null) sw.release();
    });
  const line = !ready
    ? "Not sending yet: Resend's keys (RESEND_API_KEY and EMAIL_FROM) are not in the environment."
    : sw.shown
      ? "Every new sign-up gets this email, a moment after they register."
      : "Off — nobody is emailed. The words below are kept.";

  return (
    <>
      <SettingsRow icon="✉" title="Send automatically" line={line}>
        <Toggle
          on={sw.shown}
          pending={switching}
          onClick={flip}
          label={sw.shown ? "On" : "Off"}
          guide="Turns the welcome email on or off for everyone who registers from now on."
        />
      </SettingsRow>
      {/* Keyed by the saved words, so a save (or another tab's) starts the draft from what is stored. */}
      <EmailWords key={`${email.subject}|${email.body}`} email={email} save={save} />
    </>
  );
}

function EmailWords({ email, save }: { email: RegEmail; save: SettingsProps["saveRegEmail"] }) {
  const [subject, setSubject] = useState(email.subject);
  const [body, setBody] = useState(email.body);
  const cleanSubject = subject.replace(/\s+/g, " ").trim();
  const cleanBody = body.trim();
  const dirty = cleanSubject !== email.subject || cleanBody !== email.body;
  const blank = !cleanSubject || !cleanBody;
  const [saving, runSave] = usePending();
  const [failed, setFailed] = useState(false);
  const submit = () =>
    void runSave(async () => {
      if (!dirty || blank) return;
      setFailed(false);
      if ((await save({ subject: cleanSubject, body })) === null) setFailed(true);
    });

  return (
    <div style={{ padding: "18px 20px 20px", borderTop: "1px solid var(--color-line-soft)" }} data-welcome-email="">
      <Field label="SUBJECT" full>
        <input
          className="fld"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={REG_EMAIL_SUBJECT_MAX}
          placeholder="You're registered for {event}"
          aria-invalid={!cleanSubject || undefined}
        />
      </Field>
      <Field label="MESSAGE" full style={{ marginTop: 14 }}>
        <textarea
          className="fld"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={REG_EMAIL_BODY_MAX}
          rows={10}
          style={{ minHeight: 220 }}
          placeholder={"Hi {first_name},\n\nThank you for registering for {event}."}
          aria-invalid={!cleanBody || undefined}
        />
      </Field>
      <p style={{ margin: "10px 0 0 6px", fontSize: 12, fontWeight: 600, lineHeight: 1.5, color: "var(--color-muted)" }}>
        {REG_EMAIL_FILLS.map((f, i) => (
          <span key={f}>
            {i ? (i === REG_EMAIL_FILLS.length - 1 ? " and " : ", ") : null}
            <b style={{ color: "var(--color-text-2)" }}>{f}</b>
          </span>
        ))}{" "}
        are filled in for each person. A blank line starts a new paragraph; links become clickable.
      </p>
      <div className="flex flex-wrap items-center gap-3" style={{ marginTop: 16 }}>
        <Btn
          sm
          tone={dirty ? "primary" : "secondary"}
          pending={saving}
          disabled={(!dirty || blank) && !saving}
          onClick={submit}
          data-guide="Saves the subject and the message; the next person who registers gets the new words."
        >
          {dirty ? "Save" : "Saved"}
        </Btn>
        <SaveState state={saving ? "saving" : dirty ? "dirty" : "saved"} labels={failed ? { dirty: "Not saved · Try again" } : undefined} />
      </div>
    </div>
  );
}
