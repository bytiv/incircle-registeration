# InCircle — registration

The registration part of the CIB event platform, on its own, so InCircle can take sign-ups
before the full event app moves over — dressed in InCircle's design.

- `/` — the public page: incircle.community, redrawn — the invitation, the registration form,
  About InCircle and the photo album. `/register` leads to its form (`/#join`).
- **Editing the page happens on the page itself.** Signed in (the `/admin` passcode), the page
  shows a bar at the bottom: **Preview** is the page exactly as a visitor sees it; **Edit** makes
  every part editable where it shows — click any words and type (select words and press ⌘B /
  Ctrl+B for bold), replace the hero picture, add, remove and reorder paragraphs, cards and album
  photos, and arrange the form (drag a field, Required on/off, Hide, + Add a field). Everything
  saves itself as you go; the bar says Saved, or what went wrong.
- `/admin` — the control room, behind the passcode:
  - **Registration page** — publish the form or take it down, open the page to edit or preview
    it, set approval and seats, and work the queue: New → Approve → Confirm (or Decline).
  - **People** — everyone who is coming: search, add one or a list, edit someone (details and
    photo), remove and bring back, delete for good, export a CSV.
  - **Settings** — the event's name, date and location (the date line on the page), the link,
    sign-out.

Next.js 15 (App Router) · Supabase (Postgres + Storage). The browser never talks to Supabase:
every read and write is a server route with the service-role key.

## Set it up

### 1. Supabase

Create a project. In **SQL Editor**, run the files in `supabase/` in order:

| File | What it does |
|---|---|
| `01_schema.sql` | The tables: `events`, `event_state` (the page's words, pictures and rules), `people`, `attendees` |
| `02_security_storage.sql` | Row-level security (nothing readable without the service key) and two public buckets: `faces` (sign-up photos) and `site` (the pictures the host puts on the page) |
| `03_seed.sql` | The `incircle` event, not yet published |

Each file is one transaction and safe to re-run.

### 2. Environment

Copy `.env.example` to `.env.local` (locally) or into Vercel → Settings → Environment Variables:

| Variable | Required | Where |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Same page, the `service_role` (secret) key. Server-only |
| `ADMIN_PASSCODE` | yes | Any passcode for `/admin` |
| `NEXT_PUBLIC_SITE_URL` | no | The public address (e.g. `https://incircle.community`), for the link the Registration page prints and shared links (Vercel's own address is used if unset) |
| `NEXT_PUBLIC_EVENT_TZ` | no | Default `Africa/Cairo` |

### 3. Vercel

Import the repository, add the variables above, deploy. Then in `/admin`:

1. **Settings** → the event's name, date and location.
2. **Registration page** → seats and the approval rule, then **Edit the page** for the words,
   pictures, album and form.
3. Switch **PUBLIC PAGE** on and share the address.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # http://localhost:3000 (the page) · /admin (the control room)
```

`npm test` (unit tests), `npm run lint`, `npm run build`.

## The look

**The public page** is built the way InCircle's main app is built (its design foundations in
`incircle-application/incircle_design_refresh`): Gilroy alone, headlines at 800 and tight; the
orb drawn in code as the one mark (no image logo); the ramp — lavender → cyan → mint — for the
one commit button, glass for everything else; white space and soft icy bands, no blobs or
bubbles. Calm and to the point on every screen: the invitation, the date and the button in the
first screen; the form one tap away from the top bar; the album a strip to swipe; photos served
at the size each screen needs.

- `components/site/` — the page (`SiteRoot.tsx`), its form (`SiteForm.tsx`), the album
  (`Album.tsx`), the host's bar (`AdminBar.tsx`) and its stylesheet (`site.css`, all `.st-*`).
- `lib/sitePage.ts` — the page's content as one value (the `reg_page` setting), the site's words
  as its defaults, and the rule every save passes through.
- `public/site/` — the share picture and the album photos the page shipped with (one is the hero photo).

**The control room** is InCircle's, from its own app and design files (`incircle-application`:
the settings mockup `incircle settings organization/InCircle-Settings.html` and its passcode
door): Gilroy (`app/fonts/`, loaded by `app/fonts.ts`), the glass orb, frosted cards on a slowly
drifting light gradient, pill buttons and fields, the cyan→mint ramp for every commit, state as
a dot and a word.

- `app/globals.css` — InCircle's palette, type and depth, under the token names the screens read.
- `app/incircle.css` — what a token cannot say: the shell and rail, glass, the ramp, pills,
  every control-room page.
- `components/admin/gate.css` — the passcode door.
- `components/ui/InCircleBrand.tsx` — the orb, the rail's orb, the wordmark, INCIRCLE BY DOTMENT.
- `public/brand/` — InCircle's logo, wordmark, orb and the Dotment mark; `app/favicon.ico`,
  `app/apple-icon.png`.

CIB's stylesheets (`app/cib.css`, `app/cib-premium.css`) stay underneath for layout: their class
names are what the screens use.

## From CIB, and back to it

The files keep CIB's paths and are CIB's own, cut down where the full app reached further:
the admin shell (`components/admin/AdminRoot.tsx`, `AdminShell.tsx`), its data
(`lib/queries/admin.ts`), the settings (`lib/settings.ts`: only the registration keys), the
settings route (`app/api/admin/state`: only `{type:"setting"}`), Settings, and the People page
(registration columns instead of CIB's event-day ones: in the app, check-in, screen).

**The database is a strict subset of CIB's** — the same four tables, column for column. When
InCircle moves to CIB's platform, CIB's own `supabase/01 → 05` can run on this same project:
they add the rest of the event app and leave every registration in place (checked by running
them on top of these files). Every sign-up already has what CIB's event app needs on the day:
a 4-digit code, a face-wall slot, a directory person. (`attendees.profile`, where the form's
first-time / attended-before choice is kept, is CIB's own column too.)
