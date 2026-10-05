import "server-only";

import { EVENT_SLUG } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventRow } from "@/lib/supabase/types";

/**
 * THE ROOM — which event this app is running right now.
 *
 * Until 2026-09-28 this was NEXT_PUBLIC_EVENT_SLUG, fixed at build time. It is
 * `events.is_active` now (supabase/39_events.sql): the Events page's OPEN moves
 * the flag, and every server read — the attendee render, the hall, every admin
 * route, the archive — comes through here and follows it. The slug is the
 * fallback for a database where nothing is marked yet, which is also what a
 * database without the migration looks like (the column is missing, the read
 * errors, and we fall through exactly as before).
 *
 * CACHED FOR A FEW SECONDS, ONCE PER SERVER PROCESS, because it fronts nearly every request and
 * cost a round trip on each (~85ms p50 measured).
 *
 * The cache lives on globalThis, not in this module. Next compiles every page and every API route
 * as its own bundle with its own copy of this module, so a module-level cache made forgetEvent()
 * clear only the copy in the route that switched: the control room's page, the phones' routes and
 * the admin routes kept serving the OLD event for up to a minute, and a host's press could land on
 * it (Belal, 2026-09-30: "I have to click a few times and do some refreshes before it actually
 * switches"). Now every route in the process shares one entry, so a switch is seen by all of them
 * at once; another serverless instance catches up within TTL_MS.
 *
 * The control room reads the flag FRESH (`{ fresh: true }`): the host is one person, and what they
 * see and press must always be the event the database says is active, on any instance.
 *
 * A switch writes in two steps (every event off, then the chosen one on — supabase/01_schema.sql's
 * events_one_active allows one at a time), so for a moment nothing is active. A read in that gap
 * falls back to the slug's event, and a fallback is only kept for FALLBACK_TTL_MS.
 */
const TTL_MS = 10_000;
const FALLBACK_TTL_MS = 2_000;

type Entry = { row: EventRow; at: number; ttl: number };
const G = globalThis as typeof globalThis & { __cibEventRef?: { cached: Entry | null } };
const store = (G.__cibEventRef ??= { cached: null });

export async function resolveEvent(opts: { fresh?: boolean } = {}): Promise<EventRow | null> {
  const hit = store.cached;
  if (!opts.fresh && hit && Date.now() - hit.at < hit.ttl) return hit.row;
  const supabase = createAdminClient();

  const active = await supabase.from("events").select("*").eq("is_active", true).maybeSingle();
  let row: EventRow | null = active.error ? null : active.data;
  let ttl = TTL_MS;
  if (!row) {
    const bySlug = await supabase.from("events").select("*").eq("slug", EVENT_SLUG).maybeSingle();
    row = bySlug.error ? null : bySlug.data;
    ttl = FALLBACK_TTL_MS;
  }
  if (!row) {
    // Keep serving the last good row if the lookup blips; only a real answer replaces it.
    return hit?.row ?? null;
  }
  store.cached = { row, at: Date.now(), ttl };
  return row;
}

/** Drop the cache immediately — for anything that rewrites the event itself, or which one is the room. */
export function forgetEvent(): void {
  store.cached = null;
}

/** Just the id, for the handlers that only need something to filter by. */
export async function resolveEventId(opts: { fresh?: boolean } = {}): Promise<string | null> {
  return (await resolveEvent(opts))?.id ?? null;
}

/**
 * THE PUBLIC PAGE — the event /register takes sign-ups for. Not cached: the
 * page is read by strangers at their own pace, and the switch that moves it is
 * a host deciding to open registration, which should land on the next request.
 * Null when nothing is published (or before supabase/39_events.sql), which the
 * page reads as "registration is closed".
 */
export async function resolvePublicEvent(): Promise<EventRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("events").select("*").eq("is_public", true).maybeSingle();
  return error ? null : (data ?? null);
}
