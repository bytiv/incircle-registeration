import { SETTING_RULES, type EventSettings } from "@/lib/settings";
import type { EventStateRow } from "@/lib/supabase/types";

/**
 * THE ONE WRITE THE CONTROL ROOM MAKES TO `event_state`: a setting.
 *
 * CIB's lib/admin/flow.ts reduces every press of the room (move, hold, restart,
 * the moments …); registration only ever sends `{type:"setting"}`, so this is
 * that branch of CIB's reducer, unchanged, under the same names. The client
 * sends an INTENT, not a row: /api/admin/state re-reads the row and runs this
 * against it, so two edits in flight cannot overwrite each other with a stale
 * copy of the settings.
 */
export type FlowAction = { type: "setting"; key: keyof EventSettings; value: unknown };

/** The columns a reduction may change. */
export type StatePatch = Partial<Pick<EventStateRow, "settings">>;

/**
 * Event-level knobs, validated HERE rather than in whichever control sent
 * them — the value that lands is the clamped one no matter what a client
 * posted, and an unknown key or unusable value is a no-op (the route then
 * reports changed:false instead of bumping seq).
 */
export function reduceFlow(state: EventStateRow, action: FlowAction): StatePatch {
  if (action.type !== "setting") return {};
  const rule = SETTING_RULES[action.key];
  if (!rule) return {};
  const value = rule(action.value);
  if (value === undefined) return {};
  return {
    settings: { ...(state.settings ?? {}), [action.key]: value } as EventSettings,
  };
}
