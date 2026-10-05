"use client";

import { useEffect, useRef, useState } from "react";

import { markLeaving, sameCoords } from "@/components/admin/people/bits";
import { draftOf, PersonFields, type PersonDraft } from "@/components/admin/people/PersonForm";
import type { PersonPatch } from "@/components/admin/people/types";
import { Btn, LinkBtn, usePending } from "@/components/admin/ui";
import { personFraming, type AdminPerson } from "@/lib/admin/model";
import { pclFor } from "@/lib/design/cib";
import { roleFraming } from "@/lib/faceFraming";

/**
 * EDIT THEIR DETAILS — the person drawer's second face (PersonView). The same
 * form as Add someone (components/admin/people/PersonForm.tsx): their photo
 * circle, then name, title, LinkedIn, member or host, and the code. A bar at the
 * bottom stays in reach: Remove, Cancel, Save.
 *
 * The save is a DIRTY-KEY PATCH, which matters more than it looks: the route
 * reads presence rather than truthiness, so a form that posted all its fields
 * unconditionally would clear things the host never touched. The editor
 * snapshots the person it opened on and `saveEdit` diffs against that snapshot.
 *
 * Remove arms twice, like every destructive control in this admin, and closes
 * the drawer with them: they are off the list (People › Removed brings them back).
 *
 * WAITING ON THE DATABASE (§15.4): Save turns until the saved person is on screen
 * and only then folds back to their profile, which already shows the new details;
 * a failed save keeps the editor open with the draft and says why in the drawer.
 * Remove fades their card out on People as the drawer closes, and brings it back
 * if the removal failed.
 */
export function RowEditor({
  person,
  lastError,
  onSave,
  onClose,
  onRemove,
  onDismiss,
}: {
  person: AdminPerson;
  lastError: string;
  /** Resolves once the saved person is on screen; null when it failed. */
  onSave: (id: string, patch: PersonPatch) => Promise<unknown>;
  /** Leave the editor: Cancel, or after Save. */
  onClose: () => void;
  onRemove: (id: string) => Promise<unknown>;
  /** Close the whole drawer. */
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState<PersonDraft>(() => draftOf(person));
  const [nameInvalid, setNameInvalid] = useState(false);
  const [saving, runSave] = usePending();
  const [failed, setFailed] = useState(false);
  const set = (patch: Partial<PersonDraft> | ((d: PersonDraft) => Partial<PersonDraft>)) =>
    setDraft((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) }));

  /**
   * The values the editor opened with. saveEdit diffs against this rather than
   * posting the whole form, because the route writes every key it is sent.
   * Captured once: a refresh landing new snapshot rows mid-edit must not move
   * the baseline the diff is measured from.
   */
  const original = useRef<AdminPerson>(person);

  // design:507-508 is where this admin's arm-twice grammar comes from.
  const [armed, setArmed] = useState(false);
  const armT = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (armT.current) clearTimeout(armT.current);
    },
    [],
  );

  /** Send the keys the host changed, and only those. */
  function saveEdit() {
    const before = original.current;
    const name = draft.name.trim();
    if (!name) {
      setNameInvalid(true);
      return;
    }

    const patch: PersonPatch = {};
    if (name !== before.name) patch.name = name;

    const title = draft.title.trim();
    if (title !== (before.rawTitle ?? "")) patch.title = title || null;

    const li = draft.li.trim();
    if (li !== before.li) patch.li = li || null;

    if (draft.role !== before.role) patch.role = draft.role;

    const code = draft.code.trim();
    if (code !== (before.code ?? "")) patch.code = code || null;

    // Three states: replaced (a data URL or a link), removed (null), or left alone (absent).
    if (draft.upload.trim()) patch.photo = draft.upload.trim();
    else if (draft.link.trim()) patch.photo = draft.link.trim();
    else if (draft.dropPhoto) patch.photo = null;

    /*
     * Framing writes NULL for "back to the role default" and values otherwise —
     * and null is what null MEANS everywhere else, so RECENTRE genuinely undoes
     * rather than storing a numerically-equal-but-differently-rendered copy of
     * the default (the two branches of faceStyle are not the same CSS).
     *
     * The default is taken from the draft's role, not the stored one: flipping
     * HOST/MEMBER changes what "default" is, and a person sitting on the old
     * role's default should land on the new one's.
     */
    const wasFrame = personFraming(before);
    const atDefault = sameCoords(draft.frame, roleFraming(draft.role));
    const wantAligned = draft.frame.aligned && !atDefault;
    if (wantAligned !== wasFrame.aligned || (wantAligned && !sameCoords(draft.frame, wasFrame))) {
      patch.photoX = wantAligned ? draft.frame.x : null;
      patch.photoY = wantAligned ? draft.frame.y : null;
      patch.photoZoom = wantAligned ? draft.frame.zoom : null;
    }

    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    void runSave(async () => {
      setFailed(false);
      if ((await onSave(person.id, patch)) === null) {
        setFailed(true);
        return;
      }
      onClose();
    });
  }

  function onDelete() {
    if (saving) return;
    if (!armed) {
      setArmed(true);
      if (armT.current) clearTimeout(armT.current);
      // A destructive control should not stay armed across a distraction at a live event.
      armT.current = setTimeout(() => setArmed(false), 3500);
      return;
    }
    if (armT.current) clearTimeout(armT.current);
    setArmed(false);
    const id = person.id;
    markLeaving(id, true);
    void onRemove(id).then(() => markLeaving(id, false));
    onDismiss();
  }

  return (
    <div className="pv-form">
      <div className="pv-formbar">
        <span className="pv-kick">Edit their details</span>
        <LinkBtn onClick={onDismiss}>Close</LinkBtn>
      </div>

      <div className="pv-formbody">
        <PersonFields
          draft={draft}
          set={(patch) => {
            set(patch);
            setNameInvalid(false);
          }}
          stored={person.photo}
          tint={pclFor(person.id)}
          nameInvalid={nameInvalid}
          codePlaceholder="None"
          keyLine={person.slug}
        />
      </div>

      {failed ? (
        <div className="wrn line" role="alert" style={{ margin: "0 22px 10px" }}>
          {lastError || "That did not save."} Your changes are still here — press Save to try again.
        </div>
      ) : null}
      <div className="pv-foot">
        <Btn
          sm
          tone="care"
          armed={armed}
          onClick={onDelete}
          data-guide="Press twice: takes them off the list; nothing of theirs is deleted and Lead management › Removed brings them back."
        >
          {armed ? "Tap again to remove" : "Remove"}
        </Btn>
        <span className="grow" />
        <Btn onClick={onClose}>Cancel</Btn>
        <Btn tone="primary" onClick={saveEdit} pending={saving} data-action="save-person">
          Save
        </Btn>
      </div>
    </div>
  );
}
