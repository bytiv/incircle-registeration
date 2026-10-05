import assert from "node:assert/strict";
import { test } from "node:test";

import { oneAtATime, patchStages, takesRow, wholeRow } from "./roomSync";

/**
 * THE PLUMBING UNDER EVERY PRESS (lib/roomSync.ts): which rows a page takes, how the run of show
 * is patched, and the line presses wait in. Run with `npm test`.
 */

test("seq guard: a push, an answer or a render is taken only when newer", () => {
  for (const via of ["push", "answer", "render"] as const) {
    assert.equal(takesRow(4, { seq: 5 }, via), true, via);
    assert.equal(takesRow(4, { seq: 4 }, via), false, `${via}: the same write by a second road`);
    assert.equal(takesRow(4, { seq: 3 }, via), false, `${via}: an older write arriving late`);
  }
  // The seeded row starts at seq 0, and that value is real.
  assert.equal(takesRow(-1, { seq: 0 }, "push"), true);
});

test("seq guard: a read is taken when not older, never when older", () => {
  assert.equal(takesRow(4, { seq: 5 }, "read"), true);
  assert.equal(takesRow(4, { seq: 4 }, "read"), true, "the same seq repairs a row that arrived incomplete");
  assert.equal(takesRow(4, { seq: 3 }, "read"), false, "a poll that read before the press");
});

test("seq guard: nothing without a seq", () => {
  assert.equal(takesRow(0, null, "read"), false);
  assert.equal(takesRow(0, undefined, "push"), false);
  assert.equal(takesRow(0, {}, "read"), false);
  assert.equal(takesRow(0, { seq: null }, "answer"), false);
});

test("seq guard: a press answered, then its echo, then a poll that read before it — the press stays", () => {
  // What the host's copy shows as the three roads land in the order the audit saw.
  let lastSeq = 7;
  let shown = "before";
  const land = (row: { seq: number; v: string }, via: "answer" | "push" | "read") => {
    if (!takesRow(lastSeq, row, via)) return;
    lastSeq = row.seq;
    shown = row.v;
  };
  land({ seq: 8, v: "after" }, "answer"); // the POST's answer: shown at once
  land({ seq: 8, v: "after" }, "push"); // its echo: the same write, nothing moves
  land({ seq: 7, v: "before" }, "read"); // the poll that read before the press: ignored
  assert.equal(shown, "after");
  assert.equal(lastSeq, 8);
});

type Row = { id: string; name: string };
const day: Row[] = [
  { id: "a", name: "Welcome" },
  { id: "b", name: "Poll" },
  { id: "c", name: "Close" },
];

test("stages: an UPDATE replaces its row where it stands", () => {
  const next = patchStages(day, { type: "UPDATE", row: { id: "b", name: "Room pulse" } });
  assert.deepEqual(
    next.map((s) => s.name),
    ["Welcome", "Room pulse", "Close"],
  );
  assert.notEqual(next, day, "a new array, so the page re-renders");
  assert.equal(day[1].name, "Poll", "the old array is untouched");
});

test("a pushed row without the large value it left unchanged keeps the one the page has", () => {
  // A room move: realtime's row has no `settings` (unchanged and stored out of line).
  const before = { seq: 4, stage_index: 2, settings: { agenda: [{ time: "09:30" }] } };
  const pushed = { seq: 5, stage_index: 3 } as typeof before;
  assert.deepEqual(wholeRow(before, pushed), { seq: 5, stage_index: 3, settings: { agenda: [{ time: "09:30" }] } });
  // A settings write carries it: the new one wins, and so does a value set to null.
  assert.deepEqual(wholeRow(before, { seq: 6, stage_index: 3, settings: { agenda: [] } }).settings, { agenda: [] });
  assert.equal(wholeRow(before, { ...pushed, settings: null } as unknown as typeof before).settings, null);
  // Nothing to keep yet: the row as it came.
  assert.equal(wholeRow(null, pushed), pushed);
});

test("stages: an UPDATE without the big config it left unchanged keeps the row's own", () => {
  type Big = { id: string; name: string; config?: { head: string } };
  const rows: Big[] = [{ id: "a", name: "Welcome", config: { head: "Hello" } }];
  const next = patchStages(rows, { type: "UPDATE", row: { id: "a", name: "Welcome back" } });
  assert.deepEqual(next[0], { id: "a", name: "Welcome back", config: { head: "Hello" } });
});

test("stages: a DELETE drops its row and keeps the order", () => {
  const next = patchStages(day, { type: "DELETE", id: "b" });
  assert.deepEqual(
    next.map((s) => s.id),
    ["a", "c"],
  );
});

test("stages: a row the list does not hold changes nothing", () => {
  assert.equal(patchStages(day, { type: "UPDATE", row: { id: "x", name: "Other event" } }), day);
  assert.equal(patchStages(day, { type: "DELETE", id: "x" }), day);
  assert.equal(patchStages(day, { type: "DELETE", id: undefined }), day);
});

const tick = () => new Promise<void>((r) => setTimeout(r, 1));

test("the line: each press starts only when the one before it has settled", async () => {
  const turn = oneAtATime();
  const log: string[] = [];
  const press = (name: string, wait: number) =>
    turn(async () => {
      log.push(`${name} starts`);
      await new Promise((r) => setTimeout(r, wait));
      log.push(`${name} ends`);
      return name;
    });
  const answers = await Promise.all([press("one", 15), press("two", 1), press("three", 5)]);
  assert.deepEqual(answers, ["one", "two", "three"]);
  assert.deepEqual(log, ["one starts", "one ends", "two starts", "two ends", "three starts", "three ends"]);
});

test("the line: a press that fails never holds up the next", async () => {
  const turn = oneAtATime();
  const failed = turn(async () => {
    throw new Error("no connection");
  });
  const next = turn(async () => "sent");
  await assert.rejects(failed, /no connection/);
  assert.equal(await next, "sent");
});

test("the line: two quick presses built from the newest row both land", async () => {
  // A stand-in for the route: it stores the whole value it is sent and answers with the new row.
  let server = { seq: 1, names: {} as Record<string, string> };
  let newest = server; // what the page's copy shows (useAdminEventState `latest`)
  const route = async (names: Record<string, string>) => {
    await tick();
    server = { seq: server.seq + 1, names };
    return server;
  };
  const turn = oneAtATime();
  // Built when its turn comes, from the newest row, and the answer taken before the next press is built.
  const rename = (round: string, name: string) =>
    turn(async () => {
      newest = await route({ ...newest.names, [round]: name });
    });
  await Promise.all([rename("1", "Morning"), rename("2", "Afternoon")]);
  assert.deepEqual(server.names, { "1": "Morning", "2": "Afternoon" });

  // Built at press time from the same render instead, the second press drops the first.
  server = { seq: 1, names: {} };
  const shown = server;
  const stale = (round: string, name: string) => {
    const value = { ...shown.names, [round]: name };
    return turn(async () => {
      await route(value);
    });
  };
  await Promise.all([stale("1", "Morning"), stale("2", "Afternoon")]);
  assert.deepEqual(server.names, { "2": "Afternoon" });
});
