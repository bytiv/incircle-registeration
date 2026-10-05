import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_REG_EMAIL, fillRegEmail, normalizeRegEmail, renderRegEmail } from "./regEmail";
import { reduceFlow } from "@/lib/admin/flow";
import { getSetting } from "@/lib/settings";
import type { EventStateRow } from "@/lib/supabase/types";

/** THE WELCOME EMAIL (lib/regEmail.ts) — its setting, its fill-ins, its HTML. Run with `npm test`. */

const row = (settings: Record<string, unknown> = {}) => ({ event_id: "e1", seq: 3, settings }) as unknown as EventStateRow;

test("the setting starts as the default, and is cleaned on the way in", () => {
  assert.deepEqual(getSetting(row(), "reg_email"), DEFAULT_REG_EMAIL);
  const state = row();
  const next = { ...state, ...reduceFlow(state, { type: "setting", key: "reg_email", value: { on: false, subject: "  Hi\n there ", body: "A\r\n\r\n\r\n\r\nB  " } }) } as EventStateRow;
  assert.deepEqual(getSetting(next, "reg_email"), { on: false, subject: "Hi there", body: "A\n\nB" });
  assert.deepEqual(reduceFlow(state, { type: "setting", key: "reg_email", value: "hello" }), {});
  // A part left out keeps the default.
  assert.deepEqual(normalizeRegEmail({ on: false }), { ...DEFAULT_REG_EMAIL, on: false });
});

test("the fill-ins are each person's own", () => {
  const who = { name: "Sara  Adel", event: "InCircle" };
  assert.equal(fillRegEmail("Hi {first_name} ({name}), see you at {event}. {other}", who), "Hi Sara (Sara  Adel), see you at InCircle. {other}");
});

test("the HTML carries the words and nothing a name could inject", () => {
  const email = { on: true, subject: "Welcome to {event}", body: "Hi {first_name},\n\nDetails: https://incircle.community/?a=1&b=2.\nBye" };
  const out = renderRegEmail(email, { name: "<b>Sara</b> Adel", event: "InCircle" }, { logo: "https://incircle.community/brand/typeface.png" });
  assert.equal(out.subject, "Welcome to InCircle");
  assert.equal(out.text, "Hi <b>Sara</b>,\n\nDetails: https://incircle.community/?a=1&b=2.\nBye");
  assert.ok(out.html.includes("Hi &lt;b&gt;Sara&lt;/b&gt;,</p>"));
  assert.ok(!out.html.includes("<b>Sara"));
  assert.ok(out.html.includes('<a href="https://incircle.community/?a=1&amp;b=2" '));
  assert.ok(out.html.includes("2</a>.<br>Bye</p>"));
  assert.ok(out.html.includes('src="https://incircle.community/brand/typeface.png"'));
  assert.ok(!renderRegEmail(email, { name: "Sara", event: "X" }).html.includes("<img"));
});

test("an empty subject or message falls back to the default words", () => {
  const out = renderRegEmail({ on: true, subject: "", body: "" }, { name: "Sara", event: "InCircle" });
  assert.equal(out.subject, "Welcome to InCircle, Sara");
  assert.ok(out.text.startsWith("Hi Sara,\n\nThis is Marina"));
});
