import assert from "node:assert/strict";
import { test } from "node:test";

import { COLUMNS, exportCsv } from "./exportCsv";
import type { AdminPerson, AdminSnapshot } from "./model";

/**
 * THE ONE FILE THE HOST KEEPS — People's EXPORT. Run with `npm test`.
 */

/** A row with nothing in it — every optional fact absent. */
function person(over: Partial<AdminPerson> = {}): AdminPerson {
  return {
    id: "a1",
    slug: "nobody",
    idx: 0,
    isTeam: false,
    added: false,
    role: "member",
    name: "Nobody",
    title: "Community member",
    rawTitle: null,
    photo: null,
    rawPhotoPath: null,
    photoX: null,
    photoY: null,
    photoZoom: null,
    personId: null,
    firstClaimedAt: null,
    history: [],
    regStatus: null,
    company: null,
    regEmail: null,
    attendee: null,
    phone: null,
    registeredAt: null,
    removed: false,
    li: "",
    status: "absent",
    checkIn: null,
    lastSeen: null,
    device: "—",
    code: null,
    stage: "—",
    lastPageId: null,
    isLive: false,
    ...over,
  };
}

const snapshot = (people: AdminPerson[]): AdminSnapshot => ({
  people,
  start: 18 * 60,
  removedCount: 0,
  removedPeople: [],
});

const parse = (csv: string) =>
  csv.split("\n").map((line) => line.slice(1, -1).split('","').map((c) => c.replace(/""/g, '"')));

test("the sheet always has the same columns, in order", () => {
  const [head] = parse(exportCsv(snapshot([])));
  assert.deepEqual(head, COLUMNS.map((c) => c.head));
  assert.deepEqual(head, ["Name", "Title", "Company", "Email", "Phone", "LinkedIn", "Role", "Registration status", "Attendee", "Registered", "Code"]);
});

test("a sign-up's row carries what they registered with; an invited row says who added them", () => {
  const rows = parse(
    exportCsv(
      snapshot([
        person({
          name: "Sara Adel",
          rawTitle: "Designer",
          company: "Dotment",
          regEmail: "sara@example.com",
          phone: "01012345678",
          li: "linkedin.com/in/sara",
          regStatus: "confirmed",
          attendee: "returning",
          registeredAt: "2026-10-05T11:30:00Z",
          code: "4821",
        }),
        person({ id: "a2", name: "Omar", isTeam: true, role: "host" }),
      ]),
    ),
  );
  // 11:30 UTC is 14:30 in Cairo (EEST, UTC+3, on 5 Oct 2026).
  assert.deepEqual(rows[1], ["Sara Adel", "Designer", "Dotment", "sara@example.com", "01012345678", "linkedin.com/in/sara", "Member", "Confirmed", "Attended before", "2026-10-05 14:30", "4821"]);
  assert.deepEqual(rows[2], ["Omar", "", "", "", "", "", "Host team", "Added by host", "", "", ""]);
});

test("quotes are doubled and a would-be formula stays text", () => {
  const csv = exportCsv(snapshot([person({ name: 'The "Boss"', company: "=HYPERLINK(\"x\")", phone: "+20 10 1234 5678" })]));
  const [, row] = parse(csv);
  assert.equal(row[0], 'The "Boss"');
  assert.equal(row[2], "'=HYPERLINK(\"x\")");
  assert.equal(row[4], "'+20 10 1234 5678");
});
