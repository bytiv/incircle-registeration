import type { StaticImageData } from "next/image";

import bubble from "@/public/brand/bubble.png";
import dotment from "@/public/brand/dotment.png";
import logo from "@/public/brand/logo.png";
import typeface from "@/public/brand/typeface.png";

import { isSupabaseConfigured, SUPABASE_URL } from "@/lib/env";
import type { AttendeeFaceRow } from "@/lib/supabase/types";

/**
 * Attendee photos: wherever lib/storage put them.
 *
 * attendees.photo_path is a bare filename in the public Supabase `faces` bucket
 * ('doha_hilal.png'), so this prefixes the bucket's public URL; a full address
 * (a pasted link, or a file CIB's Azure storage keeps later) is returned as it
 * is. A face with no photo_path has no photo, so the face shows the person's
 * initials instead.
 *
 * It deliberately does NOT guess `${slug}.webp` when the column is empty: a
 * guessed URL is a guaranteed 404, and three of those in a row make
 * lib/faceCache write the whole bucket off as empty. photo_path is kept
 * truthful, so an empty column means "no file", not "look it up".
 */
export function faceBucketUrl(face: Pick<AttendeeFaceRow, "photo_path" | "slug">): string | null {
  const path = face.photo_path?.trim();
  // Before the keys are pasted in, SUPABASE_URL is still the .env.example
  // placeholder. Returning null paints every face as "no photo yet" instead
  // of waiting out doomed DNS lookups first.
  if (!path || !isSupabaseConfigured) return null;
  if (!SUPABASE_URL) return null;
  // Already absolute? The column allows "storage path or absolute URL".
  if (/^https?:\/\//i.test(path)) return path;
  return `${SUPABASE_URL}/storage/v1/object/public/faces/${encodeURIComponent(path)}`;
}

/**
 * InCircle's brand files — public/brand/, from InCircle's own handoff
 * (incircle-application/public/brand):
 *
 *   logo      the orb over "InCircle COMMUNITY"
 *   typeface  "InCircle COMMUNITY", the gradient wordmark
 *   bubble    the orb alone
 *   dotment   the organiser's mark
 *
 * Imported as modules rather than written as "/brand/logo.png" strings, purely
 * for caching: Next emits them under /_next/static/media/ with a content hash
 * and serves them `immutable`, so each is fetched once per device. The orb the
 * pages draw is CSS (components/ui/InCircleBrand.tsx); these are the files for
 * wherever a picture of the mark is wanted.
 */
const src = (m: StaticImageData | string): string => (typeof m === "string" ? m : m.src);

export const BRAND = {
  logo: src(logo),
  typeface: src(typeface),
  bubble: src(bubble),
  dotment: src(dotment),
} as const;
