"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { PhotoAligner } from "@/components/admin/PhotoAligner";
import { RoleSwitch, readUploadDataUrl, sameCoords } from "@/components/admin/people/bits";
import { Btn } from "@/components/admin/ui";
import { initials, personFraming, type AdminPerson } from "@/lib/admin/model";
import { roleFraming, type FaceFraming } from "@/lib/faceFraming";
import { fold, spring } from "@/lib/motion";
import type { AttendeeRole } from "@/lib/supabase/types";

/**
 * THE PERSON FORM — one look for adding someone and for editing them (Belal,
 * 2026-09-29: "people should understand by the look of it, so the experience
 * doesn't look complex when somebody is editing or adding people").
 *
 * Their photo circle in the middle — the aligner itself, which is also the way
 * to add a photo — then the few fields, labelled in a word each. Everything the
 * old cards could do is here: upload or paste a link, line the face up, member
 * or host, the four-digit code, LinkedIn, the title. The parents own the draft
 * and what a save sends (AddPersonCard: a new person; RowEditor: only the keys
 * that changed).
 */

export type PersonDraft = {
  name: string;
  title: string;
  li: string;
  role: AttendeeRole;
  /** Four digits, or "" (edit: no code; add: one is made for them). */
  code: string;
  /** A picked file, as a data URL. Replaces the photo. */
  upload: string;
  /** A pasted photo link. Replaces the photo when there is no upload. */
  link: string;
  /** The stored photo is to go (edit only). */
  dropPhoto: boolean;
  frame: FaceFraming;
};

export function emptyDraft(): PersonDraft {
  return { name: "", title: "", li: "", role: "member", code: "", upload: "", link: "", dropPhoto: false, frame: roleFraming("member") };
}

/**
 * An editor's starting point. `rawTitle`, NOT `title`: the display title
 * invents "Community member" for anyone whose column is null
 * (lib/queries/admin.ts), and a form filled from the invention writes it back
 * on save — which is how that literal string got stamped into real rows.
 */
export function draftOf(p: AdminPerson): PersonDraft {
  return {
    name: p.name,
    title: p.rawTitle ?? "",
    li: p.li,
    role: p.role,
    code: p.code ?? "",
    upload: "",
    link: "",
    dropPhoto: false,
    frame: personFraming(p),
  };
}

/** Wait until typing pauses before a pasted link is loaded into the circle. */
function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export function PersonFields({
  draft,
  set,
  stored = null,
  tint,
  nameInvalid,
  codePlaceholder,
  keyLine,
}: {
  draft: PersonDraft;
  set: (patch: Partial<PersonDraft> | ((d: PersonDraft) => Partial<PersonDraft>)) => void;
  /** The photo already on record (edit), shown until it is replaced or removed. */
  stored?: string | null;
  /** The person's colour (pclFor of their id), under a cut-out photo. */
  tint?: string;
  nameInvalid?: boolean;
  codePlaceholder: string;
  /** Edit only: the person's key — their photo's filename and the CSV's join. Read-only. */
  keyLine?: string;
}) {
  const id = useId();
  const fileEl = useRef<HTMLInputElement | null>(null);
  const [photoErr, setPhotoErr] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);

  const link = useSettled(draft.link.trim(), 450);
  const src = draft.upload || link || (draft.dropPhoto ? null : stored);
  const hasPhoto = !!(draft.upload || draft.link.trim() || (!draft.dropPhoto && stored));

  async function onPhotoPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setPhotoErr("");
    try {
      const url = await readUploadDataUrl(f);
      // A different picture, so the old framing means nothing: start from the role default.
      set((d) => ({ upload: url, link: "", dropPhoto: false, frame: roleFraming(d.role) }));
      setLinkOpen(false);
    } catch (err) {
      setPhotoErr(err instanceof Error ? err.message : "That photo could not be read.");
    }
  }

  const pick = () => fileEl.current?.click();

  return (
    <div>
      <div className="ppl-photo">
        <PhotoAligner
          src={src}
          framing={draft.frame}
          role={draft.role}
          onChange={(frame) => set({ frame })}
          onReset={() => set((d) => ({ frame: roleFraming(d.role) }))}
          initials={draft.name.trim() ? initials(draft.name) : undefined}
          tint={tint}
          onPick={pick}
        />
        <motion.div layout="position" transition={spring.smooth} className="ppl-photo-acts">
          <Btn sm onClick={pick} data-guide="Picks a photo from this computer.">
            {hasPhoto ? "Replace photo" : "Upload photo"}
          </Btn>
          <Btn sm onClick={() => setLinkOpen((v) => !v)} data-guide={linkOpen ? "Hides the link field." : "Uses a photo from a web address instead."}>
            {linkOpen ? "Hide link" : "Paste a link"}
          </Btn>
          {hasPhoto ? (
            <Btn
              sm
              tone="care"
              data-guide="Takes the photo off; it goes when you save, and Cancel keeps it."
              onClick={() => {
                // The photo goes on save; until then Cancel keeps it.
                set((d) => ({ upload: "", link: "", dropPhoto: true, frame: roleFraming(d.role) }));
                setLinkOpen(false);
              }}
            >
              Remove photo
            </Btn>
          ) : null}
        </motion.div>
        <AnimatePresence initial={false}>
          {linkOpen ? (
            <motion.div key="link" {...fold} transition={spring.smooth} style={{ overflow: "hidden" }} className="ppl-link">
              <input
                className="fld"
                value={draft.link}
                onChange={(e) =>
                  set((d) => ({ link: e.target.value, upload: "", dropPhoto: false, frame: roleFraming(d.role) }))
                }
                placeholder="https://… a photo's address"
                dir="ltr"
                aria-label="Photo link"
                style={{ margin: "2px 0" }}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
        {photoErr ? <div className="ppl-err">{photoErr}</div> : null}
        <input ref={fileEl} type="file" accept="image/*" onChange={onPhotoPicked} style={{ display: "none" }} />
      </div>

      <motion.div layout="position" transition={spring.smooth} className="ppl-fields">
        <label className="ppl-f wide">
          <span className="mini">NAME</span>
          <input
            className="fld"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Full name"
            aria-invalid={nameInvalid || undefined}
          />
        </label>
        <label className="ppl-f">
          <span className="mini">TITLE</span>
          <input className="fld" value={draft.title} onChange={(e) => set({ title: e.target.value })} placeholder="Role or title" />
        </label>
        <label className="ppl-f">
          <span className="mini">LINKEDIN</span>
          <input className="fld" value={draft.li} onChange={(e) => set({ li: e.target.value })} placeholder="linkedin.com/in/…" dir="ltr" />
        </label>
        <div className="ppl-f">
          <span className="mini">SHOWS AS</span>
          <RoleSwitch
            value={draft.role}
            set={(r) =>
              set((d) => ({
                role: r,
                /*
                 * The framing follows the role while the host has not touched
                 * it: a host's default is bottom-anchored and larger.
                 */
                frame: !d.frame.aligned || sameCoords(d.frame, roleFraming(d.role)) ? roleFraming(r) : d.frame,
              }))
            }
          />
        </div>
        <div className="ppl-f">
          <label className="mini" htmlFor={`${id}-code`}>
            CODE
          </label>
          <div className="ppl-code">
            <input
              id={`${id}-code`}
              className="fld"
              value={draft.code}
              onChange={(e) => set({ code: e.target.value.replace(/[^0-9]/g, "").slice(0, 4) })}
              inputMode="numeric"
              placeholder={codePlaceholder}
              data-guide="The four digits they type to confirm it is them."
            />
            <Btn sm onClick={() => set({ code: String(1000 + Math.floor(Math.random() * 9000)) })} data-guide="Makes a new random four-digit code.">
              New
            </Btn>
          </div>
        </div>
      </motion.div>

      {keyLine ? (
        <motion.div layout="position" transition={spring.smooth} className="ppl-key" title="Their photo's file name and the spreadsheet's key. It does not change.">
          Key · {keyLine}
        </motion.div>
      ) : null}
    </div>
  );
}
