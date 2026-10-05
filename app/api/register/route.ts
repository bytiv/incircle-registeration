import { NextResponse } from "next/server";

import { bumpRosterSeq, nextBubbleSlots, slugify, uniqueSlug, verifyCode } from "@/lib/admin/roster";
import { resolvePublicEvent } from "@/lib/queries/eventRef";
import { findOrCreatePerson } from "@/lib/queries/people";
import { EMAIL_SHAPE, isAttendeeKind, registrationCapacity, registrationFields, registrationFull } from "@/lib/registration";
import { getSetting } from "@/lib/settings";
import { saveFacePhoto } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * THE PUBLIC SIGN-UP — the one route on this app a stranger can write through.
 *
 * It creates an attendee the way the host's ADD does (lib/admin/roster.ts: a
 * unique slug, a real 4-digit code, a bubble slot — CIB's event app uses the
 * last two on the day; lib/storage keeps the photo), with the registration
 * columns, and it refuses in every case where writing would be wrong:
 *
 *   - no event is on the public page (`events.is_public`)        → 403
 *   - name or email missing, or the address is not one           → 400
 *   - a field the host marked required left empty                → 400
 *   - that address is already on the list                        → 409
 *   - the schema has not been run                                → 503
 *
 * What is required is the page's own say (`reg_page.fields[…].required`, set on the page
 * itself); name and email always are. Fields the host switched off are ignored even if sent. A full room still
 * registers — as "New", first in line — because the mockup's full-room copy
 * promises exactly that ("leave your details and you are first in line").
 *
 * No session and no cookie: the service role does the write, the body is
 * capped, a honeypot field swallows the dumbest bots, and the uniqueness index
 * on the address is the wall a repeated submit hits.
 */
export const dynamic = "force-dynamic";

type Body = {
  name?: string;
  email?: string;
  company?: string;
  title?: string;
  linkedin?: string;
  phone?: string;
  /** A data URL from the form's picker, already downscaled in the browser. */
  photo?: string;
  /** The form's one choice: "first" (first time) or "returning" (been before). */
  attendee?: string;
  /** The honeypot. A human never sees it; a bot fills it. */
  website?: string;
};

const clip = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

export async function POST(request: Request) {
  const raw = await request.text().catch(() => "");
  if (raw.length > 2_500_000) {
    return NextResponse.json({ error: "That photo is too large." }, { status: 413 });
  }
  let body: Body;
  try {
    body = JSON.parse(raw) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (body.website) return NextResponse.json({ ok: true });

  // The event ON THE PUBLIC PAGE (`events.is_public`), or nothing to register for.
  const event = await resolvePublicEvent();
  if (!event) return NextResponse.json({ error: "Registration is closed." }, { status: 403 });
  const supabase = createAdminClient();
  const { data: state } = await supabase
    .from("event_state")
    .select("*")
    .eq("event_id", event.id)
    .maybeSingle();
  if (!state) return NextResponse.json({ error: "Registration is closed." }, { status: 403 });

  const fields = new Set(registrationFields(state));
  const page = getSetting(state, "reg_page");
  const name = clip(body.name, 80);
  const email = clip(body.email, 120).toLowerCase();
  if (!name || !email) {
    return NextResponse.json({ error: "Your name and email are the minimum." }, { status: 400 });
  }
  if (!EMAIL_SHAPE.test(email)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }
  const company = fields.has("company") ? clip(body.company, 80) : "";
  const title = fields.has("title") ? clip(body.title, 80) : "";
  const linkedin = fields.has("linkedin") ? clip(body.linkedin, 200) : "";
  const phone = fields.has("phone") ? clip(body.phone, 40) : "";
  const attendee = fields.has("attendee") && isAttendeeKind(body.attendee) ? body.attendee : null;
  const hasPhoto = fields.has("photo") && typeof body.photo === "string" && body.photo.startsWith("data:");

  // What the host marked required on the page, in the page's own words.
  const given: Record<string, boolean> = { title: !!title, phone: !!phone, linkedin: !!linkedin, company: !!company, photo: hasPhoto, attendee: !!attendee };
  for (const key of ["title", "phone", "linkedin", "company", "photo", "attendee"] as const) {
    if (!fields.has(key) || !page.fields[key].required || given[key]) continue;
    const label = page.fields[key].label || (key === "attendee" ? "This choice" : "This field");
    return NextResponse.json({ error: key === "attendee" ? "Please choose one of the two options." : `${label} is required.` }, { status: 400 });
  }

  const { data: dup } = await supabase
    .from("attendees")
    .select("id")
    .eq("event_id", event.id)
    .eq("email", email)
    .limit(1);
  if (dup?.length) {
    return NextResponse.json({ error: "This address is already registered." }, { status: 409 });
  }

  // reg_capacity is the cap (0 = no limit); the invited roster and the confirmed both hold seats.
  const capacity = registrationCapacity(state);
  const { count: seated } = await supabase
    .from("attendees")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id)
    .is("removed_at", null)
    .or("reg_status.is.null,reg_status.eq.confirmed");
  const full = registrationFull(capacity, seated ?? 0);
  const approve = getSetting(state, "reg_approve");

  const slug = await uniqueSlug(supabase, event.id, slugify(name));
  let photoPath: string | null = null;
  if (hasPhoto && body.photo) {
    // A photo that will not save is not a reason to lose the registration.
    const saved = await saveFacePhoto(supabase, { eventId: event.id, slug, dataUrl: body.photo });
    photoPath = saved.ok ? saved.path : null;
  }
  const [slot] = await nextBubbleSlots(supabase, event.id, 1);

  /*
   * The DIRECTORY (`people`): the address is the key across events, so
   * somebody who came last time is the same person this time, with their
   * newest details. Null on a database without the table, and the seat is
   * simply unlinked.
   */
  const personId = await findOrCreatePerson(supabase, {
    name,
    email,
    title,
    company,
    linkedin,
    photoPath,
    phone,
  });

  const row = {
    event_id: event.id,
    full_name: name,
    slug,
    title: title || null,
    role: "member" as const,
    photo_path: photoPath,
    linkedin_url: linkedin || null,
    verify_code: verifyCode(),
    added_by_host: false,
    // A full room queues everyone as New whatever the approval rule says.
    reg_status: (full || approve ? "new" : "approved") as "new" | "approved",
    company: company || null,
    email,
    phone: phone || null,
    registered_at: new Date().toISOString(),
    ...(attendee ? { profile: { attendee } } : {}),
    ...(personId ? { person_id: personId } : {}),
    ...slot,
  };
  let { error } = await supabase.from("attendees").insert(row);
  if (error?.code === "23505" && /slug/i.test(error.message)) {
    row.slug = await uniqueSlug(supabase, event.id, slugify(name));
    ({ error } = await supabase.from("attendees").insert(row));
  }
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This address is already registered." }, { status: 409 });
    }
    if (error.code === "42703" || /reg_status|registered_at|profile/.test(error.message)) {
      console.error("[incircle] /api/register: run supabase/01_schema.sql —", error.message);
      return NextResponse.json({ error: "Registration is not set up yet." }, { status: 503 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await bumpRosterSeq(supabase, event.id);
  return NextResponse.json({ ok: true, waitlist: full, approve });
}
