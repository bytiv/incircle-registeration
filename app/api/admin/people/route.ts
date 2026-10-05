import { NextResponse } from "next/server";

import { isUnlocked } from "@/lib/admin/auth";
import { bumpRosterSeq, nextBubbleSlots, slugify, uniqueSlug, verifyCode } from "@/lib/admin/roster";
import { ZERO_PERSON_IMPACT } from "@/lib/admin/runs";
import { applyLead, cleanLeadPatch, leadOf, profileFilter, sameLead, withLead } from "@/lib/leads";
import type { RegStatus } from "@/lib/registration";
import { resolveEvent } from "@/lib/queries/eventRef";
import { findOrCreatePerson, syncPerson } from "@/lib/queries/people";
import { deleteFacePhotos, saveFacePhoto } from "@/lib/storage";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AttendeeRow } from "@/lib/supabase/types";

/**
 * Add / bulk-add / edit / remove / restore on `attendees`.
 *
 * Three things the browser cannot be trusted to do, which is why the whole of
 * People goes through here:
 *
 *  1. THE SLUG. `attendees` has `unique (event_id, slug)` and the slug is also
 *     the photo filename. Two walk-ins called "Sara Adel" must not collide, and
 *     the client cannot know what is already taken.
 *  2. THE VERIFY CODE. Without a real 4-digit `verify_code` a walk-in reaches
 *     P2b and can never confirm — they are stuck for the rest of the event.
 *  3. THE PHOTO. It arrives as a data URL, already made small in the browser
 *     (components/admin/people/bits.tsx), and lib/storage keeps it: in Azure
 *     once the storage account is set up (`photo_path` = the file's address),
 *     in Supabase's `faces` bucket until then (`photo_path` = the bare key).
 *     lib/photos.ts reads either.
 *
 * `remove` sets `removed_at`. It must never DELETE: `attendee_faces` filters on
 * that column (supabase/06_admin_people.sql), and the row still owns the
 * person's session.
 *
 * `purgeOne` is the exception, and the only one — a real DELETE, reachable only
 * for somebody already removed, only behind a typed confirmation, and it takes
 * every one of those things with it. See the case itself.
 *
 * ------------------------------------------------------------------------
 * PRESENCE, NOT TRUTHINESS (Belal, 2026-08-21: "there is a lot of fields that
 * we cant edit please allow editing that").
 *
 * `edit` used to read design:429-434 literally — "a blank field leaves the
 * stored value alone" — which meant no field could ever be CLEARED. A wrong
 * LinkedIn URL was permanent; a title typed by mistake was permanent. Worse, it
 * combined with lib/queries/admin.ts inventing a display title for anyone with
 * a null one: the editor pre-filled from the invention and this route wrote it
 * back, so opening EDIT and pressing SAVE stamped the literal string "Community
 * member" into real rows, where the same falsy guard then made it unclearable.
 *
 * So this is a DELIBERATE departure from the design's mechanism, which
 * ADMIN_COPY.md otherwise forbids: a key that is ABSENT from the body means
 * "leave it alone", and a key that is PRESENT is written — including as null.
 * The design's idiom cannot express "clear this" or "set this number to zero",
 * and a host who can align a photo but never recentre it has a worse tool than
 * no tool. The row editor (components/admin/people/RowEditor.tsx) sends dirty
 * keys only, which is the other half of the rule: the two must stay in step or
 * "cannot clear" becomes "clears fields you never touched".
 * ------------------------------------------------------------------------
 */
export const dynamic = "force-dynamic";

/**
 * Every optional field here is three-valued on `edit`: absent = leave alone,
 * null or "" = clear, a value = write it. See the note at the top of the file.
 */
type Body = {
  action?: string;
  id?: string;
  name?: string;
  title?: string | null;
  li?: string | null;
  photo?: string | null;
  /** 'host' | 'member'. The HOST/MEMBER tag, the field order, the photo framing. */
  role?: string;
  /** The four digits P2b compares against. "" clears it. */
  code?: string | null;
  /** supabase/25 — where inside the photo the face is. null recentres. */
  photoX?: number | null;
  photoY?: number | null;
  photoZoom?: number | null;
  text?: string;
  /** `purgeOne` only — the second half of the two-step. See that case. */
  confirm?: boolean;
  /** `regStatus` only — where in the sign-up pipeline this person now is; null = invited. */
  status?: string | null;
  /** `lead` only — the one change to their lead (lib/leads.ts LeadPatch), checked here. */
  patch?: unknown;
};

/** The column CHECK, restated so a bad role is a 400 and not a 500. */
function cleanRole(v: unknown): "host" | "member" | null {
  return v === "host" || v === "member" ? v : null;
}

/**
 * char(4), compared with strict equality by /api/claim. Anything else either
 * violates the type or locks that person out of P2b for the rest of the event,
 * so a bad one is refused rather than coerced.
 */
function cleanCode(v: string): string | null | undefined {
  const t = v.trim();
  if (!t) return null;
  return /^[0-9]{4}$/.test(t) ? t : undefined;
}

/**
 * The framing columns, clamped to what supabase/25's CHECK constraint allows.
 * `null` is a real value here — it is what RECENTRE writes — so this returns
 * `undefined` only for "the host did not send this key".
 */
function clampFrame(v: number | null | undefined, lo: number, hi: number) {
  if (v === undefined) return undefined;
  if (v === null || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
}

export async function POST(request: Request) {
  if (!(await isUnlocked())) {
    return NextResponse.json({ error: "Locked." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const supabase = createAdminClient();
  // The room — lib/queries/eventRef.ts, the one resolver every route shares.
  const event = await resolveEvent({ fresh: true });
  if (!event) {
    return NextResponse.json({ error: "No event is marked as the room." }, { status: 404 });
  }

  switch (body.action) {
    /** design:485-492 */
    case "add": {
      const name = (body.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });

      // Walk-ins were hard-coded to 'member', so a colleague added on the night
      // could never be marked HOST. The form asks now; the default is unchanged.
      const role = body.role === undefined ? "member" : cleanRole(body.role);
      if (!role) {
        return NextResponse.json({ error: "Role must be host or member." }, { status: 400 });
      }
      const code = body.code === undefined || body.code === null ? verifyCode() : cleanCode(body.code);
      if (code === undefined) {
        return NextResponse.json({ error: "The code must be 4 digits." }, { status: 400 });
      }

      const slug = await uniqueSlug(supabase, event.id, slugify(name));
      let photoPath: string | null = null;
      if (body.photo?.startsWith("data:")) {
        const saved = await saveFacePhoto(supabase, { eventId: event.id, slug, dataUrl: body.photo });
        // Silently saving them photo-less is the one outcome that looks like the
        // upload worked. Say so instead — the host still has the file.
        if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
        photoPath = saved.path;
      } else {
        photoPath = (body.photo ?? "").trim() || null;
      }
      const [slot] = await nextBubbleSlots(supabase, event.id, 1);

      // A person in the directory behind the seat (40_). The form carries no
      // address, so this is a new person unless the host later imports them
      // elsewhere; null on a database without the table, and the seat is unlinked.
      const personId = await findOrCreatePerson(supabase, {
        name,
        title: body.title,
        linkedin: body.li,
        photoPath,
        photoX: clampFrame(body.photoX, 0, 100) ?? null,
        photoY: clampFrame(body.photoY, 0, 100) ?? null,
        photoZoom: clampFrame(body.photoZoom, 0.5, 3) ?? null,
      });

      const row = {
        event_id: event.id,
        full_name: name,
        slug,
        title: (body.title ?? "").trim() || null,
        role,
        photo_path: photoPath,
        linkedin_url: (body.li ?? "").trim() || null,
        // A code the host typed, or a real random one. Never a placeholder:
        // P2b compares against it and there is no way past a wrong one.
        verify_code: code ?? verifyCode(),
        added_by_host: true,
        // Aligned in the form before they ever existed as a row.
        photo_x: clampFrame(body.photoX, 0, 100) ?? null,
        photo_y: clampFrame(body.photoY, 0, 100) ?? null,
        photo_zoom: clampFrame(body.photoZoom, 0.5, 3) ?? null,
        ...(personId ? { person_id: personId } : {}),
        ...slot,
      };
      let { error } = await supabase.from("attendees").insert(row);
      /*
       * Part 15 — unique(event_id, slug) can still fire: two adds of the same
       * name in flight both saw the same free slug in uniqueSlug's pre-check.
       * The other row is committed by the time we're told, so ONE re-derive
       * against what is now stored is enough.
       */
      if (error?.code === "23505" && /slug/i.test(error.message)) {
        row.slug = await uniqueSlug(supabase, event.id, slugify(name));
        ({ error } = await supabase.from("attendees").insert(row));
      }
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await bumpRosterSeq(supabase, event.id);
      return NextResponse.json({ ok: true, slug: row.slug });
    }

    /*
     * THE SIGN-UP PIPELINE (2026-09-28, supabase/38_registration.sql). Approve,
     * mark confirmed, unconfirm — People's Registered tab, one column write.
     * Decline is `remove`, so a declined person is in the removed list and can
     * be brought back; nothing about them is deleted.
     */
    case "regStatus": {
      if (!body.id) return NextResponse.json({ error: "An id is required." }, { status: 400 });
      const status: RegStatus | null | undefined =
        body.status === null
          ? null
          : body.status === "new" || body.status === "approved" || body.status === "confirmed"
            ? body.status
            : undefined;
      if (status === undefined) {
        return NextResponse.json(
          { error: "Status must be new, approved or confirmed." },
          { status: 400 },
        );
      }
      const { error } = await supabase
        .from("attendees")
        .update({ reg_status: status })
        .eq("id", body.id)
        .eq("event_id", event.id);
      if (error) {
        const missing = error.code === "42703" || /reg_status/.test(error.message);
        return NextResponse.json(
          {
            error: missing
              ? "Run supabase/38_registration.sql — the sign-up pipeline needs its columns."
              : error.message,
          },
          { status: missing ? 409 : 500 },
        );
      }
      // Seats changed: another open control room re-reads the list.
      await bumpRosterSeq(supabase, event.id);
      return NextResponse.json({ ok: true });
    }

    /*
     * LEAD MANAGEMENT (lib/leads.ts) — one change to what the team records about a person:
     * a contact step, a category, the owner, the next action. Saved inside `attendees.profile`
     * (CIB's own jsonb; no table change), every other key of it kept as it was.
     *
     * THE WRITE IS CONDITIONAL on the record it was read from: the update only lands where
     * `profile` still equals what was read (jsonb equality), so two changes to one person in flight
     * — two ticks pressed together, two teammates on two screens — can never overwrite each
     * other. When the record moved in between, it is read again and the change made again.
     */
    case "lead": {
      if (!body.id) return NextResponse.json({ error: "An id is required." }, { status: 400 });
      const patch = cleanLeadPatch(body.patch);
      if (!patch) return NextResponse.json({ error: "That change is not one this list knows." }, { status: 400 });
      for (let attempt = 0; attempt < 12; attempt += 1) {
        // After a clash, a short random pause, so writers that clashed do not clash again in step.
        if (attempt > 0) await new Promise((r) => setTimeout(r, 15 + Math.random() * 35 * attempt));
        const { data: row, error } = await supabase
          .from("attendees")
          .select("profile")
          .eq("id", body.id)
          .eq("event_id", event.id)
          .maybeSingle();
        if (error) {
          const missing = error.code === "42703" || /profile/.test(error.message);
          return NextResponse.json(
            { error: missing ? "Run supabase/01_schema.sql — the list needs its profile column." : error.message },
            { status: missing ? 409 : 500 },
          );
        }
        if (!row) return NextResponse.json({ error: "That person is not on this event's list." }, { status: 404 });
        const before = (row.profile ?? {}) as Record<string, unknown>;
        const was = leadOf(before);
        const lead = applyLead(was, patch);
        if (sameLead(lead, was)) return NextResponse.json({ ok: true, changed: false });
        const { data: written, error: writeError } = await supabase
          .from("attendees")
          .update({ profile: withLead(before, lead) })
          .eq("id", body.id)
          .eq("event_id", event.id)
          // supabase-js writes a filter's value into the URL as text (`eq.${value}`), so the JSON
          // text is what goes (lib/leads.ts profileFilter); PostgREST compares it as jsonb, where
          // key order does not matter.
          .eq("profile", profileFilter(before) as unknown as Record<string, unknown>)
          .select("id");
        if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 });
        if (written?.length) {
          await bumpRosterSeq(supabase, event.id);
          return NextResponse.json({ ok: true, changed: true });
        }
        // Their record changed between the read and the write: read it again.
      }
      return NextResponse.json({ error: "Their record kept changing under this edit. Try again." }, { status: 409 });
    }

    /** design:494-503 — "Name, Role" per line. */
    case "bulk": {
      const lines = (body.text ?? "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (!lines.length) return NextResponse.json({ ok: true, added: 0 });

      const rows: {
        event_id: string;
        full_name: string;
        slug: string;
        title: string | null;
        role: "member";
        photo_path: null;
        linkedin_url: string | null;
        verify_code: string;
        added_by_host: boolean;
      }[] = [];
      // Part 15 — what THIS batch has claimed. uniqueSlug's query only sees
      // stored rows, so without it two identical names in one paste would both
      // get the same slug and 23505 the whole insert, retry included.
      const batchSlugs = new Set<string>();
      for (const line of lines) {
        const parts = line.split(",");
        const name = parts[0].trim();
        if (!name) continue;
        // Sequential, not parallel: each slug has to see the ones before it.
        const slug = await uniqueSlug(supabase, event.id, slugify(name), batchSlugs);
        batchSlugs.add(slug);
        rows.push({
          event_id: event.id,
          full_name: name,
          slug,
          title: (parts[1] ?? "").trim() || null,
          role: "member" as const,
          photo_path: null,
          linkedin_url: (parts[2] ?? "").trim() || null,
          verify_code: verifyCode(),
          added_by_host: true,
        });
      }
      if (!rows.length) return NextResponse.json({ ok: true, added: 0 });
      const slots = await nextBubbleSlots(supabase, event.id, rows.length);
      /*
       * One directory person per pasted line (40_), made in a single insert
       * and zipped back by position — PostgREST returns inserted rows in the
       * order they were sent. A database without the table links nobody.
       */
      const made = await supabase
        .from("people")
        .insert(rows.map((r) => ({ full_name: r.full_name, title: r.title, linkedin_url: r.linkedin_url })))
        .select("id");
      const personIds = !made.error && made.data?.length === rows.length ? made.data.map((p) => p.id) : null;
      const seat = (row: (typeof rows)[number], i: number) => ({
        ...row,
        ...slots[i],
        ...(personIds ? { person_id: personIds[i] } : {}),
      });
      let { error } = await supabase.from("attendees").insert(rows.map(seat));
      // Part 15 — same slug race as `add`, batch flavour: the whole insert is
      // rolled back on one collision, so re-derive every slug once and retry.
      if (error?.code === "23505" && /slug/i.test(error.message)) {
        batchSlugs.clear();
        for (const row of rows) {
          // Sequential again, so each retry slug sees the ones re-derived before it.
          row.slug = await uniqueSlug(supabase, event.id, slugify(row.full_name), batchSlugs);
          batchSlugs.add(row.slug);
        }
        ({ error } = await supabase.from("attendees").insert(rows.map(seat)));
      }
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await bumpRosterSeq(supabase, event.id);
      return NextResponse.json({ ok: true, added: rows.length });
    }

    /** design:425-437 */
    case "edit": {
      if (!body.id) return NextResponse.json({ error: "An id is required." }, { status: 400 });
      const { data: existing } = await supabase
        .from("attendees")
        .select("slug")
        .eq("id", body.id)
        .eq("event_id", event.id)
        .maybeSingle();
      if (!existing) return NextResponse.json({ error: "No such person." }, { status: 404 });

      const patch: Partial<AttendeeRow> = {};

      /*
       * Presence, not truthiness — see the note at the top of this file. Every
       * branch below asks "did the host send this key", never "is the value
       * non-empty", which is what makes clearing possible at all.
       */
      if (body.name !== undefined) {
        const name = (body.name ?? "").trim();
        // The one field where blank stays an error: the column is NOT NULL, and
        // a nameless person cannot be found on P2.
        if (!name) return NextResponse.json({ error: "A name is required." }, { status: 400 });
        patch.full_name = name;
        /*
         * The slug deliberately does NOT follow a rename. It is the photo
         * filename in the `faces` bucket and the key the roster CSV joins on;
         * re-slugging here would orphan the file and break the legacy fallback,
         * silently, on someone whose name the host only meant to spell right.
         */
      }
      if (body.title !== undefined) patch.title = (body.title ?? "").trim() || null;
      if (body.li !== undefined) patch.linkedin_url = (body.li ?? "").trim() || null;

      if (body.role !== undefined) {
        const role = cleanRole(body.role);
        if (!role) {
          return NextResponse.json({ error: "Role must be host or member." }, { status: 400 });
        }
        patch.role = role;
      }

      if (body.code !== undefined) {
        const code = cleanCode(body.code ?? "");
        if (code === undefined) {
          return NextResponse.json({ error: "The code must be 4 digits." }, { status: 400 });
        }
        patch.verify_code = code;
      }

      /*
       * Three-valued, like the rest: absent leaves the photo alone, null or ""
       * clears it, a data URL uploads, anything else is written verbatim (the
       * column allows an absolute URL).
       *
       * Clearing writes NULL and nothing else. Never a placeholder: photo_path
       * is load-bearing twice over — lib/bubbleField.ts floats photo-havers to
       * the front of the field, and lib/faceCache returns NO sources when it is
       * blank, which is what stopped 47 people's names being typed inside their
       * own empty bubbles.
       */
      if (body.photo !== undefined) {
        const photo = (body.photo ?? "").trim();
        if (!photo) {
          patch.photo_path = null;
        } else if (photo.startsWith("data:")) {
          const saved = await saveFacePhoto(supabase, { eventId: event.id, slug: existing.slug, dataUrl: photo });
          if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 400 });
          patch.photo_path = saved.path;
        } else {
          patch.photo_path = photo;
        }
      }

      // supabase/25. null is a real value here — it is what RECENTRE writes —
      // so these go through clampFrame, which only returns undefined for
      // "the host did not send this key".
      const px = clampFrame(body.photoX, 0, 100);
      const py = clampFrame(body.photoY, 0, 100);
      const pz = clampFrame(body.photoZoom, 0.5, 3);
      if (px !== undefined) patch.photo_x = px;
      if (py !== undefined) patch.photo_y = py;
      if (pz !== undefined) patch.photo_zoom = pz;

      if (!Object.keys(patch).length) {
        return NextResponse.json({ ok: true, changed: false });
      }
      const { error } = await supabase.from("attendees").update(patch).eq("id", body.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await bumpRosterSeq(supabase, event.id);

      /*
       * The directory follows the seat (40_): the name and photo the host
       * just saved are what the next event's import should carry. Read
       * separately and best-effort, because a database without 40_ has no
       * person_id to select and the edit above has already saved.
       */
      const linked = await supabase.from("attendees").select("person_id").eq("id", body.id).maybeSingle();
      const personId = linked.error ? null : (linked.data?.person_id ?? null);
      if (personId) {
        const shared: Parameters<typeof syncPerson>[2] = {};
        if (patch.full_name !== undefined) shared.full_name = patch.full_name;
        if (patch.title !== undefined) shared.title = patch.title;
        if (patch.linkedin_url !== undefined) shared.linkedin_url = patch.linkedin_url;
        if (patch.photo_path !== undefined) shared.photo_path = patch.photo_path;
        if (patch.photo_x !== undefined) shared.photo_x = patch.photo_x;
        if (patch.photo_y !== undefined) shared.photo_y = patch.photo_y;
        if (patch.photo_zoom !== undefined) shared.photo_zoom = patch.photo_zoom;
        await syncPerson(supabase, personId, shared);
      }
      return NextResponse.json({ ok: true, changed: true });
    }

    /** design:439-445 — a timestamp, never a DELETE. */
    case "remove": {
      if (!body.id) return NextResponse.json({ error: "An id is required." }, { status: 400 });
      const { error } = await supabase
        .from("attendees")
        .update({ removed_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("event_id", event.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await bumpRosterSeq(supabase, event.id);
      return NextResponse.json({ ok: true });
    }

    /** design:447 — RESTORE n DELETED brings all of them back. */
    case "restore": {
      const { error } = await supabase
        .from("attendees")
        .update({ removed_at: null })
        .eq("event_id", event.id)
        .not("removed_at", "is", null);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      /*
       * Walk-ins from before the position generator existed come back with no
       * bubble position and would pile up at the top of the field. Give any
       * such row the next slots along the serpentine now — positioned people
       * keep the slot they always had.
       */
      const { data: unplaced } = await supabase
        .from("attendees")
        .select("id")
        .eq("event_id", event.id)
        .eq("added_by_host", true)
        .is("bubble_top", null)
        .order("created_at", { ascending: true });
      if (unplaced?.length) {
        const slots = await nextBubbleSlots(supabase, event.id, unplaced.length);
        for (let i = 0; i < unplaced.length; i += 1) {
          await supabase.from("attendees").update(slots[i]).eq("id", unplaced[i].id);
        }
      }
      await bumpRosterSeq(supabase, event.id);
      return NextResponse.json({ ok: true });
    }

    /**
     * One person back, rather than everyone. The design only ever offered
     * "RESTORE n DELETED" (design:447), which is the wrong shape for the actual
     * mistake — DELETE fires with no confirmation, so the thing the host wants
     * undone is almost always the last single tap, not the whole evening's.
     * `restore` above is untouched and still does all of them.
     */
    case "restoreOne": {
      if (!body.id) return NextResponse.json({ error: "An id is required." }, { status: 400 });
      const { error } = await supabase
        .from("attendees")
        .update({ removed_at: null })
        .eq("id", body.id)
        .eq("event_id", event.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      // Same catch-up as `restore`: a walk-in from before the position
      // generator existed comes back with no slot and would pile up at the top.
      const { data: back } = await supabase
        .from("attendees")
        .select("id, bubble_top")
        .eq("id", body.id)
        .maybeSingle();
      if (back && back.bubble_top === null) {
        const [slot] = await nextBubbleSlots(supabase, event.id, 1);
        await supabase.from("attendees").update(slot).eq("id", body.id);
      }
      await bumpRosterSeq(supabase, event.id);
      return NextResponse.json({ ok: true });
    }

    /**
     * The one real DELETE in this file (Belal, 2026-08-22: "in the soft delete
     * please add another option button next to the bring back that says delete
     * permanently"). Everything the header says about `remove` never deleting
     * still holds — `remove` still never does. This is the separate, explicit
     * act of taking somebody out of the database for good, and it is fenced
     * three ways:
     *
     *  1. THEY MUST ALREADY BE REMOVED. The button only exists in the REMOVED
     *     section, and the check is restated here: a purge is always the second
     *     decision about a person, never the first. Somebody in the room cannot
     *     be erased by a single request.
     *  2. TWO STEPS. The first, unconfirmed call writes NOTHING and answers
     *     with what would go (lib/admin/impact.ts) so the sheet can put real
     *     numbers on the screen — the contract /api/admin/reset already uses.
     *     Without `confirm: true` nothing is deleted whatever the browser did.
     *  3. THE CASCADE IS THE POINT, and it is why this cannot be undone: every
     *     child table is `on delete cascade` (supabase/01_schema.sql), so their
     *     session goes in the same statement. A past run keeps its
     *     NUMBERS — `runs.stats` and
     *     `runs.snapshot` are jsonb on the run's own row (supabase/26_runs.sql)
     *     and nothing here touches them — but the person drops out of every
     *     archived evening's LIST, because an archived view is joined against
     *     the live roster rather than the snapshot's copy of it
     *     (lib/admin/runArchive.ts: "the person is general, the evening is the
     *     run's"). The sheet says so; a host erasing somebody should know the
     *     history stops showing them.
     *
     * The photo is deleted by hand because storage has no foreign keys. It goes
     * FIRST: a file left in the bucket under the slug of a row that no longer
     * exists is a stranger's face served to whoever next takes that slug. Unless
     * something else still shows it — a seat at another event, or the directory
     * (`people`), which keeps their photo for a later event: then it stays
     * (lib/storage deleteFacePhotos). A file already gone does not stop the purge.
     */
    case "purgeOne": {
      if (!body.id) return NextResponse.json({ error: "An id is required." }, { status: 400 });

      const { data: person } = await supabase
        .from("attendees")
        .select("id, full_name, photo_path, removed_at")
        .eq("id", body.id)
        .eq("event_id", event.id)
        .maybeSingle();
      if (!person) {
        return NextResponse.json({ error: "There is no such person." }, { status: 404 });
      }
      if (!person.removed_at) {
        return NextResponse.json(
          { error: "Remove them from the room first — a purge is never the first step." },
          { status: 409 },
        );
      }

      if (!body.confirm) {
        // No phones sign in here, so nothing else is recorded for them (CIB counts a signed-in phone).
        return NextResponse.json({ needsConfirm: true, personImpact: ZERO_PERSON_IMPACT });
      }

      if (person.photo_path) {
        const files = await deleteFacePhotos(supabase, [person.photo_path], { attendeeIds: [person.id] });
        // A file that will not delete must not leave the row behind it alive:
        // stop, say so, and let the host try again rather than half-erasing
        // somebody.
        if (!files.ok) return NextResponse.json({ error: files.error }, { status: 500 });
      }

      const { error } = await supabase
        .from("attendees")
        .delete()
        .eq("id", person.id)
        .eq("event_id", event.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await bumpRosterSeq(supabase, event.id);
      return NextResponse.json({ ok: true, deleted: person.full_name });
    }

    /*
     * DELETE EVERYONE REMOVED, FOR GOOD (Belal, 2026-09-28: "add an option to
     * delete permanently … next to the restore that deletes everyone that is
     * soft deleted"). The single purge above, over the whole removed list, and
     * the same two steps: the dry run answers with the summed numbers and
     * writes nothing; only `confirm: true` deletes. Only rows with
     * `removed_at` are touched — a purge is never the first step for anybody.
     */
    case "purgeAll": {
      const { data: removed } = await supabase
        .from("attendees")
        .select("id, full_name, photo_path")
        .eq("event_id", event.id)
        .not("removed_at", "is", null);
      const rows = removed ?? [];
      if (!rows.length) return NextResponse.json({ ok: true, deleted: 0 });

      if (!body.confirm) {
        return NextResponse.json({ needsConfirm: true, count: rows.length, personImpact: ZERO_PERSON_IMPACT });
      }

      const photos = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
      if (photos.length) {
        const files = await deleteFacePhotos(supabase, photos, { removedOf: event.id });
        if (!files.ok) return NextResponse.json({ error: files.error }, { status: 500 });
      }
      const { error } = await supabase
        .from("attendees")
        .delete()
        .eq("event_id", event.id)
        .not("removed_at", "is", null);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      await bumpRosterSeq(supabase, event.id);
      return NextResponse.json({ ok: true, deleted: rows.length });
    }

    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
