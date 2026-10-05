"use client";

import { useState } from "react";

/**
 * The design's `imgRef` (design:230-236), which every avatar in the admin uses:
 *
 *   imgRef = (el) => { … el.onerror = () => { el.style.visibility = "hidden"; } … }
 *
 * The photo sits absolutely on top of the initials, so hiding it on error is
 * what reveals them. The markup below is design:210 / 288 / 332 / 470 / 553 /
 * 664 verbatim — the same element appears in every view, only its wrapper
 * changes size.
 *
 * One addition the prototype did not need: an optional `fallback` URL, tried
 * when `src` fails before giving up and showing initials — the same chain
 * lib/faceCache walks on the phones.
 *
 * The initials are drawn HERE, and only while there is no photo to show (none,
 * or every source failed): the photos are cut-outs on a transparent background,
 * so letters kept underneath a photo showed through it (Belal, 2026-09-29).
 */
export function FaceImg({
  src,
  fallback,
  initials,
  objectFit,
  objectPosition,
  transform,
  transformOrigin,
}: {
  src: string | null;
  fallback?: string;
  /** The letters to show, in the wrapper's own `<span>`, when there is no photo. */
  initials?: string;
  /**
   * The person's stored framing, so the control room's avatars are framed the
   * way the room frames them. All default to undefined, which renders exactly
   * as this component always has. Call sites build them with lib/faceFraming's
   * faceStyle at base 1 — an aligned person shows their WHOLE photo (contain)
   * moved by their own pan, never a pre-crop.
   */
  objectFit?: "cover" | "contain";
  objectPosition?: string;
  transform?: string;
  transformOrigin?: string;
}) {
  const chain = [src, fallback].filter((s): s is string => Boolean(s));
  // Failures are remembered per source list, so a new photo starts from its first source.
  const chainKey = chain.join("|");
  const [failed, setFailed] = useState({ key: chainKey, step: 0 });
  const step = failed.key === chainKey ? failed.step : 0;
  const current = chain[step];
  if (!current) return initials ? <span>{initials}</span> : null;

  return (
    /*
     * A plain <img> on purpose. next/image cannot express what design:230-236
     * needs — an element that hides ITSELF on error so the initials underneath
     * show through — and these are 26-66px avatars served from Supabase Storage,
     * where the optimiser would add a hop for no gain.
     */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed({ key: chainKey, step: step + 1 })}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
        // An aligned person overrides the design's cover with `contain` — the
        // whole photo, moved — via the spread; unaligned leaves it verbatim.
        ...(objectFit ? { objectFit } : null),
        objectPosition,
        transform,
        transformOrigin,
        // design:234 — the failure mode is "get out of the way", not a broken icon.
        visibility: step < chain.length ? "visible" : "hidden",
      }}
    />
  );
}
