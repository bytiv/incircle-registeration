"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { motion } from "motion/react";

import type { AttendeeRole } from "@/lib/supabase/types";
import type { FaceFraming } from "@/lib/faceFraming";
import { spring } from "@/lib/motion";

/*
 * A person removed from their own drawer (RowEditor's Remove): People fades their card out as the
 * drawer closes, without waiting for the refreshed list, and brings it back if the removal failed
 * (docs/DESIGN.md §15.4). The drawer is AdminRoot's and the list is PeopleView's, so the two meet
 * here rather than through the root.
 */
const leaving = new Set<string>();
const leavingSubs = new Set<() => void>();
const NONE: ReadonlySet<string> = new Set();
let leavingNow: ReadonlySet<string> = NONE;
export function markLeaving(id: string, on: boolean) {
  if (on) leaving.add(id);
  else leaving.delete(id);
  leavingNow = new Set(leaving);
  for (const f of leavingSubs) f();
}
export function useLeaving(): ReadonlySet<string> {
  return useSyncExternalStore(
    (f) => {
      leavingSubs.add(f);
      return () => {
        leavingSubs.delete(f);
      };
    },
    () => leavingNow,
    () => NONE,
  );
}

/**
 * While a drawer is open over People, the page behind it stays put.
 *
 * The control room scrolls in `.app > main`, and a wheel or a swipe over the
 * scrim (or over a drawer too short to scroll) chains to it, so the list slid
 * away under the person you were reading. Its overflow is held while this is
 * on; the gutter stays, so the page behind does not shift sideways by the
 * scrollbar's width. Counted, so two overlays never release each other's hold.
 */
export function usePageScrollLock(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const main = document.querySelector<HTMLElement>(".app > main");
    if (!main) return;
    const holds = Number(main.dataset.scrollHolds ?? 0);
    if (holds === 0) {
      const scrolls = main.scrollHeight > main.clientHeight;
      main.style.overflowY = "hidden";
      if (scrolls) main.style.scrollbarGutter = "stable";
    }
    main.dataset.scrollHolds = String(holds + 1);
    return () => {
      const left = Number(main.dataset.scrollHolds ?? 1) - 1;
      main.dataset.scrollHolds = String(Math.max(0, left));
      if (left <= 0) {
        main.style.overflowY = "";
        main.style.scrollbarGutter = "";
        delete main.dataset.scrollHolds;
      }
    };
  }, [on]);
}

/**
 * Member or host: two options on one track, the chosen one in the brand blue,
 * the thumb sliding on the snappy spring. What Host does (listed first, a larger
 * photo) is its guide (components/admin/guide), not a line under it.
 */
export function RoleSwitch({ value, set }: { value: AttendeeRole; set: (r: AttendeeRole) => void }) {
  const thumb = useId();
  return (
    <div>
      <div className="ppl-role" role="radiogroup" aria-label="Shows as">
        {(["member", "host"] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value === r}
            onClick={() => set(r)}
            data-guide={r === "host" ? "Lists them first, with a larger photo." : "Shows them like everyone else in the room."}
          >
            {value === r ? <motion.span layoutId={`role-${thumb}`} className="thumb" transition={spring.snappy} aria-hidden /> : null}
            <span className="tl">{r === "host" ? "Host" : "Member"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The pieces the person form (PersonForm: adding and editing) and the pages
 * around it share: the photo reader, the framing comparison, the member/host
 * switch, and the helpers above. The photo reader is also the public
 * registration form's (components/site/SiteForm.tsx), so its shape stays as it is.
 */

/** The long edge, in px. Matches what scripts/roster-restore.mjs gave the seeded photos. */
const MAX_EDGE = 512;

/**
 * The one source that can never carry an alpha channel, so the only one worth
 * excusing from the per-pixel scan below. Everything else — png, webp, gif,
 * avif, an svg, a file the OS handed over with a blank type — gets looked at.
 */
const NEVER_ALPHA = /^image\/jpe?g$/i;

/**
 * A picked file becomes a downscaled data URL — the WHOLE frame, aspect ratio
 * intact, and whatever transparency it arrived with intact along with it.
 *
 * design:462-483 centre-cropped to a hard 200x200 square. That has to go, and
 * not as a tidy-up: the crop is applied at RENDER time now, from the person's
 * photo_x / photo_y / photo_zoom (lib/faceFraming.ts). Cropping here as well
 * would crop twice — first blindly to the middle, then again to wherever the
 * host dragged — and the first cut is the one that throws away the face when it
 * is not in the middle, permanently, before anybody can look at it.
 *
 * So: keep everything, shrink to 512 on the long edge, and let object-fit:cover
 * plus the stored object-position do the cropping, live and reversibly. 512
 * because the largest face the room draws is the hall's and a host
 * photo scales 1.35x inside it — 200 was already too small for that — and
 * because it is what the seeded bucket photos were shrunk to, so every source
 * is treated alike.
 *
 * ON THE ENCODING (Belal, 2026-08-22: "the background that is supposed to be
 * cropped is black where it should be transparent"). This used to hand every
 * picked file to toDataURL("image/jpeg"), which is wrong for the photos hosts
 * actually upload: a background-removed cutout is a PNG with an alpha channel,
 * JPEG has no alpha, and the canvas pixels under a removed background are
 * transparent BLACK — so the cutout came back as a hard black silhouette in the
 * face. Nothing downstream could undo that; the black was baked into the bytes
 * before they ever left the browser.
 *
 * The encoder is picked from the picture instead. A file that could carry alpha
 * is scanned for one non-opaque pixel, and if it has one it goes out as WebP
 * (lossy, alpha kept), or PNG where the browser will not write WebP. Anything
 * opaque — every camera photo — still goes out as the same 0.85 JPEG, because a
 * fully opaque portrait re-encoded as PNG is several times the bytes for no
 * visible gain. app/api/admin/people/route.ts already reads the bucket file's
 * extension off the data URL's mime type, so these land as `${slug}.webp` or
 * `${slug}.png` with no change there.
 */
export function readUploadDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That file is not an image."));
      img.onload = () => {
        // Shrink only. A small photo blown up to 512 is bytes spent on nothing.
        const k = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("Canvas is unavailable."));
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const keepAlpha = !NEVER_ALPHA.test(file.type) && hasAlpha(ctx, c.width, c.height);
        resolve(keepAlpha ? encodeKeepingAlpha(c) : c.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** One non-opaque pixel is enough. ~260k reads on a 512px frame — unnoticeable. */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // Only a cross-origin source taints a canvas and this one is a FileReader
    // data URL, so this cannot fire here. If it somehow does, keeping the alpha
    // is the safe half of the guess: a needlessly-PNG'd photo is just heavier,
    // a wrongly-JPEG'd cutout is black.
    return true;
  }
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * WebP first: a lossy WebP with alpha is a fraction of the PNG of the same
 * cutout. toDataURL falls back to PNG SILENTLY when it cannot write the type it
 * was asked for, so the answer is checked rather than trusted — and PNG is the
 * fallback either way, so an older browser still keeps the transparency.
 */
function encodeKeepingAlpha(c: HTMLCanvasElement): string {
  const webp = c.toDataURL("image/webp", 0.9);
  return webp.startsWith("data:image/webp") ? webp : c.toDataURL("image/png");
}

/**
 * Same coordinates? Floats off a slider, so compared with a tolerance, never
 * with identity. Deliberately ignores `aligned` — this answers "is the photo in
 * the same place", and whether it got there by default or by hand is a separate
 * question saveEdit asks separately.
 */
export function sameCoords(a: FaceFraming, b: FaceFraming): boolean {
  return (
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.y - b.y) < 0.01 &&
    Math.abs(a.zoom - b.zoom) < 0.005
  );
}
