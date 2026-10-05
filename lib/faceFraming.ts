import type { AttendeeFaceRow, AttendeeRole } from "@/lib/supabase/types";

/**
 * Where inside their photo a person's face is — the one place that turns the
 * three stored columns into CSS.
 *
 * NOT FROM THE DESIGN. Asked for after Part 14 (Belal, 2026-08-21): "the
 * picture on the profiles, we should be able to align it ourselves like on edit
 * or when we are adding it new, so like we can see how it will look like".
 *
 * Until now framing was derived from ROLE alone, in several places at once:
 * hosts `object-position: bottom` at scale 1.35, members `center` at 0.9
 * (components/ui/FacePhoto.tsx), and again in find-yourself/FaceBubble.tsx. That is the right DEFAULT — host photos really
 * are half-body crops and members' really are square headshots — and the wrong
 * RULE, because a photo whose face sits high and left is mis-framed on every
 * screen with no way to fix it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ALIGNED BRANCH DOES NOT USE object-position
 *
 * The obvious implementation is object-position over `cover`. It fails twice,
 * and both failures are silent. First: cover only has something to position
 * when the source overflows the box, and 28 of the 40 bucket photos sampled are
 * EXACTLY square (470x470, 512x512, 300x300, the six 72x74 thumbnails) inside a
 * square chamber — the host would drag and nothing would move. Second, and
 * worse: cover discards the overflowing strip of a non-square photo BEFORE any
 * transform runs, so the cropped-away part of a portrait shot can never be
 * brought back into view, at any zoom — exactly the "no matter how i make them
 * smaller i cant get back the cropped area" Belal hit.
 *
 * So an aligned face renders `contain` and is moved with a plain translate:
 * the whole frame, slid under the round window. Nothing is ever pre-cropped;
 * the only clipping is the circular mask itself. x/y 0..100 map linearly to a
 * ±50%-of-frame translate, so a drag always moves, whatever the source shape.
 *
 * WHY `aligned` IS PART OF THE VALUE. An untouched person must render the same
 * bytes of CSS as before this change — all 116 of them, on every screen — and
 * the old look is a DIFFERENT MECHANISM (cover + the center/bottom keywords +
 * a bottom-anchored origin), not a coordinate this model can express. So the
 * default is a separate branch, and `aligned` selects it. Null columns take
 * the branch that is byte-for-byte what shipped.
 *
 * `zoom` is a MULTIPLIER over whatever base the surface already uses, never an
 * absolute scale. A surface picks its base for the size of its bubbles (1.35/0.9
 * on the phone and projector orbs, ORB_BASE below). Storing an absolute scale
 * would mean flattening every surface onto one number, which would visibly
 * re-frame every existing face for a request nobody made.
 *
 * Kept out of lib/photos.ts on purpose: that file imports the brand PNGs as
 * next/image modules, which a `node --test` process cannot load, and these
 * defaults are exactly the thing worth testing. Kept out of lib/faceCache.ts
 * too — that is a URL resolver keyed on face.id and carries no geometry.
 */

export type FaceFraming = {
  /** object-position X, as a percentage. 50 = centred. */
  x: number;
  /** object-position Y, as a percentage. 100 = bottom of the photo. */
  y: number;
  /** Multiplier over the surface's own role base. 1 = leave the base alone. */
  zoom: number;
  /**
   * False means "the host has never touched this photo" — render the role
   * default exactly as it always has been, ignoring x/y/zoom. See above.
   */
  aligned: boolean;
};

/** What a person gets when the host has never touched their photo. */
export function roleFraming(role: AttendeeRole): FaceFraming {
  // These two are where the aligner STARTS, not what the unaligned branch
  // renders: `bottom` === "50% 100%" and `center` === "50% 50%", so a host
  // opens on the bottom of their half-body crop and a member on the middle.
  return { x: 50, y: role === "host" ? 100 : 50, zoom: 1, aligned: false };
}

/**
 * The framing to render this face with.
 *
 * `??` and not `||`: photo_x = 0 is a legitimate "hard left", and `||` would
 * silently swap it for the centre — the one bug that would make the aligner
 * feel broken at exactly one end of its travel.
 */
export function framingOf(
  face: Pick<AttendeeFaceRow, "role" | "photo_x" | "photo_y" | "photo_zoom">,
): FaceFraming {
  const base = roleFraming(face.role);
  // Any one of the three being set means the host aligned this person. They are
  // written together, but a partial row must not fall between the two branches.
  const aligned =
    face.photo_x !== null || face.photo_y !== null || face.photo_zoom !== null;
  return {
    x: face.photo_x ?? base.x,
    y: face.photo_y ?? base.y,
    zoom: face.photo_zoom ?? base.zoom,
    aligned,
  };
}

/** The CSS value. Kept here so no caller hand-builds the string. */
export function objectPositionOf(f: FaceFraming): string {
  return `${f.x}% ${f.y}%`;
}

/**
 * The surface's role base, multiplied by the person's zoom.
 *
 * Rounded to 3dp because these land in a `transform` string that React diffs as
 * text: 0.9 * 1.1 is 0.9900000000000001 in binary floating point, and an orb
 * whose transform changes identity on every render loses its CSS transition.
 */
export function scaledBase(base: number, f: FaceFraming): number {
  return Math.round(base * f.zoom * 1000) / 1000;
}

/** Everything one <img> needs. The four face render sites all go through this. */
export type FaceStyle = {
  objectFit: "cover" | "contain";
  objectPosition: string;
  transform: string;
  transformOrigin: string;
};

/**
 * @param base   the surface's own role scale, already multiplied by anything
 *               the surface adds on top (FaceBubble's x1.08 on selection).
 * @param isHost drives the bottom-anchored default. Read from the row, not from
 *               the framing, because it is what the UNALIGNED branch keys on.
 */
export function faceStyle(f: FaceFraming, base: number, isHost: boolean): FaceStyle {
  const s = scaledBase(base, f);

  if (!f.aligned) {
    // Byte-identical to what every one of these sites rendered before the
    // stored framing existed. lib/faceFraming.test.ts pins both strings.
    return {
      objectFit: "cover",
      objectPosition: isHost ? "bottom" : "center",
      transform: `scale(${s}) translateY(${isHost ? 11 : 0}%)`,
      transformOrigin: "center bottom",
    };
  }

  /*
   * Aligned: the simplest model that can be right — the WHOLE image, moved.
   *
   * `contain`, not `cover`, and that is the crux (Belal, 2026-08-21: "make
   * sure the thing doesnt crop images because i see some images cropped and no
   * matter how i make them smaller i cant get back the cropped area"). Cover
   * throws away whatever overflows the box BEFORE any transform runs, so the
   * discarded strip of a portrait photo can never be scrolled back into view
   * no matter the zoom. Contain pre-crops nothing: at zoom 1 the full frame is
   * visible inside the chamber, zooming out shrinks it whole, and the only
   * clipping left is the round mask itself. The drag is a plain translate —
   * x/y 0..100 map to ±50% of the frame — a photo slid under a round window.
   */
  const tx = Math.round(((50 - f.x) / 50) * 50 * 100) / 100;
  const ty = Math.round(((50 - f.y) / 50) * 50 * 100) / 100;
  return {
    objectFit: "contain",
    objectPosition: "center",
    transform: `scale(${s}) translate(${tx}%, ${ty}%)`,
    // Symmetric, so the translate above is the only thing that moves the frame.
    transformOrigin: "center center",
  };
}

/** The role base the orb surfaces pair with, kept next to the framing it feeds. */
export const ORB_BASE = { host: 1.35, member: 0.9 } as const;
