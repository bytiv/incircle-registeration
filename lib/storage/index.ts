import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

import { errorCode, EXT, isAbsoluteUrl, isFaceType, sniffPictureType, supabaseAliases, supabaseFaceKey } from "./keys";

/**
 * EVERY PHOTO THE APP KEEPS goes through here: People's add and edit, the
 * public sign-up, and the photos a purge takes with it.
 *
 * CIB's lib/storage, Supabase Storage only: the public `faces` bucket, the
 * same keys and the same values kept in the rows (CIB moves to Azure Blob
 * Storage once its storage account exists; a photo kept here is still read
 * there, because lib/photos.ts turns a bare key into the bucket's address and
 * passes an address through). The names and the rules are in
 * lib/storage/keys.ts.
 *
 * What a row keeps: the bare key `<slug>.<ext>`.
 */

type Client = SupabaseClient<Database>;

export const FACES_BUCKET = "faces";
/** The public page's own pictures: the hero and the album (supabase/02_security_storage.sql). */
export const SITE_BUCKET = "site";

/* ------------------------------------------------------------------- failures */

function logFailure(what: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[incircle] storage: ${what} failed (${errorCode(err) ?? "no code"}): ${message.split("\n")[0]}`);
}

/* ---------------------------------------------------------------------- photos */

/** A data URL's bytes. The type it declares is not trusted: the bytes are sniffed. */
function dataUrlBytes(dataUrl: string): Buffer | null {
  const m = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const bytes = Buffer.from(m[1], "base64");
  return bytes.length ? bytes : null;
}

const FACE_REFUSAL = "Send the photo as a PNG, JPEG or WebP picture.";

/**
 * A person's photo — People's add and edit, the public sign-up — already made small in the
 * browser (components/admin/people/bits.tsx) and sent as a data URL. PNG, JPEG and WebP only.
 * Answers what `photo_path` keeps: `<slug>.<ext>`, upserted, so a replaced photo rewrites the
 * object in place.
 */
export async function saveFacePhoto(
  supabase: Client,
  input: { eventId: string; slug: string; dataUrl: string },
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const bytes = dataUrlBytes(input.dataUrl);
  const type = bytes ? sniffPictureType(bytes) : null;
  if (!bytes || !isFaceType(type)) return { ok: false, error: FACE_REFUSAL };
  try {
    const key = supabaseFaceKey(input.slug, type);
    const { error } = await supabase.storage.from(FACES_BUCKET).upload(key, bytes, { contentType: type, upsert: true });
    if (error) throw error;
    return { ok: true, path: key };
  } catch (err) {
    logFailure("photo upload", err);
    return { ok: false, error: "That photo could not be saved." };
  }
}

/* ------------------------------------------------------------- page pictures */

/** A refusal: the words for the host, and the HTTP status to answer with. */
export class PictureRefused extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PictureRefused";
    this.status = status;
  }
}

/**
 * A picture on the public page — the hero, or one more photo for the album — already made
 * web-sized in the browser (components/site/upload.ts). PNG, JPEG, WebP or GIF, read from the
 * bytes; stored under a fresh name, never overwritten, so a page that still shows the old one
 * keeps working. Answers its public address, which the page's content keeps.
 */
export async function saveSitePicture(supabase: Client, input: { kind: "hero" | "album"; bytes: Uint8Array }): Promise<string> {
  const type = sniffPictureType(input.bytes);
  if (!type) throw new PictureRefused("Send a PNG, JPEG, WebP or GIF picture.", 415);
  const key = `${input.kind}/${randomUUID()}.${EXT[type]}`;
  const bucket = supabase.storage.from(SITE_BUCKET);
  const { error } = await bucket.upload(key, input.bytes, { contentType: type, upsert: false, cacheControl: "31536000" });
  if (error) {
    logFailure("page picture upload", error);
    throw new PictureRefused(
      /bucket not found/i.test(error.message)
        ? "The page's picture storage is not set up yet: run supabase/02_security_storage.sql."
        : "That picture could not be saved. Try again in a moment.",
      500,
    );
  }
  return bucket.getPublicUrl(key).data.publicUrl;
}

/* --------------------------------------------------------------------- purges */

/**
 * The seats a purge is deleting: their photos may go with them, unless something it keeps
 * still uses the same file. `attendeeIds` — those rows (purgeOne); `removedOf` — every removed
 * seat of that event (purgeAll).
 */
export type PurgeScope = { attendeeIds: readonly string[] } | { removedOf: string };

const missingTable = (error: { code?: string; message: string }) =>
  error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message);

/**
 * The files still in use: a seat the purge keeps, or a person in the directory (`people`,
 * which a later event imports from) has the same photo. Null when that could not be read —
 * then nothing is deleted, which is always safe.
 */
async function stillUsed(supabase: Client, byAlias: Map<string, string>, scope: PurgeScope): Promise<Set<string> | null> {
  const used = new Set<string>();
  const purged = (row: { id: string; event_id: string; removed_at: string | null }) =>
    "attendeeIds" in scope ? scope.attendeeIds.includes(row.id) : row.event_id === scope.removedOf && row.removed_at !== null;
  const aliases = [...byAlias.keys()];
  // In small batches: every alias rides in the query string.
  for (let i = 0; i < aliases.length; i += 20) {
    const batch = aliases.slice(i, i + 20);
    const seats = await supabase.from("attendees").select("id, event_id, removed_at, photo_path").in("photo_path", batch);
    if (seats.error) {
      logFailure("photo reference check", seats.error);
      return null;
    }
    for (const row of seats.data ?? []) {
      const key = row.photo_path ? byAlias.get(row.photo_path) : undefined;
      if (key && !purged(row)) used.add(key);
    }
    const people = await supabase.from("people").select("photo_path").in("photo_path", batch);
    if (people.error) {
      if (missingTable(people.error)) continue; // a database without the directory
      logFailure("photo reference check", people.error);
      return null;
    }
    for (const row of people.data ?? []) {
      const key = row.photo_path ? byAlias.get(row.photo_path) : undefined;
      if (key) used.add(key);
    }
  }
  return used;
}

/**
 * Delete the photos of the seats a purge takes: a bare key is removed from `faces`; any other
 * address (a pasted link) is left alone; and none of them while a row the purge keeps, or the
 * directory, still uses the same photo.
 *
 * `ok: false` only when storage refused a delete it was asked for (the route then stops before
 * the rows go, so the host can try again). A file that is already gone is not a failure.
 */
export async function deleteFacePhotos(
  supabase: Client,
  paths: readonly (string | null | undefined)[],
  scope: PurgeScope,
): Promise<{ ok: true; deleted: number; kept: number } | { ok: false; error: string }> {
  const unique = [...new Set(paths.map((p) => (p ?? "").trim()).filter(Boolean))];
  if (!unique.length) return { ok: true, deleted: 0, kept: 0 };

  const byAlias = new Map<string, string>();
  const keys: string[] = [];
  for (const path of unique) {
    if (isAbsoluteUrl(path)) continue;
    keys.push(path);
    for (const alias of [path, ...supabaseAliases(SUPABASE_URL, FACES_BUCKET, path)]) byAlias.set(alias, path);
  }
  if (!keys.length) return { ok: true, deleted: 0, kept: unique.length };

  const used = await stillUsed(supabase, byAlias, scope);
  const doomed = used ? keys.filter((k) => !used.has(k)) : [];
  if (doomed.length) {
    const { error } = await supabase.storage.from(FACES_BUCKET).remove(doomed);
    if (error) {
      logFailure("photo delete", error);
      return { ok: false, error: error.message };
    }
  }
  return { ok: true, deleted: doomed.length, kept: unique.length - doomed.length };
}
