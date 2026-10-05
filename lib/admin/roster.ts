import "server-only";

import { continueField } from "@/lib/bubbleField";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Adding a person to the roster — the pieces two routes share.
 *
 * These lived inside app/api/admin/people/route.ts until the registration page
 * (2026-09-28) needed to create attendees from a PUBLIC form (app/api/register):
 * the slug (which also names the photo's file), the real 4-digit code without which
 * a person can never get past Confirm code, the bubble slot that keeps the face
 * wall one composition, and the roster_seq bump that tells open phones the guest
 * list changed. One module, so a walk-in typed by the host and a sign-up from the
 * public page are the same kind of row. The photo itself is stored by lib/storage
 * (saveFacePhoto), like every other file.
 */

/** design:67 — the slug is the photo filename key: "basma_tawfik". */
export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "guest"
  );
}

export async function uniqueSlug(
  supabase: ReturnType<typeof createAdminClient>,
  eventId: string,
  base: string,
  /** Part 15 — slugs already claimed by earlier rows of the SAME bulk batch,
   * which the query below cannot see because none of them is inserted yet. */
  exclude?: Set<string>,
): Promise<string> {
  const { data } = await supabase
    .from("attendees")
    .select("slug")
    .eq("event_id", eventId)
    .like("slug", `${base}%`);
  const taken = new Set([...((data ?? []).map((r) => r.slug)), ...(exclude ?? [])]);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Deterministic escape hatch; still unique because the loop above exhausted 2..499.
  return `${base}_${Date.now()}`;
}

/** A real code, not a placeholder — P2b compares against it. */
export function verifyCode(): string {
  return String(1000 + Math.floor(Math.random() * 9000));
}

/**
 * Positions for host-added bubbles: keep walking the field's own serpentine
 * (lib/bubbleField.ts) from wherever it currently ends. New people land BELOW
 * the hand-tuned composition — tops only ever grow — but on the same L→C→R
 * path, so the field reads as one piece however many walk-ins arrive. P2 and
 * P12 derive their field height from the max bubble_top, so the scroll simply
 * grows.
 *
 * Removed rows keep their slot (they stay in the query): a slot is never
 * reused, so RESTORE brings people back exactly where they were, overlapping
 * nobody who arrived in between.
 */
export async function nextBubbleSlots(
  supabase: ReturnType<typeof createAdminClient>,
  eventId: string,
  count: number,
): Promise<{ bubble_top: number; bubble_left: string }[]> {
  const { data } = await supabase
    .from("attendees")
    .select("bubble_top, bubble_left")
    .eq("event_id", eventId)
    .not("bubble_top", "is", null);
  return continueField(data ?? [], count);
}

/**
 * Tell open phones the roster changed. `attendees` left the realtime
 * publication in 02b (verify_code), so the signal goes through event_state
 * instead: the touch trigger bumps `seq` on this write, the change rides the
 * existing event-state channel, and AttendeeApp refetches `attendee_faces` on
 * a roster_seq it hasn't seen. Deliberately NOT run_seq — that remounts all
 * 50 phones. Read-then-write like /api/admin/reset does for run_seq; the
 * service role is the only writer, so the race window is theoretical.
 */
export async function bumpRosterSeq(
  supabase: ReturnType<typeof createAdminClient>,
  eventId: string,
): Promise<void> {
  const { data } = await supabase
    .from("event_state")
    .select("roster_seq")
    .eq("event_id", eventId)
    .maybeSingle();
  if (!data) return;
  const { error } = await supabase
    .from("event_state")
    .update({ roster_seq: (data.roster_seq ?? 0) + 1 })
    .eq("event_id", eventId);
  // The mutation itself succeeded; a phone that misses this bump catches up on
  // the next one (or a reload). Not worth failing the host's action over.
  if (error) console.error("[cib] roster_seq bump failed:", error.message);
}
