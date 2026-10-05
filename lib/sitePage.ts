import { SUPABASE_URL } from "@/lib/env";
import { LOCKED_FIELDS, REG_FIELD_KEYS, type RegFieldKey } from "@/lib/regFields";

/**
 * THE PAGE — incircle.community, as content: every word, picture and photo on the public
 * page (app/page.tsx, components/site), in one value the host edits on the page itself.
 *
 * It is stored as one setting, `reg_page` (lib/settings.ts), so it rides the event's
 * settings row like the rest of the registration page, and an edit reaches the public page on
 * its next request. `normalizePage` is the setting's rule: every key typed, trimmed and
 * capped, every picture address checked, anything unknown dropped, anything missing filled in
 * from DEFAULT_PAGE — so a page saved by an older build, or a hand-edited row, still renders.
 *
 * Paragraphs may carry bold words, written **like this** (components/site/RichText.tsx).
 * List items are objects (`{ text }`) rather than bare strings, because the in-place editor
 * addresses a text by its path (lib/moments/textPath.ts): "about.cards.0.text".
 */

export type SiteText = { text: string };
export type SitePhoto = { src: string; w: number; h: number; alt: string };
export type SiteField = { label: string; placeholder: string; required: boolean };

export type SitePage = {
  /** What a search result and a shared link say. */
  meta: { title: string; description: string };
  nav: { cta: string };
  /** The hero: its photo, the line over the heading, and its second button (to the album). */
  hero: { image: string; tagline: string; more: string };
  intro: { heading: string; sub: string };
  join: {
    /** The small line over the heading. */
    kicker: string;
    heading: string;
    paragraphs: SiteText[];
    cta: string;
    /** After a sign-up: the line, and the note under it. */
    thanks: string;
    thanksNote: string;
    /** Every seat taken: the form's heading (they can still leave their details, first in line). */
    full: string;
    /** Nothing on the public page: what stands where the form would be. */
    closed: string;
  };
  /** Each field's label and placeholder, and whether it must be filled in. */
  fields: Record<RegFieldKey, SiteField>;
  /** The one choice: first time, or been before. */
  attendee: { first: string; returning: string };
  about: { heading: string; cards: SiteText[] };
  album: { heading: string; photos: SitePhoto[] };
  footer: { text: string; brand: string };
};

/** incircle.community's album, in its order, with each photo's size (public/site/album). */
const ALBUM: [string, number, number][] = [
  ["g1.jpeg", 800, 450],
  ["0R3A9884.jpeg", 1920, 1280],
  ["g2.jpeg", 480, 853],
  ["0R3A9783.jpeg", 1920, 1280],
  ["g3.jpeg", 800, 450],
  ["g4.jpeg", 480, 853],
  ["0R3A0087.jpeg", 1920, 1280],
  ["g5.jpeg", 800, 450],
  ["0R3A0131.jpeg", 1920, 1280],
  ["g6.jpeg", 800, 450],
  ["g7.jpeg", 800, 450],
  ["0R3A0068.jpeg", 1920, 1280],
  ["g8.jpeg", 800, 450],
  ["0R3A9758.jpeg", 1920, 1280],
  ["g9.jpeg", 800, 450],
];

/** The hero's photo until the host puts another there: people in conversation at the last circle. */
export const DEFAULT_HERO_IMAGE = "/site/album/0R3A9884.jpeg";
/** What the hero held before the page was rebuilt (the site's raster logo); read as "the default". */
const LEGACY_HERO_IMAGES = new Set(["/site/logo-full.webp"]);

/** incircle.community, word for word (2026-10-05). */
export const DEFAULT_PAGE: SitePage = {
  meta: {
    title: "InCircle | A Community For Those Shaping IC",
    description: "InCircle Community connects professionals in Internal Communication to foster collaboration and knowledge sharing.",
  },
  nav: { cta: "Register Here" },
  hero: { image: DEFAULT_HERO_IMAGE, tagline: "Step Into the Circle", more: "See the moments" },
  intro: {
    heading: "The Third Circle is Coming This October",
    sub: "A new gathering. New conversations. More voices around the circle.",
  },
  join: {
    kicker: "Join the circle",
    heading: "The circle comes Together again in October",
    paragraphs: [
      {
        text: "We're excited to continue building a community where Internal Communication Practitioners meet, exchange experiences, challenge perspectives, and grow together.",
      },
      {
        text: "If you'd like to be part of the InCircle community, leave your details below. We'd love to get to know you, and a member of our team will reach out to you personally.",
      },
    ],
    cta: "Register Here",
    thanks: "You're in the circle",
    thanksNote: "Thank you for registering. A member of our team will reach out to you personally.",
    full: "This circle is full. Leave your details and you're first in line.",
    closed: "Registration opens soon. Check back here.",
  },
  fields: {
    name: { label: "Full Name", placeholder: "Your full name", required: true },
    title: { label: "Job Title", placeholder: "What do you do?", required: true },
    phone: { label: "Contact Information (Phone)", placeholder: "+20 10 1234 5678", required: true },
    email: { label: "Email", placeholder: "your@email.com", required: true },
    linkedin: { label: "LinkedIn Profile URL", placeholder: "https://linkedin.com/in/your-profile", required: true },
    company: { label: "Company", placeholder: "Where do you work?", required: false },
    photo: { label: "Your Photo", placeholder: "It becomes your face in the room.", required: false },
    attendee: { label: "", placeholder: "", required: false },
  },
  attendee: { first: "First-Time Attendee", returning: "Attended Before" },
  about: {
    heading: "About InCircle",
    cards: [
      {
        text: "We bring **together** people working in and around Internal Communication to build meaningful **connections**, exchange **experiences**, challenge **perspectives**, and deepen how the field is understood and practiced.",
      },
      {
        text: "By doing so, we unlock the full impact of Internal Communication for those shaping it and for the organizations they influence.",
      },
    ],
  },
  album: {
    heading: "Moments from the circle",
    photos: ALBUM.map(([file, w, h], i) => ({ src: `/site/album/${file}`, w, h, alt: `InCircle community gathering ${i + 1}` })),
  },
  footer: { text: "This community is powered by", brand: "DOTMENT" },
};

/* ------------------------------------------------------------------ limits */

/** The most a list may hold: a runaway list is a typo, not a page. */
export const LIST_MAX = { paragraphs: 8, cards: 6, photos: 80 } as const;

/* ------------------------------------------------------------- the rule */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** One line: whitespace collapsed, trimmed, capped. Anything else falls back. */
const line = (v: unknown, max: number, fallback: string): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : fallback;

/** This project's public Storage, where the host's uploads go (http only for a local Supabase). */
const OWN_STORAGE = /^https?:\/\/[^\s"'<>()\\]+$/.test(SUPABASE_URL) ? `${SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/` : null;
const SAFE_URL = /^[^\s"'<>()\\]+$/;

/**
 * A picture's address: one of ours under /site/, one in this project's Storage (the host's
 * uploads), or any https address. Never `javascript:`, a data URL or anything with quotes or spaces.
 */
export function cleanImageSrc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\/site\/[\w./-]+$/.test(s) && !s.includes("..")) return s;
  if (s.length > 600 || !SAFE_URL.test(s)) return null;
  if (s.startsWith("https://") && s.length > "https://".length) return s;
  if (OWN_STORAGE && s.startsWith(OWN_STORAGE) && s.length > OWN_STORAGE.length) return s;
  return null;
}

const dim = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(20000, Math.round(v)) : fallback;

function texts(v: unknown, fallback: SiteText[], max: number, cap: number): SiteText[] {
  if (!Array.isArray(v)) return fallback;
  const out: SiteText[] = [];
  for (const item of v.slice(0, max)) {
    const t = isObj(item) ? item.text : item;
    if (typeof t === "string") out.push({ text: line(t, cap, "") });
  }
  return out;
}

function photos(v: unknown, fallback: SitePhoto[]): SitePhoto[] {
  if (!Array.isArray(v)) return fallback;
  const out: SitePhoto[] = [];
  for (const item of v.slice(0, LIST_MAX.photos)) {
    if (!isObj(item)) continue;
    const src = cleanImageSrc(item.src);
    if (!src) continue;
    out.push({ src, w: dim(item.w, 1600), h: dim(item.h, 1067), alt: line(item.alt, 160, "") });
  }
  return out;
}

function heroImage(v: unknown): string {
  const src = cleanImageSrc(v);
  return src && !LEGACY_HERO_IMAGES.has(src) ? src : DEFAULT_HERO_IMAGE;
}

function fields(v: unknown): Record<RegFieldKey, SiteField> {
  const src = isObj(v) ? v : {};
  const out = {} as Record<RegFieldKey, SiteField>;
  for (const key of REG_FIELD_KEYS) {
    const d = DEFAULT_PAGE.fields[key];
    const f = isObj(src[key]) ? (src[key] as Obj) : {};
    out[key] = {
      label: line(f.label, 80, d.label),
      placeholder: line(f.placeholder, 120, d.placeholder),
      // Name and email are the key of a sign-up: required whatever was saved.
      required: LOCKED_FIELDS.includes(key) ? true : typeof f.required === "boolean" ? f.required : d.required,
    };
  }
  return out;
}

/**
 * THE SETTING'S RULE: any value in, a whole SitePage out (undefined only for a value that is not
 * an object at all, which getSetting then reads as the default page).
 */
export function normalizePage(raw: unknown): SitePage | undefined {
  if (!isObj(raw)) return undefined;
  const d = DEFAULT_PAGE;
  const sub = (k: string): Obj => (isObj(raw[k]) ? (raw[k] as Obj) : {});
  const meta = sub("meta");
  const nav = sub("nav");
  const hero = sub("hero");
  const intro = sub("intro");
  const join = sub("join");
  const attendee = sub("attendee");
  const about = sub("about");
  const album = sub("album");
  const footer = sub("footer");
  return {
    meta: { title: line(meta.title, 120, d.meta.title), description: line(meta.description, 300, d.meta.description) },
    nav: { cta: line(nav.cta, 40, d.nav.cta) },
    hero: {
      image: heroImage(hero.image),
      tagline: line(hero.tagline, 160, d.hero.tagline),
      more: line(hero.more, 40, d.hero.more),
    },
    intro: { heading: line(intro.heading, 160, d.intro.heading), sub: line(intro.sub, 300, d.intro.sub) },
    join: {
      kicker: line(join.kicker, 60, d.join.kicker),
      heading: line(join.heading, 160, d.join.heading),
      paragraphs: texts(join.paragraphs, d.join.paragraphs, LIST_MAX.paragraphs, 1200),
      cta: line(join.cta, 40, d.join.cta),
      thanks: line(join.thanks, 160, d.join.thanks),
      thanksNote: line(join.thanksNote, 300, d.join.thanksNote),
      full: line(join.full, 200, d.join.full),
      closed: line(join.closed, 200, d.join.closed),
    },
    fields: fields(raw.fields),
    attendee: { first: line(attendee.first, 60, d.attendee.first), returning: line(attendee.returning, 60, d.attendee.returning) },
    about: { heading: line(about.heading, 160, d.about.heading), cards: texts(about.cards, d.about.cards, LIST_MAX.cards, 1200) },
    album: { heading: line(album.heading, 160, d.album.heading), photos: photos(album.photos, d.album.photos) },
    footer: { text: line(footer.text, 120, d.footer.text), brand: line(footer.brand, 40, d.footer.brand) },
  };
}

/* ------------------------------------------------------------ bold words */

export type RichPart = { text: string; bold: boolean };

/** A paragraph's text as runs of plain and **bold** words. An unmatched `**` stays as written. */
export function richParts(text: string): RichPart[] {
  const out: RichPart[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let at = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push({ text: text.slice(at, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at), bold: false });
  return out;
}

/** The paragraph without its markers — for a page's description, a screen reader, a search. */
export const plainText = (text: string) => richParts(text).map((p) => p.text).join("");
