import assert from "node:assert/strict";
import { test } from "node:test";

import {
  faceStyle,
  framingOf,
  objectPositionOf,
  ORB_BASE,
  roleFraming,
  scaledBase,
} from "./faceFraming";

/**
 * The per-person photo framing. Run with `npm test`.
 *
 * One property carries this whole feature: an UNALIGNED person must render the
 * same CSS after the change as before it. Every face on every screen used to be
 * framed by role alone, and faceStyle() now stands in front of all four render
 * sites. If its unaligned branch ever drifts, all 93 seeded faces re-frame at
 * once — on the phones, on P1's strip and on the hall screens — and nothing else
 * in this suite would say a word about it. So the strings are pinned literally,
 * exactly as they were written at the call sites before.
 *
 * The aligned branch guards the opposite promise (Belal, 2026-08-21): NOTHING
 * IS EVER PRE-CROPPED. It must be `contain` — `cover` discards the overflow of
 * a non-square photo before any transform runs, which is exactly the "no matter
 * how i make them smaller i cant get back the cropped area" complaint — and its
 * drag must always move, whatever the source shape or zoom.
 *
 * Also pinned: the `??` in framingOf. photo_x = 0 is "hard left", a real place
 * a face can be and the exact end of the aligner's travel, which `||` would
 * swallow — reading as "dragging stops working near the edge" rather than as a
 * wrong operator.
 */

const member = {
  role: "member" as const,
  photo_x: null,
  photo_y: null,
  photo_zoom: null,
};
const host = { role: "host" as const, photo_x: null, photo_y: null, photo_zoom: null };

test("an unaligned member renders exactly what it always did", () => {
  assert.deepEqual(framingOf(member), { x: 50, y: 50, zoom: 1, aligned: false });
  assert.deepEqual(faceStyle(framingOf(member), ORB_BASE.member, false), {
    objectFit: "cover",
    objectPosition: "center",
    transform: "scale(0.9) translateY(0%)",
    transformOrigin: "center bottom",
  });
});

test("an unaligned host renders exactly what it always did", () => {
  assert.deepEqual(framingOf(host), { x: 50, y: 100, zoom: 1, aligned: false });
  assert.deepEqual(faceStyle(framingOf(host), ORB_BASE.host, true), {
    objectFit: "cover",
    objectPosition: "bottom",
    transform: "scale(1.35) translateY(11%)",
    transformOrigin: "center bottom",
  });
});

test("the aligner starts from the role default, which is not the rendered branch", () => {
  // roleFraming is where a drag BEGINS: a host opens on the bottom of their
  // half-body crop, a member on the middle, both unaligned until touched.
  assert.equal(objectPositionOf(roleFraming("member")), "50% 50%");
  assert.equal(objectPositionOf(roleFraming("host")), "50% 100%");
  assert.equal(roleFraming("member").aligned, false);
});

test("any one stored column makes the person aligned", () => {
  // The three are written together, but a half-written row must not fall
  // between the two branches and render something nobody chose.
  assert.equal(framingOf({ ...member, photo_x: 40 }).aligned, true);
  assert.equal(framingOf({ ...member, photo_y: 40 }).aligned, true);
  assert.equal(framingOf({ ...member, photo_zoom: 1.4 }).aligned, true);
  assert.equal(framingOf(member).aligned, false);
});

test("a stored 0 survives as 0 and is not read as absent", () => {
  const hardLeft = { ...member, photo_x: 0, photo_y: 0 };
  assert.equal(framingOf(hardLeft).x, 0);
  assert.equal(framingOf(hardLeft).y, 0);
});

test("stored values override the role default one axis at a time", () => {
  const aligned = { role: "host" as const, photo_x: 34, photo_y: null, photo_zoom: 1.5 };
  assert.deepEqual(framingOf(aligned), { x: 34, y: 100, zoom: 1.5, aligned: true });
});

test("zoom multiplies the surface base rather than replacing it", () => {
  // The three surfaces keep their own bases (orb 0.9, strip 0.72); a person's
  // zoom is the same relative nudge on each.
  const z2 = { x: 50, y: 50, zoom: 2, aligned: true };
  assert.equal(scaledBase(0.9, z2), 1.8);
  assert.equal(scaledBase(0.72, z2), 1.44);
  // Rounded, so the transform string keeps its identity between renders and the
  // orb's CSS transition survives.
  assert.equal(scaledBase(0.9, { x: 50, y: 50, zoom: 1.1, aligned: true }), 0.99);
});

test("an aligned face is contain — never pre-cropped", () => {
  // The crux: `cover` throws away the overflowing strip of a portrait photo
  // BEFORE any transform runs, so no zoom could ever bring it back. `contain`
  // keeps the whole frame; only the round mask clips.
  const css = faceStyle({ x: 50, y: 50, zoom: 1, aligned: true }, 1, false);
  assert.equal(css.objectFit, "contain");
  assert.equal(css.objectPosition, "center");
  assert.equal(css.transformOrigin, "center center");
});

test("dragging always moves, whatever the zoom — x/y map to ±50% of the frame", () => {
  const at = (x: number, y: number) =>
    faceStyle({ x, y, zoom: 1, aligned: true }, 1, false).transform;
  // x = 0 is "show the LEFT of the photo": the photo slides RIGHT, a positive
  // translate. There is no shape or zoom at which this is a no-op.
  assert.equal(at(0, 50), "scale(1) translate(50%, 0%)");
  assert.equal(at(100, 50), "scale(1) translate(-50%, 0%)");
  assert.equal(at(50, 50), "scale(1) translate(0%, 0%)");
  assert.equal(at(50, 0), "scale(1) translate(0%, 50%)");
  assert.equal(at(50, 100), "scale(1) translate(0%, -50%)");
});

test("an aligned host loses the role nudge — their own numbers are the framing", () => {
  const css = faceStyle({ x: 20, y: 80, zoom: 2, aligned: true }, 1, true);
  // No translateY(11%), no bottom keyword: once aligned, what the host set is
  // the whole story, host and member alike.
  assert.equal(css.transform, "scale(2) translate(30%, -30%)");
  assert.equal(css.objectFit, "contain");
});
