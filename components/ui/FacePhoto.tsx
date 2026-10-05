"use client";

import type { CSSProperties } from "react";

import { faceStyle, framingOf, type FaceFraming } from "@/lib/faceFraming";
import { useFaceSrc } from "@/lib/faceCache";
import { initialsOf, pclFor } from "@/lib/design/cib";
import type { AttendeeFaceRow } from "@/lib/supabase/types";

/**
 * A person's photo — round, plain; their initials only when there is no photo
 * (docs/DESIGN.md §7.4, §13 3.3). No glass shell, no inner light, no glow.
 * The photos are cut-outs on a transparent background, so letters drawn under a
 * photo would show through it (Belal, 2026-09-29): the initials are drawn only
 * while there is no photo to show, or after it failed to load.
 *
 * Source order is unchanged: the Supabase `faces` bucket, then nothing — an
 * empty face shows the initials on the person's own colour (the mockup's `INI`
 * on `PCL`, L2887–2888), which reads as "no photo yet", where a broken-image
 * glyph reads as a bug. lib/faceCache has usually fetched the bytes before the
 * screen mounts, so the photo is there on the first frame.
 *
 * The framing is the person's own (lib/faceFraming): a host's half-body crop
 * anchors to the bottom, and a photo the host aligned renders exactly as it
 * was aligned.
 */

/**
 * The role base for a plain round photo. The orb drew members at .9 inside a
 * glass rim; a plain circle is filled edge to edge, so members sit at 1. Hosts
 * keep the half-body zoom.
 */
const PLAIN_BASE = { host: 1.35, member: 1 } as const;

/** The photo's own layer, clipped by the round parent. */
const PHOTO_LAYER: CSSProperties = { position: "absolute", inset: 0, display: "block" };

/** The <img> for one face, framed. Renders nothing while there is no source. */
export function FacePhoto({
  face,
  objectPosition,
  transform,
  transformOrigin = "center bottom",
  objectFit = "cover",
  transition,
  srcOverride,
  resolved,
}: {
  face: AttendeeFaceRow;
  objectPosition: string;
  transform: string;
  transformOrigin?: string;
  /** "contain" for aligned faces — the whole frame, never pre-cropped. */
  objectFit?: "cover" | "contain";
  transition?: string;
  /**
   * An already-resolved URL to show INSTEAD of resolving one from `face`.
   *
   * Only the admin photo aligner passes it: the picture being aligned is often
   * a freshly-picked data URL no bucket has seen. useFaceSrc is still called
   * unconditionally — hooks cannot be skipped — and the aligner hands it a row
   * with a blank photo_path so it resolves to nothing.
   */
  srcOverride?: string | null;
  /** The source a parent already resolved (Face and FaceOrb need to know whether there is a photo). */
  resolved?: { src: string | null; onError: () => void };
}) {
  const own = useFaceSrc(face);
  const { src, onError } = resolved ?? own;
  const shown = srcOverride ?? src;

  if (!shown) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={shown}
      /*
       * Decorative: every screen that shows a face prints the name beside it,
       * and a non-empty alt would be painted inside the circle while a source
       * is failing, typing the person's name into their own photo.
       */
      alt=""
      referrerPolicy="no-referrer"
      decoding="async"
      onError={onError}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        objectFit,
        transformOrigin,
        objectPosition,
        transform,
        transition,
      }}
    />
  );
}

/** The CSS a plain round face needs for this person's framing. */
export function plainFaceStyle(face: AttendeeFaceRow, framing?: FaceFraming, scale?: number) {
  const isHost = face.role === "host";
  return faceStyle(framing ?? framingOf(face), scale ?? (isHost ? PLAIN_BASE.host : PLAIN_BASE.member), isHost);
}

/**
 * A face filling its parent: a circle on the person's colour, then their photo,
 * or their initials when there is none. The name and props are the old orb's, kept because
 * other screens import them; the look is a plain round photo now.
 */
export function FaceOrb({
  face,
  filter,
  ringShadow,
  scale,
  framing,
  srcOverride,
}: {
  face: AttendeeFaceRow;
  /** Passed through to the circle. The design uses none (no glow, §4.4). */
  filter?: string;
  /** A ring drawn as a box-shadow, e.g. the selected state. */
  ringShadow?: string;
  /** Overrides the role base; the person's own zoom still multiplies it. */
  scale?: number;
  /** Framing to render with instead of the stored one (the admin aligner's live drag). */
  framing?: FaceFraming;
  /** See FacePhoto. Only the admin aligner passes it. */
  srcOverride?: string | null;
}) {
  const css = plainFaceStyle(face, framing, scale);
  const photo = useFaceSrc(face);
  const hasPhoto = Boolean(srcOverride ?? photo.src);
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        overflow: "hidden",
        background: pclFor(face.id),
        boxShadow: ringShadow,
        filter,
        containerType: "inline-size",
      }}
    >
      {hasPhoto ? null : (
        <span
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-white)",
            fontWeight: 700,
            fontSize: "36cqw",
            lineHeight: 1,
          }}
        >
          {initialsOf(face.full_name)}
        </span>
      )}
      <span style={PHOTO_LAYER}>
        <FacePhoto
          face={face}
          resolved={photo}
          srcOverride={srcOverride}
          objectFit={css.objectFit}
          objectPosition={css.objectPosition}
          transform={css.transform}
          transformOrigin={css.transformOrigin}
        />
      </span>
    </div>
  );
}

/**
 * One face as the mockup's round element — `.sc .pep u`, `.sc .prof u`,
 * `.sc .bubs u`, `.hall .faces u` — sized by the class around it: the person's
 * colour, then their photo, or their initials when there is none.
 *
 *   <div className="pep"><Face face={row} /><span className="tt">…</span></div>
 */
export function Face({
  face,
  className,
  style,
  srcOverride,
}: {
  face: AttendeeFaceRow;
  className?: string;
  style?: CSSProperties;
  srcOverride?: string | null;
}) {
  const css = plainFaceStyle(face);
  const photo = useFaceSrc(face);
  const hasPhoto = Boolean(srcOverride ?? photo.src);
  return (
    <u
      className={className}
      style={{ position: "relative", overflow: "hidden", textDecoration: "none", background: pclFor(face.id), ...style }}
      aria-hidden
    >
      {hasPhoto ? null : initialsOf(face.full_name)}
      <span style={PHOTO_LAYER}>
        <FacePhoto
          face={face}
          resolved={photo}
          srcOverride={srcOverride}
          objectFit={css.objectFit}
          objectPosition={css.objectPosition}
          transform={css.transform}
          transformOrigin={css.transformOrigin}
        />
      </span>
    </u>
  );
}
