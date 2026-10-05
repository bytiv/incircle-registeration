"use client";

import { AnimatePresence, motion } from "motion/react";

import { spring } from "@/lib/motion";

import type { SaveState } from "./useAutosave";

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
 *   ● Saved           edits save themselves as they are made; a failed save says so and retries
 *   Control room      the people, the approvals, the seats
 *
 * After something is taken off the page (a paragraph, a card, a photo) it says so here, with Undo.
 */
export function AdminBar({
  mode,
  onMode,
  live,
  save,
  onRetry,
  notice,
}: {
  mode: SiteMode;
  onMode: (mode: SiteMode) => void;
  live: boolean;
  save: SaveState;
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

      <a className="st-bar-link" href="/admin">
        Control room
      </a>
    </div>
  );
}
