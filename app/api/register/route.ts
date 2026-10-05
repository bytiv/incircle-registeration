import { after, NextResponse } from "next/server";

import { bumpRosterSeq, nextBubbleSlots, slugify, uniqueSlug, verifyCode } from "@/lib/admin/roster";
import { emailReady, sendEmail } from "@/lib/email";
import { publicSiteUrl } from "@/lib/env";
import { resolvePublicEvent } from "@/lib/queries/eventRef";
import { findOrCreatePerson } from "@/lib/queries/people";
import { renderRegEmail } from "@/lib/regEmail";
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

  const base = slugify(name);
  const [slot] = await nextBubbleSlots(supabase, event.id, 1);
  const row = {
    event_id: event.id,
    full_name: name,
    slug: await uniqueSlug(supabase, event.id, base),
    title: title || null,
    role: "member" as const,
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
    ...slot,
  };

  /*
   * THE SIGN-UP ITSELF, FIRST. Its slug is unique per event and is also its photo's file name, so
   * the seat claims it before anything else is written. Two people with the same name pressing
   * Register in the same second used to lose one of them here (one retry, then "already
   * registered"), and could end up sharing one photo file: a clash is now tried again with a
   * fresh slug, then with a random tail, and nobody is turned away for having a common name. From
   * here on the registration is kept, whatever happens to the photo or the directory below.
   */
  let seat: { id: string } | null = null;
  let error: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < 6 && !seat; attempt += 1) {
    const res = await supabase.from("attendees").insert(row).select("id").single();
    if (!res.error) {
      seat = res.data;
      break;
    }
    error = res.error;
    if (res.error.code !== "23505" || !/slug/i.test(res.error.message)) break;
    row.slug = attempt < 2 ? await uniqueSlug(supabase, event.id, base) : `${base}_${Math.random().toString(36).slice(2, 7)}`;
  }
  if (!seat) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "This address is already registered." }, { status: 409 });
    }
    if (error && (error.code === "42703" || /reg_status|registered_at|profile/.test(error.message))) {
      console.error("[incircle] /api/register: run supabase/01_schema.sql —", error.message);
      return NextResponse.json({ error: "Registration is not set up yet." }, { status: 503 });
    }
    return NextResponse.json({ error: error?.message ?? "That did not go through." }, { status: 500 });
  }

  /* The photo, under the slug the seat now owns — never over somebody else's file. */
  let photoPath: string | null = null;
  if (hasPhoto && body.photo) {
    // A photo that will not save is not a reason to lose the registration.
    const saved = await saveFacePhoto(supabase, { eventId: event.id, slug: row.slug, dataUrl: body.photo });
    photoPath = saved.ok ? saved.path : null;
  }

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
  if (photoPath || personId) {
    const { error: linkError } = await supabase
      .from("attendees")
      .update({ ...(photoPath ? { photo_path: photoPath } : {}), ...(personId ? { person_id: personId } : {}) })
      .eq("id", seat.id);
    // The sign-up is saved; only its photo or directory link is missing. Logged, not refused.
    if (linkError) console.error("[incircle] /api/register: the photo / directory link did not save —", linkError.message);
  }
  await bumpRosterSeq(supabase, event.id);

  /*
   * THE WELCOME EMAIL (Settings → WELCOME EMAIL, lib/regEmail.ts), sent after the answer has
   * gone: the visitor never waits on Resend, and an email that fails is logged, never a lost
   * sign-up. The seat's id is the idempotency key, so one sign-up is one email.
   */
  const welcome = getSetting(state, "reg_email");
  if (welcome.on && emailReady()) {
    const seatId = seat.id;
    const site = publicSiteUrl();
    const logo = site.startsWith("https://") ? `${site}/brand/typeface.png` : undefined;
    const message = renderRegEmail(welcome, { name, event: event.name }, { logo });
    after(async () => {
      const sent = await sendEmail({ to: email, ...message, key: `welcome-${seatId}` });
      if (!sent.ok) console.error("[incircle] /api/register: the welcome email did not go —", sent.error);
    });
  }
  return NextResponse.json({ ok: true, waitlist: full, approve });
}
