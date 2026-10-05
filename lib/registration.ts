import { LOCKED_FIELDS, REG_FIELD_KEYS, isRegFieldKey, type RegFieldKey } from "@/lib/regFields";
import { getSetting } from "@/lib/settings";
import type { EventStateRow } from "@/lib/supabase/types";

/**
 * THE REGISTRATION PAGE — what the public page, the register route and the
 * control room share.
 *
 * Everything the host sets lives in `event_state.settings` (lib/settings.ts:
 * `reg_page`, `reg_fields`, `reg_approve`, `reg_capacity`), which is why one
 * edit reaches the public page on its next request with no deploy. This module
 * is the vocabulary all three read it through: the fields the form shows, the
 * seat count the page closes at, the pipeline a sign-up walks.
 */

export { LOCKED_FIELDS, REG_FIELD_KEYS, type RegFieldKey };

/** The pipeline a sign-up walks. NULL on the roster means invited — a confirmed seat. */
export type RegStatus = "new" | "approved" | "confirmed";
export const REG_STATUS_LABEL: Record<RegStatus, string> = {
  new: "New",
  approved: "Approved",
  confirmed: "Confirmed",
};

/** The form's one choice — stored on the seat as `profile.attendee`. */
export type AttendeeKind = "first" | "returning";
export const ATTENDEE_LABEL: Record<AttendeeKind, string> = {
  first: "First time",
  returning: "Attended before",
};
export const isAttendeeKind = (v: unknown): v is AttendeeKind => v === "first" || v === "returning";

type StateLike = Pick<EventStateRow, "settings"> | null | undefined;

/**
 * The seats the evening has — `reg_capacity`, set next to the approval rule on
 * the Registration page. 0 means no limit: see `registrationFull`.
 */
export function registrationCapacity(state: StateLike): number {
  return getSetting(state, "reg_capacity");
}

/**
 * Whether the seats are gone. A capacity of 0 is "no seat limit", so such a
 * page is never full — the one rule the public page, the register route and
 * the control room all read.
 */
export function registrationFull(capacity: number, seated: number): boolean {
  return capacity > 0 && seated >= capacity;
}

/**
 * Which fields the form shows, IN THE FORM'S ORDER: the list iterates in the order the host
 * dragged them into (`reg_fields`). Name and email are the key and never come off (the
 * setting's rule already puts them back; this is the belt).
 */
export function registrationFields(state: StateLike): RegFieldKey[] {
  const on: RegFieldKey[] = [];
  for (const k of getSetting(state, "reg_fields")) if (isRegFieldKey(k) && !on.includes(k)) on.push(k);
  const missing = LOCKED_FIELDS.filter((k) => !on.includes(k));
  return [...missing, ...on];
}

/** The address shape the registration form accepts: something@something.tld. */
export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Who holds one of the room's seats: the invited roster (null — never went
 * through the form) and the sign-ups the host confirmed. New and approved
 * sign-ups are the queue on the Registration page, not People, and do not
 * count — the same rule app/api/register uses to decide the room is full.
 */
export const holdsSeat = (status: RegStatus | null | undefined) => status == null || status === "confirmed";
