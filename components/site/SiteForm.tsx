"use client";

/* eslint-disable @next/next/no-img-element -- the visitor's own photo, a data URL preview */

import { AnimatePresence, motion, Reorder, useDragControls } from "motion/react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { readUploadDataUrl } from "@/components/admin/people/bits";
import { Tx } from "@/components/moments/ui/Tx";
import { cx } from "@/components/ui/cx";
import { spring } from "@/lib/motion";
import { LOCKED_FIELDS, REG_FIELD_KEYS, type RegFieldKey } from "@/lib/regFields";
import type { SitePage } from "@/lib/sitePage";

import { Arrow, Calendar, Check, Person } from "./icons";

const line = (en: string) => ({ en, ar: "" });
/** Full name and job title share a row on a wide form; so does the company. */
const half = (key: RegFieldKey) => key === "name" || key === "title" || key === "company";
const locked = (key: RegFieldKey) => LOCKED_FIELDS.includes(key);
/** What a field is called when its label is empty (the "+ Add a field" chips, the errors). */
const NAMES: Record<RegFieldKey, string> = {
  name: "Full name",
  title: "Job title",
  phone: "Phone",
  email: "Email",
  linkedin: "LinkedIn",
  company: "Company",
  photo: "Photo",
  attendee: "First time / attended before",
};
const TYPES: Partial<Record<RegFieldKey, string>> = { email: "email", phone: "tel", linkedin: "url" };
const AUTO: Partial<Record<RegFieldKey, string>> = {
  name: "name",
  email: "email",
  phone: "tel",
  title: "organization-title",
  company: "organization",
  linkedin: "url",
};

type Props = {
  content: SitePage;
  /** The fields the form shows, in its order (`reg_fields`). */
  fields: RegFieldKey[];
  editing: boolean;
  /** The event is on the public page: the form takes sign-ups. */
  open: boolean;
  full: boolean;
  onFields: (next: RegFieldKey[]) => void;
  onRequired: (key: RegFieldKey, required: boolean) => void;
};

/**
 * THE REGISTRATION FORM — the card the whole page leads to (`#register`).
 *
 * For visitors: the fields in the host's order, each label inside its field and lifting out of the
 * way as it is typed into (the hint shows once the field is in use), the few optional ones marked
 * "Optional" (no stars), large fields that never make a phone zoom, the one choice as two tiles,
 * the photo as a face with a button, and the ramp button. A field with a problem says so under
 * itself. It posts to app/api/register (which checks the same rules), a spinner in the button
 * while it does, and turns into the thank-you in place (its check draws itself); a full circle
 * takes them first in line; a closed page shows its closed line instead.
 *
 * In edit mode the same form becomes its own editor: each field a card that can be held and
 * dragged into place (or moved with Alt+↑/↓), its label and its hint typed into where they
 * show, a Required switch, Hide (name and email always stay), and "+ Add a field" for the ones
 * hidden. The button's words are typed into the button.
 */
export function SiteForm(props: Props) {
  return props.editing ? <FormEditor {...props} /> : <VisitorForm {...props} />;
}

/* ------------------------------------------------------------- for visitors */

/** A plain email shape: something@something.something (the route checks the same, lib/registration.ts). */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Each field's own message, shown under it. */
type Errors = Partial<Record<RegFieldKey, string>>;

function VisitorForm({ content, fields, open, full }: Props) {
  const [v, setV] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [done, setDone] = useState<{ waitlist: boolean } | null>(null);
  const fileEl = useRef<HTMLInputElement | null>(null);
  const formEl = useRef<HTMLFormElement | null>(null);

  if (!open) {
    return (
      <div className="st-card st-closed" id="register">
        <div className="st-closed-mark" aria-hidden>
          <Calendar />
        </div>
        <h3>{content.join.closed}</h3>
      </div>
    );
  }

  if (done) {
    return (
      <div className="st-card st-done" role="status" id="register">
        <div className="st-done-mark" aria-hidden>
          <Check />
        </div>
        <h3>{done.waitlist ? "You're first in line" : content.join.thanks}</h3>
        <p>{done.waitlist ? "The circle is full right now. The moment a seat opens, we'll reach out to you." : content.join.thanksNote}</p>
        <button
          type="button"
          className="st-btn st-btn-glass st-btn-sm"
          onClick={() => {
            setDone(null);
            setV({});
            setPhoto("");
            setErrors({});
          }}
        >
          <span className="lbl">Register someone else</span>
        </button>
      </div>
    );
  }

  const labelOf = (k: RegFieldKey) => content.fields[k].label || NAMES[k];
  const clear = (k: RegFieldKey) => setErrors((m) => (m[k] ? { ...m, [k]: undefined } : m));
  const set = (k: RegFieldKey) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setV((s) => ({ ...s, [k]: e.target.value }));
    clear(k);
  };
  const focusField = (k: RegFieldKey) =>
    formEl.current?.querySelector<HTMLElement>(`[data-field="${k}"] input:not([type="file"]), [data-field="${k}"] button`)?.focus();

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      setPhoto(await readUploadDataUrl(f));
      clear("photo");
    } catch (err) {
      setErrors((m) => ({ ...m, photo: err instanceof Error ? err.message : "That photo could not be read." }));
    }
  }

  /** The page's own rules, checked here first (the route checks them again). */
  const check = (): Errors => {
    const out: Errors = {};
    for (const k of fields) {
      const f = content.fields[k];
      if (k === "photo") {
        if (f.required && !photo) out.photo = "Add a photo to continue.";
        continue;
      }
      if (k === "attendee") {
        if (f.required && !v.attendee) out.attendee = "Choose one.";
        continue;
      }
      const value = (v[k] ?? "").trim();
      if (!value) {
        if (f.required) out[k] = `${labelOf(k)} is required.`;
      } else if (k === "email" && !EMAIL.test(value)) {
        out.email = "Enter a valid email address.";
      }
    }
    return out;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const found = check();
    const first = fields.find((k) => found[k]);
    if (first) {
      setErrors(found);
      setError("");
      focusField(first);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, photo: photo || undefined, website }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; waitlist?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        const message = body.error ?? "That did not go through. Please try again.";
        // Already on the list: that is the email field's to say.
        if (res.status === 409) {
          setErrors({ email: message });
          focusField("email");
        } else {
          setError(message);
        }
        return;
      }
      setDone({ waitlist: !!body.waitlist });
      formEl.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setError("That did not go through. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const optional = (key: RegFieldKey) => (content.fields[key].required ? null : <span className="st-optional">Optional</span>);
  const note = (key: RegFieldKey, id: string) =>
    errors[key] ? (
      <p className="st-ferr" id={id} role="alert">
        {errors[key]}
      </p>
    ) : null;

  const field = (key: RegFieldKey): ReactNode => {
    const f = content.fields[key];
    const id = `st_${key}`;
    if (key === "attendee") {
      return (
        <fieldset key={key} className="st-field" data-field={key}>
          {f.label ? (
            <legend className="st-label">
              {f.label}
              {optional(key)}
            </legend>
          ) : (
            <legend className="st-sr">{NAMES.attendee}</legend>
          )}
          <div className={cx("st-options", errors.attendee && "bad")}>
            {(["first", "returning"] as const).map((k) => (
              <label key={k} className="st-option">
                <input
                  type="radio"
                  name="attendee"
                  value={k}
                  checked={v.attendee === k}
                  onChange={() => {
                    setV((s) => ({ ...s, attendee: k }));
                    clear("attendee");
                  }}
                />
                <span className="st-tick" aria-hidden>
                  <Check />
                </span>
                {content.attendee[k]}
              </label>
            ))}
          </div>
          {note(key, `${id}_e`)}
        </fieldset>
      );
    }
    if (key === "photo") {
      return (
        <div key={key} className="st-field" data-field={key}>
          <div className={cx("st-photo", errors.photo && "bad")}>
            <span className="st-face" aria-hidden>
              {photo ? <img src={photo} alt="" /> : <Person />}
            </span>
            <span className="st-photo-txt">
              <b>
                {labelOf(key)}
                {optional(key)}
              </b>
              {f.placeholder ? <small>{f.placeholder}</small> : null}
            </span>
            <button type="button" className="st-btn st-btn-glass st-btn-sm" onClick={() => fileEl.current?.click()}>
              <span className="lbl">{photo ? "Change" : "Add photo"}</span>
            </button>
            <input ref={fileEl} type="file" accept="image/*" onChange={onPhotoPicked} hidden />
          </div>
          {note(key, `${id}_e`)}
        </div>
      );
    }
    return (
      <div key={key} className={cx("st-field", half(key) && "half")} data-field={key}>
        <div className="st-float">
          <input
            id={id}
            className="st-input"
            type={TYPES[key] ?? "text"}
            dir={TYPES[key] ? "ltr" : "auto"}
            inputMode={key === "phone" ? "tel" : key === "email" ? "email" : undefined}
            autoComplete={AUTO[key] ?? "off"}
            // A space when the host left the hint empty: the label's lift reads the placeholder.
            placeholder={f.placeholder || " "}
            value={v[key] ?? ""}
            onChange={set(key)}
            onBlur={
              key === "email"
                ? (e) => {
                    const value = e.target.value.trim();
                    if (value && !EMAIL.test(value)) setErrors((m) => ({ ...m, email: "Enter a valid email address." }));
                  }
                : undefined
            }
            required={f.required}
            aria-invalid={errors[key] ? true : undefined}
            aria-describedby={errors[key] ? `${id}_e` : undefined}
          />
          <label htmlFor={id}>
            {labelOf(key)}
            {optional(key)}
          </label>
        </div>
        {note(key, `${id}_e`)}
      </div>
    );
  };

  return (
    <form ref={formEl} id="register" className="st-card st-form" onSubmit={submit} noValidate>
      {full ? <p className="st-note">{content.join.full}</p> : null}
      <div className="st-fields">{fields.map(field)}</div>

      {/* The honeypot — off-screen, never labelled, a bot's favourite field. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: -9999, width: 1, height: 1, opacity: 0 }}
      />

      {error ? (
        <p className="st-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="st-btn st-btn-commit st-submit" aria-busy={busy || undefined}>
        {busy ? (
          <span className="st-spin" role="img" aria-label="Sending" />
        ) : (
          <>
            <span className="lbl">{full ? "Put me first in line" : content.join.cta}</span>
            <Arrow className="arr" />
          </>
        )}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------- in edit mode */

function FormEditor({ content, fields, open, onFields, onRequired }: Props) {
  /* While a field is held, the order lives here; it is saved once, when the field is let go. */
  const [held, setHeld] = useState<RegFieldKey[] | null>(null);
  const heldRef = useRef<RegFieldKey[] | null>(null);
  const order = held ?? fields;
  const hidden = REG_FIELD_KEYS.filter((k) => !order.includes(k));
  const letGo = () => {
    const next = heldRef.current;
    heldRef.current = null;
    setHeld(null);
    if (next && next.join() !== fields.join()) onFields(next);
  };
  const move = (key: RegFieldKey, by: -1 | 1) => {
    const i = fields.indexOf(key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= fields.length) return;
    const next = [...fields];
    [next[i], next[j]] = [next[j], next[i]];
    onFields(next);
  };

  const body = (key: RegFieldKey): ReactNode => {
    const f = content.fields[key];
    const top = (
      <div className="st-frow-top">
        <span className="st-grip" aria-hidden title="Hold to move">
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
            <circle cx="2.5" cy="2.5" r="1.6" />
            <circle cx="7.5" cy="2.5" r="1.6" />
            <circle cx="2.5" cy="8" r="1.6" />
            <circle cx="7.5" cy="8" r="1.6" />
            <circle cx="2.5" cy="13.5" r="1.6" />
            <circle cx="7.5" cy="13.5" r="1.6" />
          </svg>
        </span>
        <span className="st-kind">{NAMES[key]}</span>
        {locked(key) ? (
          <span className="st-chip on" data-nodrag title="Name and email are the key of a sign-up">
            Always required
          </span>
        ) : (
          <>
            <button
              type="button"
              className={cx("st-chip", f.required && "on")}
              data-nodrag
              aria-pressed={f.required}
              onClick={() => onRequired(key, !f.required)}
              title={f.required ? "Visitors must fill it in. Press to make it optional." : "Optional. Press to make it required."}
            >
              {f.required ? "✓ Required" : "Optional"}
            </button>
            <button type="button" className="st-chip warm" data-nodrag onClick={() => onFields(fields.filter((k) => k !== key))} title="Take this field off the form">
              Hide
            </button>
          </>
        )}
      </div>
    );
    if (key === "photo") {
      return (
        <>
          {top}
          <div className="st-photo">
            <span className="st-face" aria-hidden>
              <Person />
            </span>
            <span className="st-photo-txt">
              <b>
                <Tx text={line(f.label)} path="fields.photo.label" placeholder="+ Your photo" />
              </b>
              <Tx as="small" text={line(f.placeholder)} path="fields.photo.placeholder" placeholder="+ Add a line under it" />
            </span>
            <span className="st-btn st-btn-glass st-btn-sm" aria-hidden>
              <span className="lbl">Add photo</span>
            </span>
          </div>
        </>
      );
    }
    if (key === "attendee") {
      return (
        <>
          {top}
          <p className="st-label">
            <Tx text={line(f.label)} path="fields.attendee.label" placeholder="+ Add a question (optional)" />
          </p>
          <div className="st-options">
            {(["first", "returning"] as const).map((k) => (
              <span key={k} className="st-option">
                <span className="st-tick" aria-hidden />
                <Tx text={line(content.attendee[k])} path={`attendee.${k}`} placeholder="+ An option" />
              </span>
            ))}
          </div>
        </>
      );
    }
    return (
      <>
        {top}
        <div className="st-fake">
          <span className="st-fake-label">
            <Tx text={line(f.label)} path={`fields.${key}.label`} placeholder={`+ ${NAMES[key]}`} />
            {f.required ? null : <span className="st-optional">Optional</span>}
          </span>
          <span className="st-fake-hint">
            <Tx text={line(f.placeholder)} path={`fields.${key}.placeholder`} placeholder="+ Add a hint" />
          </span>
        </div>
      </>
    );
  };

  return (
    <div id="register" className="st-card st-form">
      {!open ? (
        <p className="st-editnote">
          Registration is closed right now, so visitors see “{content.join.closed}” here. Publish the page from the control room to open the form.
        </p>
      ) : null}
      <Reorder.Group
        as="div"
        axis="y"
        values={order}
        onReorder={(next: RegFieldKey[]) => {
          heldRef.current = next;
          setHeld(next);
        }}
        className="st-frows"
      >
        <AnimatePresence initial={false}>
          {order.map((key) => (
            <FieldRow key={key} field={key} label={content.fields[key].label || NAMES[key]} onMove={(by) => move(key, by)} onLetGo={letGo}>
              {body(key)}
            </FieldRow>
          ))}
        </AnimatePresence>
      </Reorder.Group>
      {hidden.length ? (
        <motion.div layout="position" transition={spring.smooth} className="st-addfields">
          <span>Add a field</span>
          {hidden.map((k) => (
            <button key={k} type="button" className="st-chip" onClick={() => onFields([...fields, k])}>
              + {content.fields[k].label || NAMES[k]}
            </button>
          ))}
        </motion.div>
      ) : null}
      <div className="st-btn st-btn-commit st-submit" role="presentation">
        <Tx className="lbl" text={line(content.join.cta)} path="join.cta" placeholder="+ The button" />
        <Arrow className="arr" />
      </div>
    </div>
  );
}

/**
 * One field in the editor: held anywhere (a mouse or a pen; on a touch screen, its grip) it
 * lifts and moves, the others make room, and it settles where it is let go. Its words still take
 * the caret and its buttons still press. Focused, Alt+↑/↓ moves it.
 */
function FieldRow({
  field,
  label,
  onMove,
  onLetGo,
  children,
}: {
  field: RegFieldKey;
  label: string;
  onMove: (by: -1 | 1) => void;
  onLetGo: () => void;
  children: ReactNode;
}) {
  const drag = useDragControls();
  const [lifted, setLifted] = useState(false);
  return (
    <Reorder.Item
      as="div"
      value={field}
      data-field={field}
      className={cx("st-frow", lifted && "lifted")}
      tabIndex={0}
      aria-label={`${label}. Drag it, or press Alt with an arrow key, to move it.`}
      dragListener={false}
      dragControls={drag}
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
      transition={spring.smooth}
      whileDrag={{ scale: 1.02 }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        // Words take the caret and buttons do their own thing; a finger scrolls unless it holds the grip.
        if (target.closest(".mo-ed, [data-nodrag], button")) return;
        if (e.pointerType === "touch" && !target.closest(".st-grip")) return;
        drag.start(e);
      }}
      onDragStart={() => setLifted(true)}
      onDragEnd={() => {
        setLifted(false);
        onLetGo();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        onMove(e.key === "ArrowUp" ? -1 : 1);
      }}
    >
      {children}
    </Reorder.Item>
  );
}
