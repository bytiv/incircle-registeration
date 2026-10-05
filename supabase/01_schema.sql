-- ============================================================================
-- InCircle registration · 01_schema.sql — the tables. Run FIRST.
-- Re-runnable: `if not exists` everywhere, the trigger dropped before it is
-- recreated, the whole file one transaction.
--
-- A STRICT SUBSET OF CIB'S SCHEMA. These four tables, their indexes and the
-- seq trigger are copied from CIB's supabase/01_schema.sql exactly as they are
-- there, and nothing else is created. When InCircle moves to CIB's platform,
-- CIB's own 01 → 05 can run on this same database: its `create table if not
-- exists` leaves these tables (and every registration in them) untouched and
-- adds the rest of the event app around them. Keep it that way: change a table
-- here only the way CIB changes it.
--
--   01_schema.sql            this file: events, event_state, people, attendees
--                            (+ attendees.profile, CIB's own column)
--   02_security_storage.sql  RLS, grants, the `faces` photo bucket
--   03_seed.sql              the InCircle event and its settings row
--
-- Needs Postgres 15 or newer (every current Supabase project).
-- gen_random_uuid() is core, so no extension is needed.
-- ============================================================================

begin;

-- ------------------------------------------------------------------ 1. events
-- One row per event.
--   is_active   THE ROOM: the event the control room works on (CIB: and the
--               phones and the wall).
--   is_public   the event /register takes sign-ups for. None = registration
--               closed. The control room's PUBLIC PAGE switch moves it.
--   deleted_at  soft delete (CIB's Events page). Nothing here sets it.
--   slug        only the NEXT_PUBLIC_EVENT_SLUG fallback, for a database where
--               nothing is marked active.
-- ONE ACTIVE, ONE PUBLIC: each flag is held by at most one row, enforced by a
-- partial unique index rather than by the app. Moving a flag is "clear the old
-- row, then set the new one".
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  starts_at   timestamptz,
  venue       text,
  created_at  timestamptz not null default now(),
  is_active   boolean not null default false,
  is_public   boolean not null default false,
  deleted_at  timestamptz
);

create unique index if not exists events_one_active on public.events (is_active) where is_active;
create unique index if not exists events_one_public on public.events (is_public) where is_public;


-- ------------------------------------------------------------- 2. event_state
-- ONE row per event. In CIB it is where the room is, and every phone follows
-- it; here two of its columns are used:
--   settings     the registration page's knobs (its words, its fields, the
--                approval rule, the seats) — keys typed and defaulted in
--                lib/settings.ts, written only through /api/admin/state
--   roster_seq   bumped after every change to the list, so an open control
--                room re-reads it (CIB: and the phones)
--   seq, changed_at  set by the trigger below, never by hand
-- The other columns are CIB's room (the run of show, held, the run counter …)
-- and keep their defaults until the event app uses them.
create table if not exists public.event_state (
  event_id       uuid primary key references public.events(id) on delete cascade,
  stage_index    int         not null default 0,
  held           boolean     not null default true,
  open_max       int         not null default 0,
  blocks         jsonb       not null default '[]'::jsonb,
  stage_order    jsonb,
  stages_off     jsonb       not null default '[]'::jsonb,
  seq            bigint      not null default 0,
  live           boolean     not null default true,
  changed_at     timestamptz not null default now(),
  show_page_nav  boolean     not null default false,
  back_off       jsonb       not null default '[]'::jsonb,
  run_seq        integer     not null default 0,
  settings       jsonb       not null default '{}'::jsonb,
  roster_seq     int         not null default 0,
  run_started_at timestamptz not null default now()
);

-- THE SEQ GUARD. Every update bumps seq and stamps changed_at, whoever writes
-- and whichever column moves, so every client keeps the highest seq it has
-- seen and drops anything older, and a write made against an older row can be
-- refused (/api/admin/state writes `where seq = <the seq it read>`). That only
-- holds if no write can skip the bump, hence a trigger rather than app code.
create or replace function public.touch_event_state() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.seq := coalesce(old.seq, 0) + 1;
  new.changed_at := now();
  return new;
end $$;

drop trigger if exists event_state_touch on public.event_state;
create trigger event_state_touch before update on public.event_state
  for each row execute function public.touch_event_state();


-- ------------------------------------------------- 3. people (the directory)
-- One row per human across every event: the latest name, title, company,
-- LinkedIn, photo and framing, phone, and the address they registered with —
-- the key, when there is one (one person per address; NULL addresses, e.g.
-- host-typed walk-ins, are each their own person until one is learned).
-- A seat points here through attendees.person_id. Service-role only (02): it
-- holds addresses and phone numbers.
create table if not exists public.people (
  id            uuid primary key default gen_random_uuid(),
  email         text,
  full_name     text not null,
  title         text,
  company       text,
  linkedin_url  text,
  photo_path    text,
  photo_x       numeric,
  photo_y       numeric,
  photo_zoom    numeric,
  phone         text,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists people_one_email
  on public.people (lower(email)) where email is not null;


-- ---------------------------------------------- 4. attendees (a seat at one event)
--   slug             the photo's filename key in the `faces` bucket
--   verify_code      4 digits, made at sign-up: CIB's event app asks for them
--                    on the confirm-code page. Never readable by a browser
--                    (02): every read and write is the service role
--   bubble_left/top  the face-wall position (CIB's event app), given at sign-up
--   added_by_host    added by the host rather than through the page
--   removed_at       soft remove: the host's Remove is reversible (People ›
--                    Removed)
--   photo_x/y/zoom   WHERE INSIDE THE PHOTO the face is: object-position
--                    percentages and a zoom. Null = the role default
--   reg_status       null = invited (added by the host; counts as a confirmed
--                    seat); 'new' → 'approved' → 'confirmed' is the /register
--                    pipeline
--   company, email, phone, registered_at
--                    what /register collected. `email` is the registration
--                    address: one registration per address per event (index)
--   person_id        which directory person this seat is
--   first_claimed_at when this person first claimed a face at the event (CIB's
--                    event app). Nothing here writes it
create table if not exists public.attendees (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  full_name        text not null,
  slug             text not null,
  title            text,
  role             text not null default 'member' check (role in ('host', 'member')),
  photo_path       text,                        -- storage path or absolute URL
  linkedin_url     text,
  verify_code      char(4),
  bubble_left      text,                        -- e.g. '23.5%'
  bubble_top       int,                         -- px
  added_by_host    boolean not null default false,
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  photo_x          numeric,
  photo_y          numeric,
  photo_zoom       numeric,
  reg_status       text,
  company          text,
  email            text,
  phone            text,
  registered_at    timestamptz,
  person_id        uuid references public.people(id) on delete set null,
  first_claimed_at timestamptz,
  unique (event_id, slug),
  -- The route clamps to the same ranges; this is the backstop.
  constraint attendees_photo_frame_check check (
    (photo_x    is null or (photo_x    >= 0   and photo_x    <= 100)) and
    (photo_y    is null or (photo_y    >= 0   and photo_y    <= 100)) and
    (photo_zoom is null or (photo_zoom >= 0.5 and photo_zoom <= 3))
  ),
  constraint attendees_reg_status_check
    check (reg_status is null or reg_status in ('new', 'approved', 'confirmed'))
);

create index if not exists attendees_event_idx on public.attendees (event_id);
create unique index if not exists attendees_one_email_per_event
  on public.attendees (event_id, lower(email)) where email is not null;
create index if not exists attendees_person_idx on public.attendees (person_id);

-- attendees.profile — what registration knows about the person beyond the
-- columns above: the form's one choice, `{"attendee": "first" | "returning"}`
-- (first time, or been before). Written by /api/register only. This is CIB's own
-- column, word for word (CIB's supabase/05_moments.sql, which fills it with the
-- registration and sign-in record), so CIB's later migrations keep it as it is.
alter table public.attendees add column if not exists profile jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attendees_profile_object_check') then
    alter table public.attendees add constraint attendees_profile_object_check
      check (jsonb_typeof(profile) = 'object');
  end if;
end $$;

commit;
