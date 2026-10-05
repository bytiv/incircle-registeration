-- ============================================================================
-- InCircle registration · 02_security_storage.sql — who may touch what, and
-- where the photos live. Run AFTER 01_schema.sql.
-- Re-runnable: the bucket upserted, the whole file one transaction.
--
-- THE MODEL. No browser ever talks to Supabase in this app. The public page
-- (/register) renders on the server and its form posts to a server route; the
-- control room (/admin) is a server page behind ADMIN_PASSCODE, and every one
-- of its writes is a server route. All of them use the service role, which
-- bypasses RLS. So every table has RLS on and NO policy: with the anon or any
-- other key, nothing can be read or written.
--
-- CIB's 03 is the same model plus the phones' read policies; when the event
-- app arrives it adds them. That is why events and event_state keep the table
-- grants Supabase gives every new table (RLS alone closes them now, and CIB's
-- phone policies need the grants later), while attendees and people lose them
-- for good, exactly as CIB's 03 does: they hold codes, addresses and phones.
-- ============================================================================

begin;

-- ------------------------------------------------------------------ 1. RLS on
alter table public.events      enable row level security;
alter table public.event_state enable row level security;
alter table public.people      enable row level security;
alter table public.attendees   enable row level security;


-- --------------------------------------- 2. attendees, people: no browser, ever
-- No policy and no grant. The revokes are belt and braces over RLS: a policy
-- added later cannot quietly expose a verify_code, an address or a phone.
revoke all on public.attendees from anon, authenticated;
revoke all on public.people    from anon, authenticated;


-- ----------------------------------------------------------------- 3. storage
-- One PUBLIC bucket, `faces`: people's photos, named after attendees.slug.
-- Public read is fine (CIB puts the faces on the wall); every write goes
-- through a server route with the service role, so storage.objects needs no
-- policy. CIB's 03 creates the same bucket the same way.
insert into storage.buckets (id, name, public)
values ('faces', 'faces', true)
on conflict (id) do update set public = excluded.public;

-- A second PUBLIC bucket, `site`: the pictures a signed-in host puts on the
-- public page itself (the hero, the album). Written only by
-- /api/admin/site/upload with the service role, read by anyone (they are on the
-- page). The pictures the page ships with live in the app (public/site/).
insert into storage.buckets (id, name, public)
values ('site', 'site', true)
on conflict (id) do update set public = excluded.public;

commit;
