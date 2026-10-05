import "server-only";

import type { AdminPerson, AdminSnapshot } from "@/lib/admin/model";
import { isAttendeeKind } from "@/lib/registration";
import { EVENT_TZ } from "@/lib/env";
import { resolveEvent } from "@/lib/queries/eventRef";
import { faceBucketUrl } from "@/lib/photos";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventRow, EventStateRow } from "@/lib/supabase/types";

/**
 * Everything the control room reads, in one server round.
 *
 * All of it needs the service role: `attendees` is closed to every browser
 * (supabase/02_security_storage.sql), so this is only reachable from a server
 * component or route sitting behind the passcode cookie.
 *
 * CIB's lib/queries/admin.ts reads the room as well — the run of show, who is
 * in the app, archived rounds, what the moments produced. Registration reads
 * the event, its settings row and its list, and maps the list into CIB's
 * AdminPerson shape (lib/admin/model.ts), so the People and Registration views
 * read it exactly as they do in CIB.
 */

export type AdminShellData = {
  event: EventRow;
  state: EventStateRow;
  snapshot: AdminSnapshot;
  /** People on the list (invited and confirmed; removed ones not counted). */
  totalCount: number;
  eventName: string;
  /** "Wed 12 Aug 2026 · Cairo", or the venue alone, or "". */
  eventDate: string;
};

/** The columns People and the drawer read. A literal, so supabase-js infers the row. */
const ATTENDEE_COLUMNS =
  "id,slug,full_name,title,role,photo_path,linkedin_url,verify_code,added_by_host,removed_at,photo_x,photo_y,photo_zoom,reg_status,company,email,phone,registered_at,person_id,first_claimed_at,created_at,profile" as const;

/** Minutes past midnight in the EVENT's timezone — the AdminSnapshot's `start`. */
function minutesOfDay(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: EVENT_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const h = get("hour");
    const m = get("minute");
    if (Number.isNaN(h) || Number.isNaN(m)) throw new Error("unparsed");
    return h * 60 + m;
  } catch {
    return d.getHours() * 60 + d.getMinutes();
  }
}

/** design:639 — "Wed 12 Aug 2026 · Cairo", in the event's timezone. */
export function formatEventDate(event: Pick<EventRow, "starts_at" | "venue">): string {
  if (!event.starts_at) return event.venue ?? "";
  const date = new Date(event.starts_at).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: EVENT_TZ,
  });
  return event.venue ? `${date} · ${event.venue}` : date;
}

export async function getAdminData(): Promise<{ ok: true; data: AdminShellData } | { ok: false; error: string }> {
  const supabase = createAdminClient();

  // Read fresh, never from the cache (lib/queries/eventRef.ts): the control room shows the
  // event the database says is active NOW.
  const event = await resolveEvent({ fresh: true });
  if (!event) {
    return {
      ok: false,
      error: "No event is marked as active, and none matches NEXT_PUBLIC_EVENT_SLUG.",
    };
  }

  const [stateRes, attendeesRes] = await Promise.all([
    supabase.from("event_state").select("*").eq("event_id", event.id).maybeSingle(),
    supabase.from("attendees").select(ATTENDEE_COLUMNS).eq("event_id", event.id).order("created_at", { ascending: true }),
  ]);
  if (stateRes.error) return { ok: false, error: stateRes.error.message };
  if (attendeesRes.error) return { ok: false, error: attendeesRes.error.message };
  if (!stateRes.data) return { ok: false, error: "This event has no event_state row." };

  /*
   * Every seat, removed ones included, mapped into CIB's AdminPerson. The event-day fields
   * (status, check-in, the screen a phone is on) read as "never arrived": nobody is in a room
   * yet, and nothing in this app shows them.
   */
  const everyone: AdminPerson[] = (attendeesRes.data ?? []).map((r, i): AdminPerson => {
    const isTeam = r.role === "host";
    return {
      id: r.id,
      slug: r.slug,
      idx: i,
      isTeam,
      added: r.added_by_host,
      role: r.role,
      name: r.full_name,
      // design:580 — members all read "Community member" in the roster.
      title: r.title ?? (isTeam ? "Host team" : "Community member"),
      /*
       * The column itself, for the editor to pre-fill from. The line above
       * invents a title for anyone who has none, and an edit form filled from
       * THAT writes the invention back on save. The two must stay separate.
       */
      rawTitle: r.title,
      photo: faceBucketUrl({ photo_path: r.photo_path, slug: r.slug }),
      rawPhotoPath: r.photo_path,
      photoX: r.photo_x,
      photoY: r.photo_y,
      photoZoom: r.photo_zoom,
      regStatus: r.reg_status ?? null,
      company: r.company ?? null,
      regEmail: r.email ?? null,
      attendee: isAttendeeKind(r.profile?.attendee) ? r.profile.attendee : null,
      phone: r.phone ?? null,
      registeredAt: r.registered_at ?? null,
      removed: r.removed_at !== null,
      personId: r.person_id ?? null,
      firstClaimedAt: r.first_claimed_at ?? null,
      history: [],
      li: r.linkedin_url ?? "",
      status: "absent",
      checkIn: null,
      lastSeen: null,
      device: "—",
      code: r.verify_code ?? null,
      stage: "—",
      lastPageId: null,
      isLive: false,
    };
  });

  const people = everyone.filter((p) => !p.removed);
  const removedPeople = everyone.filter((p) => p.removed);

  return {
    ok: true,
    data: {
      event,
      state: stateRes.data,
      snapshot: {
        people,
        start: minutesOfDay(event.starts_at) ?? 0,
        removedCount: removedPeople.length,
        removedPeople,
      },
      totalCount: people.length,
      eventName: event.name,
      eventDate: formatEventDate(event),
    },
  };
}
