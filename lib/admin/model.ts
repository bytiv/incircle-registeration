import { faceStyle, framingOf, type FaceFraming, type FaceStyle } from "@/lib/faceFraming";
import type { AttendeeRole } from "@/lib/supabase/types";

/**
 * The shape the admin views consume.
 *
 * This is deliberately the shape the prototype's `data()` produced
 * (incircle_design_source/InCircle Admin.dc.html:535-680) — same field names, same
 * units — because every view was written against it. Only the source changed:
 * there it was seeded arrays plus a seeded RNG, here it is the database.
 *
 * Times are MINUTES PAST MIDNIGHT, not timestamps, because that is what the
 * design's `hhmm()` (design:533) and its arrival buckets (design:356-364) work
 * in, and rewriting those to take Dates is exactly the kind of "equivalent
 * mechanism" substitution that is not wanted here.
 */

export type AdminStatus = "live" | "attended" | "absent";

/** One event on a person's record — the mockup's EVERY EVENT card, one row each. */
export type PersonEvent = {
  eventId: string;
  name: string;
  startsAt: string | null;
  /** The event the control room is on right now. */
  current: boolean;
  deleted: boolean;
  came: boolean;
  registered: boolean;
  removed: boolean;
};

export type AdminPerson = {
  id: string;
  slug: string;
  /** Position in the seeded roster, used only to keep sorts stable. */
  idx: number;
  isTeam: boolean;
  added: boolean;
  /** The stored column, which the host can now change. `isTeam` is derived from it. */
  role: AttendeeRole;
  name: string;
  /**
   * The DISPLAY title, which carries a fabricated fallback for a null column
   * ("Community member" / "Host team" — lib/queries/admin.ts). NEVER pre-fill an
   * edit form from this: doing so is what used to stamp that literal string into
   * the database the first time anyone opened EDIT and pressed SAVE on someone
   * with no title. Use `rawTitle`.
   */
  title: string;
  /** attendees.title exactly as stored, null included. What the editor edits. */
  rawTitle: string | null;
  photo: string | null;
  /** attendees.photo_path exactly as stored — the editor shows and clears it. */
  rawPhotoPath: string | null;
  /**
   * Where inside the photo this person's face is (supabase/25). All three null
   * means "never aligned, use the role default" — see lib/faceFraming.ts.
   */
  photoX: number | null;
  photoY: number | null;
  photoZoom: number | null;
  /**
   * supabase/38_registration.sql — how this person got onto the list. Null is
   * the invited roster (seeded or host-added): a confirmed seat that never
   * went through the form. The rest are the pipeline a sign-up walks in
   * People's Registration tab until confirmed, then the Confirmed tab.
   */
  regStatus: "new" | "approved" | "confirmed" | null;
  company: string | null;
  /** The address they registered with — attendees.email. */
  regEmail: string | null;
  /** The form's one choice (attendees.profile.attendee): first time, or been before. Null when not asked. */
  attendee: "first" | "returning" | null;
  phone: string | null;
  registeredAt: string | null;
  /** Set when the host removed them. They stay in the list so they can come back. */
  removed: boolean;
  /**
   * supabase/40_people_directory.sql — the person behind this seat, and their
   * seats at every event: which ones they came to (claimed a face at least
   * once, a fact that survives every restart) and which they only registered
   * for. Empty on a database without 40_, and the drawer's EVERY EVENT card
   * simply does not appear.
   */
  personId: string | null;
  firstClaimedAt: string | null;
  history: PersonEvent[];
  li: string;
  status: AdminStatus;
  checkIn: number | null;
  lastSeen: number | null;
  device: string;
  code: string | null;
  /*
   * `steps` (a stage_visits count) used to sit here. Nothing has ever written
   * stage_visits, so it was 0 for everyone, forever, and every surface built on
   * it read as "nobody has done anything". The admin reorg (Part 1) removed it
   * and re-keyed those surfaces onto `lastPageId`, which the phone announces on
   * every page change and is therefore true.
   */
  stage: string;
  lastPageId: string | null;
  isLive: boolean;
};

/** design:104-108 — the status word; the pills colour themselves from their tone. */
export function statusStyle(s: AdminStatus): { label: string } {
  if (s === "live") return { label: "In app now" };
  if (s === "attended") return { label: "Attended" };
  return { label: "Not arrived" };
}

/** design:533 */
export function hhmm(mins: number): string {
  return (
    String(Math.floor(mins / 60)).padStart(2, "0") +
    ":" +
    String(Math.round(mins) % 60).padStart(2, "0")
  );
}

/**
 * The person's photo framing, from the admin's own camelCase shape.
 *
 * AdminPerson is the design's `data()` shape (camelCase), the row types are
 * Postgres's (snake_case), and this is the one place they are bridged — so the
 * control room and the room itself provably crop the same way.
 */
export function personFraming(p: {
  role: AttendeeRole;
  photoX: number | null;
  photoY: number | null;
  photoZoom: number | null;
}): FaceFraming {
  return framingOf({
    role: p.role,
    photo_x: p.photoX,
    photo_y: p.photoY,
    photo_zoom: p.photoZoom,
  });
}

/**
 * The <img> props an admin avatar passes to FaceImg — or undefined for an
 * unaligned person, so the design-verbatim avatar renders exactly as it always
 * has. Base 1: a flat admin circle has no role base of its own, so the person's
 * zoom is the whole scale.
 */
export function personFaceStyle(p: {
  role: AttendeeRole;
  photoX: number | null;
  photoY: number | null;
  photoZoom: number | null;
}): FaceStyle | undefined {
  const f = personFraming(p);
  return f.aligned ? faceStyle(f, 1, p.role === "host") : undefined;
}

/** design:531 */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => (w[0] ?? "").toUpperCase())
    .join("");
}

export type AdminSnapshot = {
  people: AdminPerson[];
  /** Minutes past midnight the event starts. design:537 */
  start: number;
  /** How many people the host removed, so People can offer them back. */
  removedCount: number;
  /**
   * Those same people. Only People reads it — every other view, every count and
   * the CSV read `people`, which is the active roster. Carried so DELETE can be
   * undone one person at a time, not only by the design's all-or-nothing
   * "RESTORE n DELETED".
   */
  removedPeople: AdminPerson[];
};
