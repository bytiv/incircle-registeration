"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { Btn, usePending } from "@/components/admin/ui";
import { spring } from "@/lib/motion";

/**
 * Paste a list — the "A list" tab of Add someone (AddDrawer). One person per
 * line, a title after a comma; the parsing lives in /api/admin/people's "bulk"
 * action, which also owns the slugs and the entry codes.
 */
export function BulkAddCard({ lastError, onBulk }: { lastError: string; onBulk: (text: string) => Promise<unknown> }) {
  const [text, setText] = useState("");
  const [added, setAdded] = useState(0);
  const [failed, setFailed] = useState(false);
  const [adding, runAdd] = usePending();
  const n = text.split("\n").filter((l) => l.trim()).length;

  /** design:494-503 — the list clears, and the count shows, only once the server has them (its own count). */
  function addBulk() {
    if (!n) return;
    void runAdd(async () => {
      setFailed(false);
      const res = (await onBulk(text)) as { added?: number } | null;
      if (res === null) {
        setFailed(true);
        return;
      }
      setAdded(res.added ?? n);
      setText("");
    });
  }

  return (
    <>
      <div className="pv-formbody ppl-bulk">
        <p className="ppl-lead">One person per line, a title after a comma.</p>
        <textarea
          className="fld"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setAdded(0);
            setFailed(false);
          }}
          placeholder={"Sara Adel, Internal Comms Lead\nOmar Hany"}
          aria-label="People, one per line"
        />
      </div>
      <div className="pv-foot">
        <AnimatePresence>
          {failed ? (
            <motion.span
              key="failed"
              className="ppl-done"
              role="alert"
              style={{ color: "var(--color-danger)" }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, transition: spring.smooth }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
            >
              {lastError || "That did not save."} Nobody was added.
            </motion.span>
          ) : added ? (
            <motion.span
              key="done"
              className="ppl-done"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, transition: spring.smooth }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
            >
              {added} added to the list
            </motion.span>
          ) : null}
        </AnimatePresence>
        <span className="grow" />
        <Btn tone="primary" onClick={addBulk} pending={adding} disabled={!n && !adding} data-guide="Puts each line above on this event's list as one person.">
          {n ? `Add ${n} ${n === 1 ? "person" : "people"}` : "Add everyone"}
        </Btn>
      </div>
    </>
  );
}
