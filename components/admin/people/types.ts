/**
 * What the two roster mutations carry.
 *
 * They live in their own file because they are an API contract, not a
 * component detail: /api/admin/people reads these shapes, the merged People
 * page builds them, and the reorg's Part 2 moved the forms that produce them
 * out of a page and into cards. Anything that changes here changes the route.
 */
import type { AttendeeRole } from "@/lib/supabase/types";

/** What ADD sends. Everything the row can hold at the moment it is created. */
export type NewPerson = {
  name: string;
  title: string;
  li: string;
  photo: string;
  role: AttendeeRole;
  code: string;
  photoX: number | null;
  photoY: number | null;
  photoZoom: number | null;
};

/**
 * What EDIT sends: only the keys the host actually changed.
 *
 * The route reads PRESENCE, not truthiness, so an absent key means "leave it
 * alone" and a present one is written — null included. Posting the whole form
 * every time would therefore clear fields nobody touched.
 */
export type PersonPatch = {
  name?: string;
  title?: string | null;
  li?: string | null;
  photo?: string | null;
  role?: AttendeeRole;
  code?: string | null;
  photoX?: number | null;
  photoY?: number | null;
  photoZoom?: number | null;
};
