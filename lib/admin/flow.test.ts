import assert from "node:assert/strict";
import { test } from "node:test";

import { reduceFlow } from "./flow";
import { getSetting } from "@/lib/settings";
import type { EventStateRow } from "@/lib/supabase/types";

/**
 * THE CONTROL ROOM'S SETTINGS WRITE (lib/admin/flow.ts) — here, Lead management's owners list.
 * Run with `npm test`.
 */

const row = (settings: Record<string, unknown> = {}) => ({ event_id: "e1", seq: 3, settings }) as unknown as EventStateRow;

test("the owners list is cleaned on the way in, and starts empty", () => {
  const state = row();
  const next = { ...state, ...reduceFlow(state, { type: "setting", key: "lead_owners", value: [" Kholi", "kholi", "", "Basma"] }) } as EventStateRow;
  assert.deepEqual(getSetting(next, "lead_owners"), ["Kholi", "Basma"]);
  assert.deepEqual(getSetting(row(), "lead_owners"), []);
  // Not a list: nothing changes.
  assert.deepEqual(reduceFlow(state, { type: "setting", key: "lead_owners", value: "Kholi" }), {});
});
