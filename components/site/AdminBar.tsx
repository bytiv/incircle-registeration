"use client";

import { AnimatePresence, motion } from "motion/react";

import { spring } from "@/lib/motion";

import type { SaveState } from "./useDraft";

export type SiteMode = "preview" | "edit";

/** Something just taken off the page, offered back for a few seconds. */
export type Notice = { text: string; undo: () => void };

const MODES: { id: SiteMode; label: string }[] = [
  { id: "preview", label: "Preview" },
  { id: "edit", label: "Edit" },
];

/**
 * THE HOST'S BAR — only ever drawn for a signed-in host (app/page.tsx checks the passcode
 * cookie on the server). A dark pill at the bottom of the page:
 *
 *   ● Live            whether visitors can register right now (the control room publishes)
 *   Preview | Edit    the page exactly as a visitor sees it, or every part of it editable
 *   ● Saved           nothing waiting — or "Unsaved changes" with Discard and Save: the page is
 *                     public, so no edit goes out until the host has pressed Save and confirmed
 *                     (SaveAsk). A failed save says so and offers Retry.
 *   Control room      the people, the approvals, the seats
 *
 * After something is taken off the page (a paragraph, a card, a photo) it says so here, with Undo.
 */
export function AdminBar({
  mode,
  onMode,
  live,
  save,
  onSave,
  onDiscard,
  onRetry,
  notice,
}: {
  mode: SiteMode;
  onMode: (mode: SiteMode) => void;
  live: boolean;
  save: SaveState;
  /** Save: asks first. */
  onSave: () => void;
  /** Discard: asks first. */
  onDiscard: () => void;
  /** Retry: sends again what was already confirmed. */
  onRetry: () => void;
  notice: Notice | null;
}) {
  return (
    <div className="st-bar" role="toolbar" aria-label="Your page">
      <span className="st-bar-who" title={live ? "Visitors can register now" : "Visitors see “registration opens soon”. Publish it from the control room."}>
        <i className={live ? undefined : "off"} aria-hidden />
        <span>{live ? "Live" : "Not published"}</span>
      </span>

      <div className="st-seg" role="radiogroup" aria-label="How the page shows">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            className={mode === m.id ? "on" : undefined}
            onClick={() => onMode(m.id)}
          >
            {mode === m.id ? <motion.span layoutId="st-seg-thumb" className="thumb" transition={spring.snappy} /> : null}
            <span className="tl">{m.label}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="popLayout" initial={false}>
        {notice ? (
          <motion.span
            key="notice"
            className="st-bar-save"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring.snappy}
            role="status"
          >
            <span>{notice.text}</span>
            <button type="button" onClick={notice.undo}>
              Undo
            </button>
          </motion.span>
        ) : (
          <motion.span
            key={save}
            className="st-bar-save"
            data-state={save}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={spring.snappy}
            role="status"
            aria-live="polite"
          >
            <i aria-hidden />
            {save === "saving" ? <span>Saving…</span> : null}
            {save === "saved" ? <span>Saved</span> : null}
            {save === "unsaved" ? (
              <>
                <span>Unsaved changes</span>
                <button type="button" onClick={onDiscard}>
                  Discard
                </button>
              </>
            ) : null}
            {save === "failed" ? (
              <>
                <span>Not saved</span>
                <button type="button" onClick={onRetry}>
                  Retry
                </button>
              </>
            ) : null}
            {save === "signedout" ? (
              <>
                <span>Signed out</span>
                <a href="/admin" target="_blank" rel="noopener" title="Sign in in a new tab, then come back and press Retry">
                  Sign in
                </a>
                <button type="button" onClick={onRetry}>
                  Retry
                </button>
              </>
            ) : null}
          </motion.span>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {save === "unsaved" ? (
          <motion.button
            key="save"
            type="button"
            className="st-bar-go"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={spring.snappy}
            onClick={onSave}
          >
            Save
          </motion.button>
        ) : null}
      </AnimatePresence>

      <a className="st-bar-link" href="/admin">
        Control room
      </a>
    </div>
  );
}
