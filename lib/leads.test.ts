import assert from "node:assert/strict";
import { test } from "node:test";

import { applyLead, cleanLeadPatch, cleanOwners, leadOf, NEXT_MAX, OWNERS_MAX, profileFilter, sameLead, withLead } from "./leads";

/**
 * LEAD MANAGEMENT'S RECORD (lib/leads.ts) — what Registrations' steps and Lead management's
 * categories, owner and next action save into `attendees.profile`. Run with `npm test`.
 */

const EMPTY = { steps: { message: false, call: false, calendar: false }, cats: [], owner: null, next: "" };

test("a person with nothing recorded reads as nothing done, no category, unassigned", () => {
  assert.deepEqual(leadOf({}), EMPTY);
  assert.deepEqual(leadOf(null), EMPTY);
  assert.deepEqual(leadOf({ attendee: "first" }), EMPTY);
});

test("a hand-mangled record reads safely: unknown categories, non-booleans and junk are dropped", () => {
  const lead = leadOf({
    lead: {
      steps: { message: true, call: "yes", calendar: 1, extra: true },
      cats: ["current_client", "nope", "potential_client", "current_client", 7],
      owner: "   Basma   ",
      next: 42,
    },
  });
  assert.deepEqual(lead.steps, { message: true, call: false, calendar: false });
  // In the categories' own order, each once.
  assert.deepEqual(lead.cats, ["potential_client", "current_client"]);
  assert.equal(lead.owner, "Basma");
  assert.equal(lead.next, "");
});

test("a patch from a request is checked: wrong keys and wrong types are refused", () => {
  assert.deepEqual(cleanLeadPatch({ kind: "step", key: "call", on: true }), { kind: "step", key: "call", on: true });
  assert.equal(cleanLeadPatch({ kind: "step", key: "confirmed", on: true }), null);
  assert.equal(cleanLeadPatch({ kind: "step", key: "call", on: "true" }), null);
  assert.deepEqual(cleanLeadPatch({ kind: "cat", key: "potential_speaker", on: false }), { kind: "cat", key: "potential_speaker", on: false });
  assert.equal(cleanLeadPatch({ kind: "cat", key: "vip", on: true }), null);
  assert.deepEqual(cleanLeadPatch({ kind: "owner", value: "  Kholi " }), { kind: "owner", value: "Kholi" });
  assert.deepEqual(cleanLeadPatch({ kind: "owner", value: "   " }), { kind: "owner", value: null });
  assert.deepEqual(cleanLeadPatch({ kind: "owner", value: null }), { kind: "owner", value: null });
  assert.equal(cleanLeadPatch({ kind: "owner", value: 3 }), null);
  assert.deepEqual(cleanLeadPatch({ kind: "next", value: "Send\n the   proposal " }), { kind: "next", value: "Send the proposal" });
  assert.equal(cleanLeadPatch({ kind: "next", value: "x".repeat(NEXT_MAX + 50) })?.kind, "next");
  assert.equal((cleanLeadPatch({ kind: "next", value: "x".repeat(NEXT_MAX + 50) }) as { value: string }).value.length, NEXT_MAX);
  assert.equal(cleanLeadPatch({ kind: "delete" }), null);
  assert.equal(cleanLeadPatch("step"), null);
});

test("each change sets one thing and leaves the rest", () => {
  let lead = leadOf({});
  lead = applyLead(lead, { kind: "step", key: "message", on: true });
  lead = applyLead(lead, { kind: "cat", key: "potential_speaker", on: true });
  lead = applyLead(lead, { kind: "cat", key: "potential_client", on: true });
  lead = applyLead(lead, { kind: "owner", value: "Marina" });
  lead = applyLead(lead, { kind: "next", value: "Book intro call" });
  assert.deepEqual(lead, {
    steps: { message: true, call: false, calendar: false },
    cats: ["potential_client", "potential_speaker"],
    owner: "Marina",
    next: "Book intro call",
  });
  // A change sent twice lands once: it sets, it never flips.
  const again = applyLead(lead, { kind: "step", key: "message", on: true });
  assert.ok(sameLead(again, lead));
  lead = applyLead(lead, { kind: "cat", key: "potential_client", on: false });
  assert.deepEqual(lead.cats, ["potential_speaker"]);
});

test("writing the lead keeps every other key of the record exactly as it was", () => {
  const profile = { attendee: "returning", lang: "ar", dept: "Risk" };
  const lead = applyLead(leadOf(profile), { kind: "owner", value: "Dalya" });
  const written = withLead(profile, lead);
  assert.equal(written.attendee, "returning");
  assert.equal(written.lang, "ar");
  assert.equal(written.dept, "Risk");
  assert.deepEqual(leadOf(written), lead);
  // The record it was given is not changed in place.
  assert.equal("lead" in profile, false);
});

test("a record as a filter: no space or plus left in it, and the same value when read back", () => {
  const profile = { attendee: "first", lead: { owner: "Basma (Cairo) + co", next: 'Send the "proposal" \\ now — #2 & 50%', cats: [], steps: {} } };
  const text = profileFilter(profile);
  assert.equal(/[ +]/.test(text), false);
  assert.deepEqual(JSON.parse(text), profile);
  assert.equal(profileFilter({}), "{}");
});

test("the owners list: names cleaned, empty and repeated ones (any case) dropped, order kept", () => {
  assert.deepEqual(cleanOwners([" Kholi ", "Basma", "", "kholi", "  ", "Marina", 7, null]), ["Kholi", "Basma", "Marina"]);
  assert.equal(cleanOwners("Kholi"), undefined);
  assert.deepEqual(cleanOwners([]), []);
  assert.equal(cleanOwners(Array.from({ length: OWNERS_MAX + 10 }, (_, i) => `Name ${i}`))?.length, OWNERS_MAX);
});
