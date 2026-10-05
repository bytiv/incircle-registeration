import assert from "node:assert/strict";
import { test } from "node:test";

import { registrationFields } from "./registration";
import { getSetting, SETTINGS_DEFAULTS } from "./settings";

/**
 * The registration form's order is the host's: they drag the fields into it on the
 * Registration page, and `reg_fields` keeps exactly that order (lib/settings.ts). Run with
 * `npm test`.
 */

const withFields = (reg_fields: unknown) => ({ settings: { reg_fields } as never });

test("reg_fields keeps the order it is given", () => {
  const order = ["photo", "company", "name", "email", "phone"];
  assert.deepEqual(getSetting(withFields(order), "reg_fields"), order);
});

test("reg_fields drops unknown keys and repeats, and keeps the first place of a repeat", () => {
  assert.deepEqual(getSetting(withFields(["title", "bogus", "name", "title", 7, "email", "name"]), "reg_fields"), ["title", "name", "email"]);
});

test("reg_fields always carries name and email, first when a client dropped them", () => {
  assert.deepEqual(getSetting(withFields(["linkedin", "company"]), "reg_fields"), ["name", "email", "linkedin", "company"]);
  assert.deepEqual(getSetting(withFields(["company", "email"]), "reg_fields"), ["name", "company", "email"]);
  assert.deepEqual(getSetting(withFields([]), "reg_fields"), ["name", "email"]);
});

test("a reg_fields that is not a list falls back to the default form", () => {
  assert.deepEqual(getSetting(withFields("name,email"), "reg_fields"), SETTINGS_DEFAULTS.reg_fields);
  assert.deepEqual(getSetting({ settings: {} }, "reg_fields"), SETTINGS_DEFAULTS.reg_fields);
});

test("registrationFields iterates in the saved order, photo where it was put", () => {
  assert.deepEqual([...registrationFields(withFields(["email", "photo", "name", "title"]))], ["email", "photo", "name", "title"]);
});

test("registrationFields puts name and email back even from a hand-edited list", () => {
  assert.deepEqual([...registrationFields(withFields(["phone"]))], ["name", "email", "phone"]);
});
