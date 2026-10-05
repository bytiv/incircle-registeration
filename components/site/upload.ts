"use client";

import type { SitePhoto } from "@/lib/sitePage";

/**
 * A PICTURE FOR THE PAGE, FROM THE HOST'S COMPUTER OR PHONE — made web-sized here, in the
 * browser, then sent to app/api/admin/site/upload, which keeps it in Supabase Storage.
 *
 * Made smaller on the way so the request stays under Vercel's 4.5 MB limit and the page stays
 * fast: 2200 px on the long edge, a JPEG at 0.86 — or a WebP when the picture has see-through
 * parts (a logo, a cut-out), so they stay see-through. A GIF goes as it is, so it still moves.
 */

const MAX_EDGE = 2200;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file is not a picture this browser can read."));
    };
    img.src = url;
  });
}

function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
  } catch {
    return true;
  }
}

const toBlob = (c: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));

/** The picture, web-sized, with its size. */
async function prepare(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const img = await loadImage(file);
  if (file.type === "image/gif") return { blob: file, w: img.naturalWidth, h: img.naturalHeight };
  const k = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("This browser cannot prepare the picture.");
  ctx.drawImage(img, 0, 0, w, h);
  const alpha = file.type !== "image/jpeg" && hasAlpha(ctx, w, h);
  const blob = (alpha ? await toBlob(c, "image/webp", 0.9) : null) ?? (await toBlob(c, "image/jpeg", 0.86));
  if (!blob) throw new Error("This browser cannot prepare the picture.");
  return { blob, w, h };
}

/** Uploads one picture for the page; resolves with what the page keeps. Throws the refusal's words. */
export async function uploadSitePicture(file: File, kind: "hero" | "album"): Promise<SitePhoto> {
  const { blob, w, h } = await prepare(file);
  const form = new FormData();
  form.append("file", blob, file.name);
  form.append("kind", kind);
  let res: Response;
  try {
    res = await fetch("/api/admin/site/upload", { method: "POST", body: form });
  } catch {
    throw new Error("The picture did not reach the server. Check the connection and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? "That picture did not upload.");
  return { src: body.url, w, h, alt: "" };
}
