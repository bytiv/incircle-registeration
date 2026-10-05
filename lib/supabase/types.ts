/**
 * Hand-written subset of the database types — the four tables registration
 * uses, with CIB's own row shapes (CIB's lib/supabase/types.ts, cut down).
 *
 * Shapes taken from supabase/01_schema.sql, which is itself a subset of CIB's.
 */

import type { EventSettings } from "@/lib/settings";

export type AttendeeRole = "host" | "member";

/** supabase/01_schema.sql — events */
export type EventRow = {
  id: string;
  slug: string;
  name: string;
  starts_at: string | null;
  venue: string | null;
  created_at: string;
  /**
   * THE ROOM (the event the control room works on) and THE PUBLIC PAGE (the
   * event /register signs people up for). One of each at most, by partial
   * unique index.
   */
  is_active?: boolean;
  is_public?: boolean;
  /** Soft delete, in CIB's Events page. Nothing here sets it. */
  deleted_at?: string | null;
};

/**
 * people, THE DIRECTORY. One row per human across every event; an attendees
 * row is that person's seat at one event. Service-role only (addresses and
 * phone numbers).
 */
export type PersonRow = {
  id: string;
  /** The key, when there is one — lower-cased, unique. Null for typed walk-ins. */
  email: string | null;
  full_name: string;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  photo_path: string | null;
  photo_x: number | null;
  photo_y: number | null;
  photo_zoom: number | null;
  phone: string | null;
  first_seen_at: string;
  updated_at: string;
};

/**
 * supabase/01_schema.sql — event_state. One row per event. In CIB it is where
 * the room is; here only `settings` (the registration page's knobs) and
 * `roster_seq` (bumped on every change to the list) are used. The rest of the
 * columns exist so the row is CIB's row.
 */
export type EventStateRow = {
  event_id: string;
  stage_index: number;
  held: boolean;
  open_max: number;
  blocks: [number, number][];
  stage_order: string[] | null;
  stages_off: string[];
  /** Bumped by a trigger on every update — the seq guard. */
  seq: number;
  live: boolean;
  show_page_nav: boolean;
  back_off: string[];
  run_seq: number;
  run_started_at: string;
  /**
   * Event-level knobs (the registration page). Written only via
   * /api/admin/state `{type:"setting"}`; read through lib/settings.ts
   * getSetting(), which fills in the defaults and re-validates.
   */
  settings: EventSettings;
  /** Bumped by every change to the list (lib/admin/roster.ts bumpRosterSeq). */
  roster_seq: number;
  changed_at: string;
};

/**
 * supabase/01_schema.sql — attendees: a seat at one event. Only reachable with
 * the service role.
 */
export type AttendeeRow = {
  id: string;
  event_id: string;
  full_name: string;
  slug: string;
  title: string | null;
  role: AttendeeRole;
  photo_path: string | null;
  linkedin_url: string | null;
  /** The 4 digits the event app's confirm-code page asks for (CIB). Made at sign-up so it is ready. */
  verify_code: string | null;
  /** The face-wall position (CIB). Given at sign-up so the wall stays one composition. */
  bubble_left: string | null;
  bubble_top: number | null;
  added_by_host: boolean;
  created_at: string;
  /** Set instead of deleting, so it can be undone. */
  removed_at: string | null;
  /** Where inside the photo this person's face is. NULL means "use the role default"; see lib/faceFraming.ts. */
  photo_x: number | null;
  photo_y: number | null;
  photo_zoom: number | null;
  /** The registration pipeline: null = invited (a confirmed seat); new → approved → confirmed. */
  reg_status?: "new" | "approved" | "confirmed" | null;
  company?: string | null;
  /** The address they REGISTERED with. */
  email?: string | null;
  phone?: string | null;
  registered_at?: string | null;
  /** Which person in the directory this seat belongs to. */
  person_id?: string | null;
  /** When they first claimed a face at the event (CIB's event app). Nothing here writes it. */
  first_claimed_at?: string | null;
  /**
   * What registration knows beyond the columns (CIB's own `profile` jsonb): here, the form's one
   * choice, `{ attendee: "first" | "returning" }`.
   */
  profile?: Record<string, unknown>;
};

/**
 * The face as the room draws it (CIB's attendee_faces view). Registration has
 * no such view; the type stays because the photo components take this shape.
 */
export type AttendeeFaceRow = {
  id: string;
  event_id: string;
  full_name: string;
  slug: string;
  title: string | null;
  role: AttendeeRole;
  photo_path: string | null;
  bubble_left: string | null;
  bubble_top: number | null;
  photo_x: number | null;
  photo_y: number | null;
  photo_zoom: number | null;
};

/**
 * supabase-js resolves its query generics against this exact shape — omitting
 * `Relationships` makes every result collapse to `never`.
 */
type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      events: Table<EventRow>;
      people: Table<PersonRow, Pick<PersonRow, "full_name"> & Partial<PersonRow>>;
      event_state: Table<EventStateRow>;
      attendees: Table<
        AttendeeRow,
        // insert: a seat needs only these three
        Pick<AttendeeRow, "event_id" | "full_name" | "slug"> & Partial<AttendeeRow>
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
