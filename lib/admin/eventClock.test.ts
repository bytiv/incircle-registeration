import assert from "node:assert/strict";
import { test } from "node:test";

import { fromEventInput, toEventInput } from "./eventClock";

/**
 * THE EVENT'S DATE, AS THE HOST PICKS IT — the picker's value is a wall time in the event's zone
 * (NEXT_PUBLIC_EVENT_TZ, Africa/Cairo by default), whatever zone the server or the browser is in.
 * Run with `npm test`.
 */

test("a Cairo wall time round-trips through the stored instant", () => {
  const iso = fromEventInput("2026-11-12T09:30");
  assert.equal(iso, "2026-11-12T07:30:00.000Z");
  assert.equal(toEventInput(iso), "2026-11-12T09:30");
});

test("summer time in Cairo is UTC+3", () => {
  assert.equal(fromEventInput("2026-07-01T18:00"), "2026-07-01T15:00:00.000Z");
  assert.equal(toEventInput("2026-07-01T15:00:00.000Z"), "2026-07-01T18:00");
});

test("nothing reads as nothing", () => {
  assert.equal(toEventInput(null), "");
  assert.equal(toEventInput("not a date"), "");
  assert.equal(fromEventInput(""), null);
  assert.equal(fromEventInput("12/11/2026"), null);
});
