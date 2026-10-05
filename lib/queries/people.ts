import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, PersonRow } from "@/lib/supabase/types";

/**
 * THE DIRECTORY — everyone who was ever on a list, across every event.
 *
 * A `people` row is the human; an `attendees` row is their seat at one event.
 * The registration page and the host's ADD find-or-create a person, so when
 * InCircle moves to CIB's platform the directory is already filled. CIB's
 * import drawer (people from past events) lists and seats from it; this app
 * has one event, so only the two writers are here.
 *
 * Both degrade on a database without the table: the writers return null so
 * the callers simply insert an unlinked seat.
 */

type Client = SupabaseClient<Database>;

const missing = (error: { code?: string; message: string } | null) =>
  !!error &&
  (error.code === "42P01" || error.code === "42703" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message));

const clean = (v: string | null | undefined, max: number) => {
  const s = (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
};

export type PersonDetails = {
  name: string;
  email?: string | null;
  title?: string | null;
  company?: string | null;
  linkedin?: string | null;
  photoPath?: string | null;
  photoX?: number | null;
  photoY?: number | null;
  photoZoom?: number | null;
  phone?: string | null;
};

/**
 * The person behind a new seat: found by address when there is one, created
 * otherwise. The latest details win — someone registering again with a new
 * title has a new title — but a blank never overwrites a known value.
 * Null on a database without the table, and the caller inserts an unlinked seat.
 */
export async function findOrCreatePerson(supabase: Client, d: PersonDetails): Promise<string | null> {
  const email = clean(d.email, 120)?.toLowerCase() ?? null;
  const fresh = {
    full_name: clean(d.name, 80) ?? "Guest",
    title: clean(d.title, 80),
    company: clean(d.company, 80),
    linkedin_url: clean(d.linkedin, 200),
    photo_path: clean(d.photoPath, 300),
    photo_x: d.photoX ?? null,
    photo_y: d.photoY ?? null,
    photo_zoom: d.photoZoom ?? null,
    phone: clean(d.phone, 40),
  };

  if (email) {
    const found = await supabase.from("people").select("id").eq("email", email).maybeSingle();
    if (found.error) {
      if (missing(found.error)) return null;
      throw new Error(found.error.message);
    }
    if (found.data) {
      const patch: Partial<PersonRow> = { full_name: fresh.full_name, updated_at: new Date().toISOString() };
      for (const k of ["title", "company", "linkedin_url", "photo_path", "phone"] as const) {
        if (fresh[k]) patch[k] = fresh[k];
      }
      if (fresh.photo_path) {
        patch.photo_x = fresh.photo_x;
        patch.photo_y = fresh.photo_y;
        patch.photo_zoom = fresh.photo_zoom;
      }
      await supabase.from("people").update(patch).eq("id", found.data.id);
      return found.data.id;
    }
  }

  const made = await supabase
    .from("people")
    .insert({ ...fresh, email })
    .select("id")
    .single();
  if (made.error) {
    if (missing(made.error)) return null;
    // Two sign-ups with one address in flight: the other one won, use theirs.
    if (made.error.code === "23505" && email) {
      const again = await supabase.from("people").select("id").eq("email", email).maybeSingle();
      if (again.data) return again.data.id;
    }
    throw new Error(made.error.message);
  }
  return made.data.id;
}

/**
 * Write-through from a seat's edit: the directory shows the name and the
 * photo the host most recently saved, whichever event they saved it on.
 * Best-effort — a person whose seat saved is a person whose seat saved.
 */
export async function syncPerson(
  supabase: Client,
  personId: string,
  patch: Partial<Pick<PersonRow, "full_name" | "title" | "linkedin_url" | "photo_path" | "photo_x" | "photo_y" | "photo_zoom">>,
): Promise<void> {
  if (!Object.keys(patch).length) return;
  const { error } = await supabase
    .from("people")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", personId);
  if (error && !missing(error)) console.error("[cib] people sync failed:", error.message);
}
