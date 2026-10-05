"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { sameCoords } from "@/components/admin/people/bits";
import { emptyDraft, PersonFields, type PersonDraft } from "@/components/admin/people/PersonForm";
import type { NewPerson } from "@/components/admin/people/types";
import { Btn, usePending } from "@/components/admin/ui";
import { roleFraming } from "@/lib/faceFraming";
import { spring } from "@/lib/motion";

/**
 * Add one person — the "One person" tab of Add someone (AddDrawer). The same
 * form the person drawer edits with (PersonForm): their photo circle in the
 * middle, then name, title, LinkedIn, member or host, the code. ADD goes to
 * /api/admin/people, which owns the slug, the verify code and the photo upload
 * — see that route for why those three cannot be done in the browser.
 *
 * The form clears after each add, with a line saying who went on the list, so
 * a host can add a row of walk-ins without closing anything. It clears only once
 * the server has them (the button turns until then); a failed add keeps the
 * draft and says why here, not behind the drawer.
 */

/**
 * A new person's circle in the brand blue: their own colour comes from an id
 * the server has not made yet. The string is pclFor's for CIB Blue.
 */
const NEW_FACE_TINT = "var(--face-blue, var(--color-cib-blue))";

export function AddPersonCard({ lastError, onAdd }: { lastError: string; onAdd: (person: NewPerson) => Promise<unknown> }) {
  const [draft, setDraft] = useState<PersonDraft>(emptyDraft);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [added, setAdded] = useState<{ name: string; n: number } | null>(null);
  const [adding, runAdd] = usePending();
  const [failed, setFailed] = useState(false);
  const set = (patch: Partial<PersonDraft> | ((d: PersonDraft) => Partial<PersonDraft>)) => {
    setDraft((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) }));
    setNameInvalid(false);
    setFailed(false);
  };

  /* The ✓ line goes after a moment; a new add restarts it. */
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(null), 3200);
    return () => clearTimeout(t);
  }, [added]);

  /** design:485-492 */
  function addPerson() {
    const name = draft.name.trim();
    if (!name) {
      setNameInvalid(true);
      return;
    }
    // Dragged back to exactly the default counts as never aligned, so a new
    // person is stored the same way everyone else is.
    const aligned = draft.frame.aligned && !sameCoords(draft.frame, roleFraming(draft.role));
    const person: NewPerson = {
      name,
      title: draft.title.trim(),
      li: draft.li.trim(),
      photo: draft.upload.trim() || draft.link.trim(),
      role: draft.role,
      code: draft.code.trim(),
      // Untouched framing stays NULL, so this person is "use the role default"
      // like everybody else rather than carrying a redundant 50/50/1.
      photoX: aligned ? draft.frame.x : null,
      photoY: aligned ? draft.frame.y : null,
      photoZoom: aligned ? draft.frame.zoom : null,
    };
    void runAdd(async () => {
      setFailed(false);
      if ((await onAdd(person)) === null) {
        setFailed(true);
        return;
      }
      setDraft(emptyDraft());
      setAdded((a) => ({ name, n: (a?.n ?? 0) + 1 }));
    });
  }

  return (
    <>
      <div className="pv-formbody">
        <PersonFields draft={draft} set={set} tint={NEW_FACE_TINT} nameInvalid={nameInvalid} codePlaceholder="Auto" />
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
              {lastError || "That did not save."} Nothing was added.
            </motion.span>
          ) : added ? (
            <motion.span
              key={added.n}
              className="ppl-done"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, transition: spring.smooth }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
            >
              {added.name} is on the list
            </motion.span>
          ) : null}
        </AnimatePresence>
        <span className="grow" />
        <Btn
          tone="primary"
          onClick={addPerson}
          pending={adding}
          data-action="add-person"
          data-guide="Puts them on this event's list; the form clears for the next one."
        >
          Add to the event
        </Btn>
      </div>
    </>
  );
}
