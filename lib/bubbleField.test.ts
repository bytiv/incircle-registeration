import assert from "node:assert/strict";
import { test } from "node:test";

import { continueField, orderFaces, placeFaces, type OrderableFace } from "./bubbleField";

/**
 * The orb field, which is now DERIVED rather than stored. Run with `npm test`.
 *
 * These lock in the two properties the roster depends on all day: the field
 * closes up behind anyone who is removed (it used to leave a permanent hole,
 * and 23 removals opened 11 gaps of up to 240px), and the people whose photo we
 * hold stay above the empty glass shells.
 */

const BUBBLE = 82;
/**
 * What turns a left% into pixels. The field container is `maxWidth: 345`
 * (components/screens/FindYourself.tsx:179), so a percent is 3.45px — NOT the
 * ~14 an unbounded viewport would suggest. Getting this wrong inflates every
 * measured distance ~4x and the overlap assertion below can then never fire.
 */
const PX_PER_PCT = 3.45;

function person(i: number, over: Partial<OrderableFace> = {}): OrderableFace {
  return {
    full_name: `Person ${String(i).padStart(3, "0")}`,
    role: "member",
    photo_path: `p${i}.png`,
    bubble_top: i * 40,
    bubble_left: "50.0%",
    ...over,
  };
}

const steps = (placed: OrderableFace[]): number[] =>
  placed.slice(1).map((f, i) => (f.bubble_top ?? 0) - (placed[i].bubble_top ?? 0));

test("the field has no gaps, at any roster size", () => {
  for (const n of [1, 2, 3, 7, 44, 53, 93, 120, 400]) {
    const placed = placeFaces(Array.from({ length: n }, (_, i) => person(i)));
    assert.equal(placed.length, n, `kept everyone at n=${n}`);
    for (const d of steps(placed)) {
      assert.ok(d >= 34 && d <= 46, `step ${d} outside the design's 34-46px at n=${n}`);
    }
  }
});

test("removing anyone closes the gap behind them", () => {
  const all = Array.from({ length: 93 }, (_, i) => person(i));
  // Drop a fifth of the room from scattered positions, as a real removal sweep does.
  const fewer = all.filter((_, i) => i % 5 !== 0);
  const placed = placeFaces(fewer);

  assert.equal(placed.length, 74);
  assert.ok(Math.max(...steps(placed)) <= 46, "a removal must not stretch the field");
  // The regression this guards: the old stored-position field left the removed
  // person's slot empty, so this same sweep produced steps of 80-240px.
  assert.equal(steps(placed).filter((d) => d > 60).length, 0);
});

test("orbs never overlap, however tall the field gets", () => {
  const placed = placeFaces(Array.from({ length: 200 }, (_, i) => person(i)));
  let closest = Infinity;
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const dy = (placed[j].bubble_top ?? 0) - (placed[i].bubble_top ?? 0);
      if (dy > 3 * BUBBLE) break; // sorted by top; nothing further down can be closer
      const dx = (parseFloat(placed[j].bubble_left!) - parseFloat(placed[i].bubble_left!)) * PX_PER_PCT;
      closest = Math.min(closest, Math.hypot(dx, dy));
    }
  }
  assert.ok(closest > BUBBLE, `closest pair ${closest.toFixed(1)}px, orbs are ${BUBBLE}px`);
});

test("people with a photo float above people without", () => {
  const mixed = [
    person(0, { photo_path: null }),
    person(1),
    person(2, { photo_path: null }),
    person(3),
    person(4, { photo_path: null }),
    person(5),
  ];
  const placed = placeFaces(mixed);
  const firstBlank = placed.findIndex((f) => !f.photo_path);
  const lastPhoto = placed.map((f) => Boolean(f.photo_path)).lastIndexOf(true);
  assert.ok(lastPhoto < firstBlank, "every photo must sit above every blank shell");
  assert.equal(placed.filter((f) => f.photo_path).length, 3);
});

test("hosts lead the field even without a photo", () => {
  const placed = placeFaces([
    person(0),
    person(1, { role: "host", photo_path: null }),
    person(2),
  ]);
  assert.equal(placed[0].role, "host");
});

test("giving someone a photo lifts them, without disturbing the order otherwise", () => {
  const before = placeFaces([person(0), person(1, { photo_path: null }), person(2)]);
  assert.deepEqual(before.map((f) => f.full_name), ["Person 000", "Person 002", "Person 001"]);

  const after = placeFaces([person(0), person(1), person(2)]);
  assert.deepEqual(after.map((f) => f.full_name), ["Person 000", "Person 001", "Person 002"]);
});

test("placement is deterministic, so SSR and hydration agree", () => {
  const roster = Array.from({ length: 93 }, (_, i) => person(i, i % 3 ? {} : { photo_path: null }));
  assert.deepEqual(placeFaces(roster), placeFaces([...roster].reverse()));
});

test("ordering is total, so rows with no stored position cannot shuffle", () => {
  const roster = [
    person(1, { bubble_top: null, full_name: "Zoe" }),
    person(2, { bubble_top: null, full_name: "Adam" }),
    person(3, { bubble_top: 10, full_name: "Mid" }),
  ];
  assert.deepEqual(
    orderFaces(roster).map((f) => f.full_name),
    ["Mid", "Adam", "Zoe"],
    "positioned first, then unpositioned by name",
  );
  assert.deepEqual(orderFaces(roster), orderFaces([...roster].reverse()));
});

test("continueField still appends below an existing field", () => {
  // /api/admin/people leans on this to hand new arrivals a sequence key.
  const placed = placeFaces(Array.from({ length: 20 }, (_, i) => person(i)));
  const tail = continueField(placed, 2);
  const lowest = Math.max(...placed.map((f) => f.bubble_top ?? 0));
  assert.ok(tail[0].bubble_top > lowest, "a new arrival lands below everyone already placed");
  assert.ok(tail[1].bubble_top > tail[0].bubble_top);
});
