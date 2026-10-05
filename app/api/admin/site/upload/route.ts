import { NextResponse } from "next/server";

import { isUnlocked } from "@/lib/admin/auth";
import { PictureRefused, saveSitePicture } from "@/lib/storage";
import { UPLOAD_MAX_BYTES } from "@/lib/storage/keys";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A PICTURE ONTO THE PUBLIC PAGE — the hero, or a photo for the album — from the page's own
 * edit mode, behind the passcode like every /api/admin route.
 *
 *   POST multipart/form-data { file, kind: "hero" | "album" }  →  { ok: true, url }
 *
 * The browser has already made the picture web-sized (components/site/upload.ts: 2200 px on the
 * long edge, JPEG or WebP; a GIF untouched so it still moves) and sends it as a file, not a data
 * URL, so the request stays under Vercel's 4.5 MB limit. lib/storage keeps it in the public
 * `site` bucket and answers the address the page's content keeps.
 */
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });
const TOO_BIG = "That picture is over 4 MB. Pictures are made smaller before they upload, so this one is unusual: try a smaller file.";

export async function POST(request: Request) {
  if (!(await isUnlocked())) return fail("Signed out. Sign in again to edit the page.", 401);

  // Refused before it is read: the form's own fields add a little to the file.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > UPLOAD_MAX_BYTES + 64 * 1024) return fail(TOO_BIG, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("That upload did not arrive in one piece. Try again.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return fail("No picture arrived.", 400);
  if (file.size > UPLOAD_MAX_BYTES) return fail(TOO_BIG, 413);
  const kind = form.get("kind") === "hero" ? "hero" : "album";

  try {
    const url = await saveSitePicture(createAdminClient(), { kind, bytes: new Uint8Array(await file.arrayBuffer()) });
    return NextResponse.json({ ok: true, url }, { headers: noStore });
  } catch (err) {
    if (err instanceof PictureRefused) return fail(err.message, err.status);
    return fail(err instanceof Error ? err.message : "That picture did not upload.", 500);
  }
}
