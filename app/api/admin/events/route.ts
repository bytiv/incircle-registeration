import { NextResponse } from "next/server";

import { isUnlocked } from "@/lib/admin/auth";
import { forgetEvent } from "@/lib/queries/eventRef";
import { createAdminClient } from "@/lib/supabase/admin";
import type { EventRow } from "@/lib/supabase/types";

/**
 * The event itself, behind the passcode — CIB's /api/admin/events cut to what
 * the registration app does with its one event:
 *
 *   POST { action: "publish", id }                    put it on the public page (takes any other down)
 *   POST { action: "unpublish" }                      nothing on the public page
 *   POST { action: "update", id, name, startsAt, venue }  its name, date and location
 *
 * The bodies of these three are CIB's lib/queries/events.ts setPublicEvent and
 * updateEvent, unchanged.
 */
export const dynamic = "force-dynamic";

type Body = {
  action?: string;
  id?: string;
  name?: string;
  startsAt?: string | null;
  venue?: string | null;
};

/** ON THE PUBLIC PAGE — one event, or none (the partial unique index allows one at a time). */
async function setPublicEvent(id: string | null): Promise<void> {
  const supabase = createAdminClient();
  const off = await supabase.from("events").update({ is_public: false }).eq("is_public", true);
  if (off.error) throw new Error(off.error.message);
  if (id) {
    const on = await supabase.from("events").update({ is_public: true }).eq("id", id).select("id");
    if (on.error) throw new Error(on.error.message);
    if (!on.data?.length) throw new Error("There is no such event.");
  }
  forgetEvent();
}

async function updateEvent(
  id: string,
  patch: { name?: string; startsAt?: string | null; venue?: string | null },
): Promise<void> {
  const supabase = createAdminClient();
  const row: Partial<EventRow> = {};
  if (patch.name !== undefined) {
    const name = patch.name.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) throw new Error("An event needs a name.");
    row.name = name;
  }
  if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
  if (patch.venue !== undefined) row.venue = patch.venue ? patch.venue.trim().slice(0, 80) : null;
  if (!Object.keys(row).length) return;
  const { error } = await supabase.from("events").update(row).eq("id", id);
  if (error) throw new Error(error.message);
  forgetEvent();
}

export async function POST(request: Request) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  try {
    switch (body.action) {
      case "publish":
        if (!body.id) return NextResponse.json({ error: "An id is required." }, { status: 400 });
        await setPublicEvent(body.id);
        return NextResponse.json({ ok: true });
      case "unpublish":
        await setPublicEvent(null);
        return NextResponse.json({ ok: true });
      case "update":
        if (!body.id) return NextResponse.json({ error: "An id is required." }, { status: 400 });
        await updateEvent(body.id, { name: body.name, startsAt: body.startsAt, venue: body.venue });
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: `Unknown action "${body.action}".` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "That did not save." }, { status: 500 });
  }
}
