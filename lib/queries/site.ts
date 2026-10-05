import "server-only";

import { cache } from "react";

import { hasServiceRoleKey, isSupabaseConfigured } from "@/lib/env";
import { resolveEvent, resolvePublicEvent } from "@/lib/queries/eventRef";
import { DEFAULT_FIELD_ORDER, type RegFieldKey } from "@/lib/regFields";
import { registrationCapacity, registrationFields, registrationFull } from "@/lib/registration";
import { getSetting } from "@/lib/settings";
import { DEFAULT_PAGE, type SitePage } from "@/lib/sitePage";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * EVERYTHING THE PUBLIC PAGE READS (app/page.tsx), in one server round, shared by the page and
 * its metadata within a request (React `cache`).
 *
 * The page is the event's: the one ON THE PUBLIC PAGE (`events.is_public`) when there is one,
 * otherwise the active event — so the site still shows its words, its pictures and its album
 * while registration is closed, and a signed-in host can edit the page before publishing it.
 * Only a published event takes sign-ups (`open`), the rule app/api/register enforces too.
 */
export type SiteData = {
  content: SitePage;
  fields: RegFieldKey[];
  event: { name: string; startsAt: string | null; venue: string | null } | null;
  /** The event is on the public page: the form takes sign-ups. */
  open: boolean;
  /** Every seat is taken: the form takes them first in line. */
  full: boolean;
  /** Sign-ups wait for approval (their thank-you says so). */
  approve: boolean;
};

const EMPTY: SiteData = { content: DEFAULT_PAGE, fields: DEFAULT_FIELD_ORDER, event: null, open: false, full: false, approve: true };

export const loadSite = cache(async (): Promise<SiteData> => {
  if (!isSupabaseConfigured || !hasServiceRoleKey()) return EMPTY;
  const publicEvent = await resolvePublicEvent();
  const event = publicEvent ?? (await resolveEvent({ fresh: true }));
  if (!event) return EMPTY;

  const supabase = createAdminClient();
  const { data: state } = await supabase.from("event_state").select("*").eq("event_id", event.id).maybeSingle();
  if (!state) return { ...EMPTY, event: { name: event.name, startsAt: event.starts_at, venue: event.venue } };

  const open = publicEvent?.id === event.id;
  let full = false;
  if (open) {
    // reg_capacity is the cap (0 = no limit); the invited roster and the confirmed both hold seats.
    const capacity = registrationCapacity(state);
    if (capacity > 0) {
      const { count } = await supabase
        .from("attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .is("removed_at", null)
        .or("reg_status.is.null,reg_status.eq.confirmed");
      full = registrationFull(capacity, count ?? 0);
    }
  }

  return {
    content: getSetting(state, "reg_page"),
    fields: registrationFields(state),
    event: { name: event.name, startsAt: event.starts_at, venue: event.venue },
    open,
    full,
    approve: getSetting(state, "reg_approve"),
  };
});
