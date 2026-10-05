import assert from "node:assert/strict";
import { test } from "node:test";

import { getSetting } from "./settings";
import { cleanImageSrc, DEFAULT_PAGE, LIST_MAX, normalizePage, plainText, richParts } from "./sitePage";

/**
 * The public page's content (`reg_page`) is edited on the page itself and saved as it is typed,
 * so its rule (lib/sitePage.ts normalizePage) is what keeps any saved value — an older build's, a
 * half-typed one, a hand-edited row — a whole page that renders. Run with `npm test`.
 */

const withPage = (reg_page: unknown) => ({ settings: { reg_page } as never });

test("no saved page reads as incircle.community's own", () => {
  assert.deepEqual(getSetting(withPage(undefined), "reg_page"), DEFAULT_PAGE);
  assert.deepEqual(getSetting(withPage("a string"), "reg_page"), DEFAULT_PAGE);
  assert.deepEqual(normalizePage({}), DEFAULT_PAGE);
});

test("the default page is already in its own clean form", () => {
  assert.deepEqual(normalizePage(DEFAULT_PAGE), DEFAULT_PAGE);
  assert.deepEqual(normalizePage(JSON.parse(JSON.stringify(DEFAULT_PAGE))), DEFAULT_PAGE);
});

test("a page saved with only some parts keeps them and fills in the rest", () => {
  const page = normalizePage({ intro: { heading: "  The Fourth   Circle  " }, hero: { tagline: "" } });
  assert.ok(page);
  assert.equal(page.intro.heading, "The Fourth Circle");
  assert.equal(page.intro.sub, DEFAULT_PAGE.intro.sub);
  // An empty line is the host's choice, not a missing one: it stays empty.
  assert.equal(page.hero.tagline, "");
  assert.equal(page.hero.image, DEFAULT_PAGE.hero.image);
  assert.deepEqual(page.album, DEFAULT_PAGE.album);
});

test("every line is capped, so a runaway paste never breaks the page", () => {
  const page = normalizePage({ intro: { heading: "x".repeat(5000) }, nav: { cta: "y".repeat(500) } });
  assert.ok(page);
  assert.equal(page.intro.heading.length, 160);
  assert.equal(page.nav.cta.length, 40);
});

test("lists keep their order, take bare strings, drop what is not text, and stop at their most", () => {
  const page = normalizePage({ join: { paragraphs: [{ text: "One" }, "Two", 3, { text: "" }, null] } });
  assert.ok(page);
  assert.deepEqual(page.join.paragraphs, [{ text: "One" }, { text: "Two" }, { text: "" }]);
  const long = normalizePage({ about: { cards: Array.from({ length: 20 }, (_, i) => ({ text: `Card ${i}` })) } });
  assert.equal(long?.about.cards.length, LIST_MAX.cards);
});

test("name and email are always required, whatever was saved", () => {
  const page = normalizePage({
    fields: { name: { required: false }, email: { required: false }, phone: { required: false }, company: { required: true } },
  });
  assert.ok(page);
  assert.equal(page.fields.name.required, true);
  assert.equal(page.fields.email.required, true);
  assert.equal(page.fields.phone.required, false);
  assert.equal(page.fields.company.required, true);
  assert.equal(page.fields.name.label, DEFAULT_PAGE.fields.name.label);
});

test("a picture is one of ours under /site/, or an https address — nothing else", () => {
  assert.equal(cleanImageSrc("/site/album/g1.jpeg"), "/site/album/g1.jpeg");
  assert.equal(cleanImageSrc("https://abc.supabase.co/storage/v1/object/public/site/album/x.jpg"), "https://abc.supabase.co/storage/v1/object/public/site/album/x.jpg");
  for (const bad of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "http://example.com/a.jpg",
    "/site/../.env",
    "/etc/passwd",
    'https://x.co/a.jpg" onerror="alert(1)',
    "https://x.co/a b.jpg",
    "https://x.co/a).jpg",
    `https://x.co/${"a".repeat(700)}.jpg`,
    42,
    null,
  ]) {
    assert.equal(cleanImageSrc(bad), null, String(bad));
  }
});

test("an album photo with a bad address is dropped; its size is kept sane", () => {
  const page = normalizePage({
    album: {
      photos: [
        { src: "javascript:alert(1)", w: 100, h: 100 },
        { src: "/site/album/g2.jpeg", w: -4, h: "tall", alt: "  A   moment " },
        { src: "https://cdn.example.com/p.webp", w: 99999, h: 1200.6 },
      ],
    },
  });
  assert.ok(page);
  assert.deepEqual(page.album.photos, [
    { src: "/site/album/g2.jpeg", w: 1600, h: 1067, alt: "A moment" },
    { src: "https://cdn.example.com/p.webp", w: 20000, h: 1201, alt: "" },
  ]);
  // A hero photo with a bad address falls back to the default photo; so does the old raster logo.
  assert.equal(normalizePage({ hero: { image: "javascript:alert(1)" } })?.hero.image, DEFAULT_PAGE.hero.image);
  assert.equal(normalizePage({ hero: { image: "/site/logo-full.webp" } })?.hero.image, DEFAULT_PAGE.hero.image);
  assert.equal(normalizePage({ hero: { image: "/site/album/g3.jpeg" } })?.hero.image, "/site/album/g3.jpeg");
});

test("bold words are written **like this**", () => {
  assert.deepEqual(richParts("We bring **together** people"), [
    { text: "We bring ", bold: false },
    { text: "together", bold: true },
    { text: " people", bold: false },
  ]);
  assert.deepEqual(richParts("**All bold**"), [{ text: "All bold", bold: true }]);
  // An unmatched marker stays as written.
  assert.deepEqual(richParts("Half **open"), [{ text: "Half **open", bold: false }]);
  assert.deepEqual(richParts(""), []);
  assert.equal(plainText(DEFAULT_PAGE.about.cards[0].text).includes("**"), false);
});
