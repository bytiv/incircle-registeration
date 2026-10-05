"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Btn, cx, Sheet, useHeld, useHeldKeys, usePending, usePendingKeys } from "@/components/admin/ui";
import type { AdminPerson } from "@/lib/admin/model";
import { LEAD_CATS, NEXT_MAX, OWNER_MAX, OWNERS_MAX, STEP_KEYS, type LeadCat, type LeadPatch, type StepKey } from "@/lib/leads";
import { spring } from "@/lib/motion";

/**
 * THE LEAD CONTROLS — shared by Registrations (the contact steps), Lead management (the
 * categories, the owner, the next action) and the person drawer (all of them), so the three always
 * agree (lib/leads.ts is what they save).
 *
 * WAITING ON THE DATABASE (§15.4), as everywhere in the control room: a press shows AT ONCE and is
 * held until the refreshed list agrees; a write that failed lets go, so the control shows what is
 * really saved, and the error line says why.
 */

/** The writes a lead takes (AdminRoot's): each resolves once the refreshed list is on screen, null when it failed. */
export type LeadWrites = {
  onLead: (id: string, patch: LeadPatch) => Promise<unknown>;
  /** Registrations' CONFIRMED tick: a seat (`confirmed`), or back to registered. */
  onConfirm: (id: string, on: boolean) => Promise<unknown>;
};

type Held = boolean | string | null;

/** How many of the four steps are done: the three contact steps, and CONFIRMED (the seat). */
export const STEPS_OF = STEP_KEYS.length + 1;

/**
 * Every lead control of a list, as shown: the server's value, or the one just pressed until the
 * server agrees. Pass the people the controls are for.
 */
export function useLeadEdits(people: AdminPerson[], { onLead, onConfirm }: LeadWrites) {
  const server = useMemo(() => {
    const m: Record<string, Held> = {};
    for (const p of people) {
      for (const k of STEP_KEYS) m[`${p.id}:step:${k}`] = p.lead.steps[k];
      for (const c of LEAD_CATS) m[`${p.id}:cat:${c}`] = p.lead.cats.includes(c);
      m[`${p.id}:owner`] = p.lead.owner;
      m[`${p.id}:confirmed`] = p.regStatus === "confirmed";
    }
    return m;
  }, [people]);
  const held = useHeldKeys<Held>(server, 20_000);
  const write = (key: string, value: Held, run: () => Promise<unknown>) => {
    held.hold(key, value);
    void run().then((res) => {
      if (res === null) held.release(key);
    });
  };
  const step = (p: AdminPerson, k: StepKey) => held.shownOf(`${p.id}:step:${k}`) === true;
  const confirmed = (p: AdminPerson) => held.shownOf(`${p.id}:confirmed`) === true;
  return {
    step,
    confirmed,
    cat: (p: AdminPerson, c: LeadCat) => held.shownOf(`${p.id}:cat:${c}`) === true,
    owner: (p: AdminPerson): string | null => {
      const v = held.shownOf(`${p.id}:owner`);
      return typeof v === "string" ? v : null;
    },
    /** The four steps done, as shown. */
    done: (p: AdminPerson) => STEP_KEYS.filter((k) => step(p, k)).length + (confirmed(p) ? 1 : 0),
    setStep: (p: AdminPerson, k: StepKey, on: boolean) => write(`${p.id}:step:${k}`, on, () => onLead(p.id, { kind: "step", key: k, on })),
    setCat: (p: AdminPerson, c: LeadCat, on: boolean) => write(`${p.id}:cat:${c}`, on, () => onLead(p.id, { kind: "cat", key: c, on })),
    setOwner: (p: AdminPerson, owner: string | null) => write(`${p.id}:owner`, owner, () => onLead(p.id, { kind: "owner", value: owner })),
    setConfirmed: (p: AdminPerson, on: boolean) => write(`${p.id}:confirmed`, on, () => onConfirm(p.id, on)),
    setNext: (p: AdminPerson, next: string) => onLead(p.id, { kind: "next", value: next }),
  };
}

export type LeadEdits = ReturnType<typeof useLeadEdits>;

/**
 * A tick box: a step, the seat, a category. Off it is a quiet glass square; on it fills with its
 * tone and the check draws in. A real checkbox to a screen reader, named by `label`.
 */
export function Tick({
  on,
  onClick,
  label,
  tone = "step",
  ...data
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  /** step · seat (CONFIRMED) · a category's own colour. */
  tone?: "step" | "seat" | LeadCat;
  [key: `data-${string}`]: string | undefined;
}) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} title={label} className={cx("ltick", `t-${tone}`, on && "on")} onClick={onClick} {...data}>
      <svg viewBox="0 0 16 16" aria-hidden>
        <path d="M3.6 8.5 6.7 11.4 12.5 4.9" />
      </svg>
    </button>
  );
}

/** How far along the four steps someone is: a short bar and "2/4". */
export function Progress({ done, of = STEPS_OF }: { done: number; of?: number }) {
  return (
    <span className={cx("lprog", done >= of && "full")} title={`${done} of ${of} steps done`}>
      <span className="lprog-bar" aria-hidden>
        <u style={{ width: `${Math.round((done / of) * 100)}%` }} />
      </span>
      <b>
        {done}/{of}
      </b>
    </span>
  );
}

/** The drop-down's last option: not a name, it opens the owners list. */
const ADD = "__add_owner__";

/**
 * Who looks after this person: "Unassigned", or a name from the owners list. A name taken off
 * the list stays on the people it was given to, marked so, until it is changed. The last option
 * opens the owners list (when `onAddOwner` is given).
 */
export function OwnerSelect({
  value,
  owners,
  onChange,
  onAddOwner,
  label,
  className,
}: {
  value: string | null;
  owners: string[];
  onChange: (owner: string | null) => void;
  onAddOwner?: () => void;
  label: string;
  className?: string;
}) {
  const names = value && !owners.includes(value) ? [...owners, value] : owners;
  return (
    <select
      className={cx("lsel", !value && "none", className)}
      value={value ?? ""}
      aria-label={label}
      title={value ? `${value} looks after them` : "Nobody looks after them yet"}
      onChange={(e) => {
        const v = e.target.value;
        if (v === ADD) {
          onAddOwner?.();
          return;
        }
        if ((v || null) !== value) onChange(v || null);
      }}
    >
      <option value="">Unassigned</option>
      {names.map((n) => (
        <option key={n} value={n}>
          {owners.includes(n) ? n : `${n} (not on the list)`}
        </option>
      ))}
      {onAddOwner ? <option value={ADD}>{owners.length ? "+ Add or remove owners…" : "+ Add owners…"}</option> : null}
    </select>
  );
}

/**
 * The next action, typed where it shows. It saves when the field is left or Enter is pressed;
 * Escape puts back what is saved. While it saves it shows what was typed, and a save that failed
 * puts back what is saved (the error line says why).
 */
export function NextAction({
  value,
  onSave,
  label,
  className,
}: {
  value: string;
  onSave: (next: string) => Promise<unknown>;
  label: string;
  className?: string;
}) {
  const saved = useHeld(value, 20_000);
  /** What is being typed; null when the field is not being typed in. */
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const skip = useRef(false);
  /* Words typed but not saved yet: closing the tab asks first rather than dropping them. */
  const unsaved = draft !== null && draft.replace(/\s+/g, " ").trim() !== saved.shown;
  useEffect(() => {
    if (!unsaved) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [unsaved]);
  const commit = async (typed: string) => {
    const v = typed.replace(/\s+/g, " ").trim().slice(0, NEXT_MAX);
    setDraft(null);
    if (v === saved.shown) return;
    saved.hold(v);
    setSaving(true);
    const res = await onSave(v);
    setSaving(false);
    if (res === null) saved.release();
  };
  return (
    <input
      className={cx("lnext", saving && "is-saving", className)}
      value={draft ?? saved.shown}
      maxLength={NEXT_MAX}
      placeholder="What's next?"
      aria-label={label}
      enterKeyHint="done"
      onFocus={() => setDraft(saved.shown)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        if (skip.current) {
          skip.current = false;
          setDraft(null);
          return;
        }
        void commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          skip.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * THE OWNERS LIST — the names every Owner drop-down offers (the `lead_owners` setting). A name is
 * typed and added; × takes one off (twice when somebody is still assigned to them — they keep the
 * name until it is changed). Each change is built from the newest list when its turn comes, so two
 * quick adds both land.
 */
export function OwnersSheet({
  open,
  onClose,
  owners,
  assigned,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  owners: string[];
  /** How many people each name looks after. */
  assigned: Record<string, number>;
  /** Resolves with the route's answer once the list is on screen; null when it failed. */
  onSave: (build: (list: string[]) => string[]) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [adding, runAdd] = usePending();
  const [rowPending, runRow] = usePendingKeys();
  const [armed, setArmed] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  /* An armed × lets go after a moment, like every other press-twice in the control room. */
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3500);
    return () => clearTimeout(t);
  }, [armed]);

  const add = () =>
    void runAdd(async () => {
      const n = name.replace(/\s+/g, " ").trim().slice(0, OWNER_MAX);
      if (!n) return;
      if (owners.some((o) => o.toLowerCase() === n.toLowerCase())) {
        setNote(`${n} is already on the list.`);
        return;
      }
      if (owners.length >= OWNERS_MAX) {
        setNote(`The list holds up to ${OWNERS_MAX} names.`);
        return;
      }
      setNote("");
      if ((await onSave((list) => [...list, n])) !== null) {
        setName("");
        input.current?.focus();
      }
    });
  const remove = (n: string) => {
    if ((assigned[n] ?? 0) > 0 && armed !== n) {
      setArmed(n);
      return;
    }
    setArmed(null);
    void runRow(n, () => onSave((list) => list.filter((o) => o !== n)));
  };

  return (
    <Sheet open={open} onClose={onClose} kicker="OWNERS" title="Who looks after your leads" className="own">
      <p className="own-line">These names fill every Owner drop-down in Lead management.</p>
      <form
        className="own-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          ref={input}
          className="fld"
          value={name}
          maxLength={OWNER_MAX}
          placeholder="A name, e.g. Basma"
          aria-label="Owner's name"
          autoFocus
          onChange={(e) => {
            setName(e.target.value);
            if (note) setNote("");
          }}
        />
        <Btn tone="primary" pending={adding} disabled={!name.trim()} onClick={add} data-action="add-owner">
          Add
        </Btn>
      </form>
      {note ? (
        <p className="own-note" role="alert">
          {note}
        </p>
      ) : null}
      {owners.length ? (
        <ul className="own-list">
          <AnimatePresence initial={false}>
            {owners.map((n) => {
              const count = assigned[n] ?? 0;
              return (
                <motion.li
                  key={n}
                  layout="position"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={spring.smooth}
                >
                  <b>{n}</b>
                  <span>{count ? `${count} ${count === 1 ? "lead" : "leads"}` : "No leads yet"}</span>
                  <button
                    type="button"
                    className={cx("own-x", armed === n && "armed")}
                    onClick={() => remove(n)}
                    aria-busy={rowPending(n) ? true : undefined}
                    aria-label={armed === n ? `Tap again to take ${n} off the list` : `Take ${n} off the list`}
                    title={count ? `They keep ${n} as their owner until you change it` : `Take ${n} off the list`}
                  >
                    {armed === n ? "Tap again" : "×"}
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="own-empty">No names yet. Add the people on your team who follow up with leads.</p>
      )}
      <div className="own-foot">
        <Btn onClick={onClose}>Done</Btn>
      </div>
    </Sheet>
  );
}
