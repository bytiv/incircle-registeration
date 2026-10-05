import { NextResponse } from "next/server";

import { isUnlocked } from "@/lib/admin/auth";
import { reduceFlow, type FlowAction } from "@/lib/admin/flow";
import { resolveEvent } from "@/lib/queries/eventRef";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The only writer of `event_state` — here, of its `settings`: the Registration
 * page's lines, fields, approval rule and seats.
 *
 * CIB's route of the same name, cut to the one action registration sends
 * (`{type:"setting", key, value}`), with the same contract:
 *   - the client sends an INTENT, not a row. The row is re-read here and the
 *     pure reduction (lib/admin/flow.ts) runs against it;
 *   - the write is CONDITIONAL on the `seq` it reduced against, so an edit from
 *     another tab in between is never overwritten — the action is reduced again
 *     against the new row (CIB's lib/admin/commitFlow.ts);
 *   - `seq` and `changed_at` are never written here: a trigger owns them;
 *   - the answer carries the row, so the control moves the moment it lands.
 *
 * GET answers the row as it stands: the control room's slow poll, which keeps a
 * second open tab in step (CIB used realtime for this; registration has one
 * host and no phones, so a poll is enough).
 */
export const dynamic = "force-dynamic";

async function readState(supabase: ReturnType<typeof createAdminClient>, eventId: string) {
  const { data, error } = await supabase.from("event_state").select("*").eq("event_id", eventId).maybeSingle();
  if (error) throw new Error(`event_state: ${error.message}`);
  if (!data) throw new Error("This event has no event_state row.");
  return data;
}

export async function GET() {
  if (!(await isUnlocked())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const event = await resolveEvent({ fresh: true });
  if (!event) return NextResponse.json({ error: "No event is marked as active." }, { status: 404 });
  try {
    const state = await readState(createAdminClient(), event.id);
    return NextResponse.json({ state }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "That did not load." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "Locked." }, { status: 401 });

  let action: FlowAction;
  try {
    action = (await request.json()) as FlowAction;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (action?.type !== "setting") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const event = await resolveEvent({ fresh: true });
  if (!event) return NextResponse.json({ error: "No event is marked as active." }, { status: 404 });
  const supabase = createAdminClient();

  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const state = await readState(supabase, event.id);
      const patch = reduceFlow(state, action);
      const changed = (Object.keys(patch) as (keyof typeof patch)[]).some(
        (k) => JSON.stringify(patch[k]) !== JSON.stringify(state[k]),
      );
      if (!changed) return NextResponse.json({ state, changed: false });

      const { data: updated, error } = await supabase
        .from("event_state")
        .update(patch)
        .eq("event_id", event.id)
        .eq("seq", state.seq)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(`event_state: ${error.message}`);
      if (updated) return NextResponse.json({ state: updated, changed: true });
      // Somebody wrote the row between the read and the write: reduce again.
    }
    return NextResponse.json({ error: "The settings kept changing under this edit. Try again." }, { status: 409 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "That did not save." }, { status: 500 });
  }
}
