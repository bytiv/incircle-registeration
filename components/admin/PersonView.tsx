"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

import type { Layout } from "@/components/admin/AdminShell";
import { NextAction, OwnerSelect, Progress, Tick, useLeadEdits, type LeadWrites } from "@/components/admin/lead";
import { usePageScrollLock } from "@/components/admin/people/bits";
import { RowEditor } from "@/components/admin/people/RowEditor";
import type { PersonPatch } from "@/components/admin/people/types";
import { Avatar, Btn, cx, StatePill } from "@/components/admin/ui";
import type { AdminPerson } from "@/lib/admin/model";
import { LEAD_CAT_LABEL, LEAD_CATS, STEP_KEYS, STEP_LABEL } from "@/lib/leads";
import { ATTENDEE_LABEL } from "@/lib/registration";
import { spring } from "@/lib/motion";

/**
 * One person, in the drawer over Lead management (and over Registrations).
 *
 * Two faces, one at a time. THEIR PROFILE: the brand band with their face on a
 * white ring, their name and where they stand, then calm cards — a sign-up's
 * four steps (MESSAGE · CALL · CALENDAR · CONFIRMED), their lead (categories,
 * owner, next action — lib/leads.ts), how they are on the list, and what they
 * registered with. EDIT THEIR DETAILS: the same form Add someone uses
 * (RowEditor). CIB's event-day cards (device, check-in, every event they came
 * to) wait for the event app.
 *
 * A sub-view, not a tab: it is opened from a row, and the rail keeps the page
 * it was opened from highlighted while it is up.
 */

export type PersonProps = {
  layout: Layout;
  person: AdminPerson;
  /**
   * The editor, open or not — owned by the root so a row's EDIT can open the
   * drawer with it already unfolded. Belal, 2026-09-28: "clicking on edit
   * should open the sidebar and we should be able to edit from there. It
   * should not open a field below." This drawer is the ONE place a person is
   * edited; the rows only point here.
   */
  editing: boolean;
  setEditing: (on: boolean) => void;
  /** Why the last write failed (AdminRoot's error line, which the drawer covers). */
  lastError: string;
  /** Resolves once the saved person is on screen; null when it failed. */
  onEdit: (id: string, patch: PersonPatch) => Promise<unknown>;
  /** Off the list (reversible under Lead management › Removed). The drawer closes with them. Null when it failed. */
  onRemove: (id: string) => Promise<unknown>;
  back: () => void;
  /** The names the Owner drop-down offers (the `lead_owners` setting). */
  owners: string[];
  /** Opens the owners list. */
  openOwners: () => void;
  /** Their steps, categories, owner and next action. */
  writes: LeadWrites;
};

/** A face of the drawer arriving: up and in, on the smooth spring. */
const face = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: spring.smooth },
  exit: { opacity: 0, y: -4, transition: { duration: 0.12 } },
} as const;

export function PersonView({ person: p, editing, setEditing, lastError, onEdit, onRemove, back, owners, openOwners, writes }: PersonProps) {
  // Mounted only while somebody is open: the list behind stays where it was.
  usePageScrollLock(true);

  /* Opened straight into the editor (a row's Edit): leaving it goes back to the list. */
  const fromList = useRef(editing);
  const root = useRef<HTMLDivElement>(null);
  /* Each face of the drawer starts at its top. */
  useEffect(() => {
    root.current?.closest(".drawer")?.scrollTo({ top: 0 });
  }, [editing]);

  return (
    <div ref={root} className="pvw">
      <AnimatePresence mode="wait" initial={false}>
        {editing ? (
          <motion.div key="edit" className="pv-mode" {...face}>
            <RowEditor
              key={p.id}
              person={p}
              lastError={lastError}
              onSave={onEdit}
              onClose={() => (fromList.current ? back() : setEditing(false))}
              onRemove={onRemove}
              onDismiss={back}
            />
          </motion.div>
        ) : (
          <motion.div key="view" className="pv-mode" {...face}>
            <Profile p={p} back={back} edit={() => setEditing(true)} owners={owners} openOwners={openOwners} writes={writes} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Where they stand: the pill under their name. */
function standing(p: AdminPerson): { word: string; tone: "done" | "held" | "" } {
  if (p.regStatus === "confirmed") return { word: "Confirmed", tone: "done" };
  if (p.regStatus) return { word: "Registered · not confirmed", tone: "held" };
  return { word: "Added by you", tone: "" };
}

function Profile({
  p,
  back,
  edit,
  owners,
  openOwners,
  writes,
}: {
  p: AdminPerson;
  back: () => void;
  edit: () => void;
  owners: string[];
  openOwners: () => void;
  writes: LeadWrites;
}) {
  const sub = [p.rawTitle ?? (p.isTeam ? null : p.title), p.company].filter(Boolean).join(" · ");
  const stand = standing(p);
  const one = useMemo(() => [p], [p]);
  const edits = useLeadEdits(one, writes);

  /* design:1634-1639 — the code they will confirm with at the event. */
  const facts: { label: string; value: string }[] = [];
  if (p.code) facts.push({ label: "CODE", value: p.code });

  const rows: { label: string; value: ReactNode; quiet?: boolean }[] = [
    { label: "On the list", value: p.regStatus === null ? "Added by you" : "Through the registration page" },
    { label: "Role", value: p.isTeam ? "Host" : "Member" },
  ];

  const reg =
    p.regStatus !== null
      ? [
          {
            label: "Status",
            value: p.regStatus === "confirmed" ? "Confirmed" : "Registered · not confirmed yet",
          },
          { label: "Email", value: p.regEmail },
          { label: "Company", value: p.company },
          { label: "Phone", value: p.phone },
          { label: "InCircle before", value: p.attendee ? ATTENDEE_LABEL[p.attendee] : null },
          {
            label: "Registered",
            value: p.registeredAt
              ? new Date(p.registeredAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
              : null,
          },
        ].filter((r) => r.value)
      : [];

  return (
    <>
      <section className="pv-hero">
        <div className="pv-bar">
          <button type="button" className="pv-back" onClick={back}>
            ← Back
          </button>
          <Btn sm onClick={edit} data-action="edit-person" data-guide="Opens the form to change their name, photo, title and code.">
            Edit details
          </Btn>
        </div>
        {/* The largest face in the control room, so a bad framing shows here first. */}
        <div className="pv-face">
          <Avatar person={p} size={92} />
        </div>
        <h2 className="pv-name">{p.name}</h2>
        {sub ? <p className="pv-sub">{sub}</p> : null}
        <div className="pv-chips">
          {p.removed ? (
            <span className="pill gone">
              <i />
              Removed
            </span>
          ) : (
            <StatePill tone={stand.tone}>{stand.word}</StatePill>
          )}
          {p.isTeam ? <span className="pv-chip">Host</span> : null}
          {p.li ? (
            <a className="pv-chip" href={p.li} target="_blank" rel="noopener noreferrer">
              LinkedIn ↗
            </a>
          ) : null}
        </div>
        {facts.length ? (
          <div className="pv-facts">
            {facts.map((f) => (
              <div key={f.label}>
                <span>{f.label}</span>
                <b>{f.value}</b>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div className="pv-body">
        {/* A sign-up's four steps (Registrations): the last is their seat. */}
        {p.regStatus !== null ? (
          <div className="card lcard">
            <div className="lcard-head">
              <div className="lb">FOUR STEPS</div>
              <Progress done={edits.done(p)} />
            </div>
            {STEP_KEYS.map((k) => (
              <div className="lrowk lstep" key={k}>
                <span className="kk">{STEP_LABEL[k]}</span>
                <span className="vv">
                  <Tick on={edits.step(p, k)} onClick={() => edits.setStep(p, k, !edits.step(p, k))} label={STEP_LABEL[k]} />
                </span>
              </div>
            ))}
            <div className="lrowk lstep">
              <span className="kk">
                Confirmed
                <small>They hold a seat</small>
              </span>
              <span className="vv">
                <Tick tone="seat" on={edits.confirmed(p)} onClick={() => edits.setConfirmed(p, !edits.confirmed(p))} label="Confirmed" />
              </span>
            </div>
          </div>
        ) : null}

        {/* Their lead (Lead management): categories, who looks after them, what is next. */}
        <div className="card lcard">
          <div className="lb">LEAD</div>
          <div className="lcats" role="group" aria-label="Categories">
            {LEAD_CATS.map((c) => {
              const on = edits.cat(p, c);
              return (
                <button key={c} type="button" className={cx("lcat", `t-${c}`, on && "on")} aria-pressed={on} onClick={() => edits.setCat(p, c, !on)}>
                  {on ? "✓ " : ""}
                  {LEAD_CAT_LABEL[c]}
                </button>
              );
            })}
          </div>
          <div className="lrowk">
            <span className="kk">Owner</span>
            <span className="vv">
              <OwnerSelect value={edits.owner(p)} owners={owners} onChange={(o) => edits.setOwner(p, o)} onAddOwner={openOwners} label="Owner" />
            </span>
          </div>
          <div className="lrowk lnextrow">
            <span className="kk">Next action</span>
            <span className="vv">
              <NextAction value={p.lead.next} onSave={(v) => edits.setNext(p, v)} label="Next action" />
            </span>
          </div>
        </div>

        <div className="card">
          <div className="lb">ON THE LIST</div>
          {rows.map((r) => (
            <div className="lrowk" key={r.label}>
              <span className="kk">{r.label}</span>
              <span className={r.quiet ? "vv quiet" : "vv"}>{r.value}</span>
            </div>
          ))}
        </div>

        {/* How they got onto the list, when it was the registration page. */}
        {reg.length ? (
          <div className="card">
            <div className="lb">REGISTRATION</div>
            {reg.map((r) => (
              <div className="lrowk" key={r.label}>
                <span className="kk">{r.label}</span>
                <span className="vv">{r.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
