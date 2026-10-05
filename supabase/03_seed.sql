-- ============================================================================
-- InCircle registration · 03_seed.sql — the event. Run AFTER 02.
-- Re-runnable: every insert is `on conflict do nothing`, so a re-run never
-- overwrites what the host has changed since. One transaction.
--
-- Seeds the event `incircle` — the one the control room works on (active),
-- NOT yet on the public page: the Registration page's PUBLIC PAGE switch puts
-- it there once its words are ready — and its event_state row, whose settings
-- start empty (every key falls back to lib/settings.ts). No attendees and no
-- people: the list comes from the public page's form and the People page.
--
-- Its name, date and location are set in the control room (Settings › The
-- event), so they are not guessed here.
-- ============================================================================

begin;

-- The event. Active unless another event already holds the flag (the
-- one-active index would refuse a second), so a re-run cannot fail here.
insert into public.events (slug, name, is_active, is_public)
select 'incircle', 'InCircle',
       not exists (select 1 from public.events where is_active),
       false
on conflict (slug) do nothing;

-- Its settings row.
insert into public.event_state (event_id, settings)
select e.id, '{}'::jsonb
from public.events e
where e.slug = 'incircle'
on conflict (event_id) do nothing;

commit;
