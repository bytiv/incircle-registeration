"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence } from "motion/react";

import { Reveal, Skeleton } from "@/components/admin/ui";
import { OverlayLayer } from "@/components/ui/Overlay";

/**
 * The serious confirmation. One sheet, shared by every control that ends or
 * erases a run.
 *
 * NOT FROM THE DESIGN. The prototype's destructive controls asked twice —
 * `confirmRestart` / `confirmReset`, a label that changes to "TAP AGAIN…" and a
 * timer that disarms after a few seconds. That is the right weight for a
 * prototype whose RESET only cleared a few localStorage keys. Against a real
 * database, RESTART THE ROOM and RESET EVENT DATA delete an evening's work, and
 * two taps in the same spot is a gesture a sleeve can make. Worse, an ARMED
 * button is a trap left lying around: the host arms it, someone speaks to them,
 * and the next tap — aimed at the label they think they are reading — wipes the
 * room.
 *
 * So the ask is explicit instead of repeated:
 *
 *   - it says what will happen, in words, before anything happens;
 *   - it puts the REAL numbers on the screen (counted server-side by
 *     lib/admin/impact.ts, before any write) so "this clears the run" is
 *     "this clears 14 people's answers";
 *   - and it cannot be dismissed into an action: the button unlocks only when
 *     the host has typed the word. Nothing about that can happen by accident.
 *
 * The sheet is the ceremony, not the gate. The routes refuse the same actions
 * without `confirm: true` regardless of what the browser did — see
 * app/api/admin/state/route.ts and app/api/admin/reset/route.ts.
 *
 * While the confirmed action runs (`busy`) the button keeps its fill and its
 * size, and the kit's turning ring takes the label's place (ui.tsx `Btn
 * pending`): it is working, not switched off. A second press does nothing. The
 * sheet leaves on the sheets' spring, showing what it last showed
 * (components/ui/Overlay.tsx `OverlayLayer`).
 */

/** The kit's pending look (`.btn.is-pending`, app/cib-premium.css) on the sheet's own button: the label goes see-through, so the size stays and the ring can take its colour. */
const WORKING: CSSProperties = { position: "relative", cursor: "progress", WebkitTextFillColor: "transparent" };
/** The kit's turning ring, where the label was. */
const RING: CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: 12,
  height: 12,
  margin: "-6px 0 0 -6px",
  borderRadius: "50%",
  border: "1.6px solid currentColor",
  borderRightColor: "transparent",
  animation: "evspin 0.7s linear infinite",
};

export type ConfirmSheetProps = {
  open: boolean;
  /** The small all-caps line above the title — "END THE EXPERIENCE". */
  kicker: string;
  title: string;
  blurb: string;
  /** What is at stake, counted before anything happens. Empty = nothing yet. */
  impact: { label: string; value: number }[];
  /**
   * The impact block's own heading and its empty line. Defaulted to the
   * room-level wording every wipe uses, and overridden by the one-person purge
   * in components/admin/AttendanceView.tsx — "in this run right now" is the
   * wrong frame for a single person's row, and "nothing recorded in this run"
   * would be read as "so there is nothing to lose" when the thing being
   * deleted is the person themselves.
   */
  impactLabel?: string;
  impactEmpty?: string;
  /** The word the host must type. Compared case-insensitively. */
  word: string;
  actionLabel: string;
  busy: boolean;
  /**
   * The numbers are still being counted (the dry run is on its way): the sheet opens at once with
   * a soft placeholder where they go, and they rise in when they land (§15.4). The action stays
   * locked until then. Absent: the numbers were there when it opened.
   */
  reading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** design:655-657 via components/admin/people/bits.tsx — the admin's text input. */
export function ConfirmSheet({
  open,
  kicker,
  title,
  blurb,
  impact,
  impactLabel = "IN THIS ROUND RIGHT NOW",
  impactEmpty = "Nothing has been recorded in this round yet.",
  word,
  actionLabel,
  busy,
  reading,
  onCancel,
  onConfirm,
}: ConfirmSheetProps) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  /*
   * Cleared on every open, never on close: a sheet that reopens still holding
   * the word from last time is a one-tap wipe wearing a confirmation's clothes.
   */
  useEffect(() => {
    if (!open) return;
    setTyped("");
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

  // Escape is the way out of anything modal; bound while open only.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  const unlocked = typed.trim().toUpperCase() === word.trim().toUpperCase();
  const ready = unlocked && !busy && !reading;

  const line = impact.length
    ? impact.map((i) => `${i.value} ${i.label}`).join(" · ")
    : impactEmpty;

  return (
    <AnimatePresence>
      {open ? (
        <OverlayLayer key="ask" leave="fade" className="ask" onClick={onCancel}>
          <OverlayLayer
            leave="drop"
            still
            className="box"
            role="dialog"
            aria-modal="true"
            aria-label={kicker}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480 }}
          >
            <div className="lb" style={{ color: "var(--color-danger)" }}>
              {kicker}
            </div>
            <b>{title}</b>
            <p>{blurb}</p>

            {/* The real numbers, counted server-side before anything happened. */}
            <div className="calc" style={{ display: "block", marginTop: 14 }}>
              <span>{impactLabel}</span>
              <div className="text-hint text-text-2" style={{ marginTop: 6, minHeight: "1.5em", fontVariantNumeric: "tabular-nums" }}>
                {reading === undefined ? line : reading ? <span style={{ display: "block", paddingTop: ".25em" }}><Skeleton height="1em" width="62%" /></span> : <Reveal>{line}</Reveal>}
              </div>
            </div>

            <label className="mini" htmlFor="confirm-word" style={{ marginTop: 16 }}>
              TYPE {word} TO UNLOCK
            </label>
            <input
              id="confirm-word"
              ref={inputRef}
              className="fld"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready) onConfirm();
              }}
              placeholder={`Type ${word} to unlock`}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              style={{ letterSpacing: 1, ...(unlocked ? { borderColor: "var(--color-destructive)" } : null) }}
            />

            <div className="aa">
              <button type="button" className="no" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="yes"
                onClick={busy ? undefined : onConfirm}
                disabled={(!unlocked || !!reading) && !busy}
                aria-busy={busy || undefined}
                style={busy ? WORKING : undefined}
              >
                {actionLabel}
                {busy ? <span aria-hidden style={RING} /> : null}
              </button>
            </div>
            <div className="text-meta text-muted" style={{ marginTop: 10, textAlign: "right" }}>
              Escape closes this.
            </div>
          </OverlayLayer>
        </OverlayLayer>
      ) : null}
    </AnimatePresence>
  );
}
