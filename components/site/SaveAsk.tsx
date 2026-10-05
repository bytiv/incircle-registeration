"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";

import { spring } from "@/lib/motion";

export type Ask = "save" | "discard";

/**
 * THE QUESTION BEFORE THE PAGE CHANGES — the page is public, so nothing the host edits goes
 * out until they have said so here. Save puts the edits on the page for every visitor;
 * Discard throws them away and puts the page back to what is stored. Escape or the scrim
 * answers "not now".
 */
export function SaveAsk({ ask, busy, onClose, onGo }: { ask: Ask | null; busy: boolean; onClose: () => void; onGo: (ask: Ask) => void }) {
  const go = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!ask) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    go.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [ask, busy, onClose]);

  return (
    <AnimatePresence>
      {ask ? (
        <motion.div
          key="ask"
          className="st-ask"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => {
            if (!busy) onClose();
          }}
        >
          <motion.div
            className="st-ask-box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="st-ask-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={spring.gentle}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="st-eyebrow">{ask === "save" ? "The page is public" : "Your changes"}</p>
            <h3 id="st-ask-title">{ask === "save" ? "Save the changes to the page?" : "Discard your changes?"}</h3>
            <p className="st-ask-note">
              {ask === "save" ? "Every visitor sees the page as you have it now, right away." : "The page goes back to what is saved. What you changed is lost."}
            </p>
            <div className="st-ask-acts">
              <button type="button" className="st-btn st-btn-glass st-btn-sm" disabled={busy} onClick={onClose}>
                <span className="lbl">Not now</span>
              </button>
              <button ref={go} type="button" className={ask === "save" ? "st-btn st-btn-commit st-btn-sm" : "st-btn st-btn-danger st-btn-sm"} disabled={busy} onClick={() => onGo(ask)}>
                <span className="lbl">{busy ? "Saving…" : ask === "save" ? "Save" : "Discard"}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
