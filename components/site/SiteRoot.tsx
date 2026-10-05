"use client";

import "@/components/moments/moments.css";
import "./site.css";

import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ElementType } from "react";

import { useEdit } from "@/components/moments/edit/context";
import { EditScope } from "@/components/moments/edit/EditScope";
import { Tx } from "@/components/moments/ui/Tx";
import { cx } from "@/components/ui/cx";
import type { SiteData } from "@/lib/queries/site";
import type { RegFieldKey } from "@/lib/regFields";
import { DEFAULT_HERO_IMAGE, DEFAULT_PAGE, LIST_MAX, normalizePage, type SitePage, type SitePhoto, type SiteText } from "@/lib/sitePage";

import { AdminBar, type Notice, type SiteMode } from "./AdminBar";
import { Album } from "./Album";
import { EditImage } from "./EditImage";
import { Arrow } from "./icons";
import { RichText } from "./RichText";
import { SiteForm } from "./SiteForm";
import { useAutosave, worst } from "./useAutosave";

const line = (en: string) => ({ en, ar: "" });
const removeAt = <T,>(list: T[], i: number) => list.filter((_, k) => k !== i);
const insertAt = <T,>(list: T[], i: number, item: T) => [...list.slice(0, i), item, ...list.slice(i)];

/**
 * The page's own "kind" for the in-place editor (components/moments/edit): every edit passes
 * through the page's rule (lib/sitePage.ts), which is also what tells each line how long it may be.
 */
const SITE_KIND = { id: "site", validate: (raw: unknown): object => normalizePage(raw) ?? DEFAULT_PAGE };

type Props = SiteData & {
  /** "Thu 22 Oct 2026 · Cairo": the event's day and place, written on the server. */
  when: string;
  /** A signed-in host: the bar, and edit mode (`edit`: open in it). Null for everybody else. */
  admin: { edit: boolean } | null;
};

/**
 * INCIRCLE.COMMUNITY — the invitation, the registration form, about InCircle, and the album.
 *
 * Built the way InCircle builds (incircle-application's design foundations): Gilroy alone, the
 * orb drawn in code as the one mark, the ramp for the one commit button, white space and a single
 * icy band — calm, to the point, and easy on a phone (the form is one tap from the top bar).
 *
 * Visitors get the page. A signed-in host gets the same page and the bar at its bottom
 * (AdminBar): PREVIEW is exactly what a visitor sees; EDIT makes every part of it editable where
 * it shows — words typed in place (bold with ⌘B), the hero photo replaced, paragraphs and photos
 * added, removed and reordered, the form's fields arranged — and everything saves itself as it is
 * made (useAutosave), to the same settings the control room reads.
 */
export function SiteRoot({ content, fields, open, full, when, admin }: Props) {
  const [mode, setMode] = useState<SiteMode>(admin?.edit ? "edit" : "preview");
  const editing = admin !== null && mode === "edit";
  const [page, setPage] = useState<SitePage>(content);
  const [order, setOrder] = useState<RegFieldKey[]>(fields);
  const [layer, setLayer] = useState<HTMLDivElement | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<{ id: string; top: number } | null>(null);

  const pageSave = useAutosave("reg_page", content, 700, admin !== null);
  const fieldSave = useAutosave("reg_fields", fields, 0, admin !== null);
  const { push: pushPage } = pageSave;

  useEffect(() => {
    pushPage(normalizePage(page) ?? page);
  }, [page, pushPage]);

  const edit = useCallback((next: (cfg: object) => object) => setPage((p) => next(p) as SitePage), []);

  /* The top bar draws its hairline once the page has moved under it. */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------------------------------------------------- preview ⇄ edit */

  const changeMode = (next: SiteMode) => {
    if (next === mode) return;
    // A text being typed into finishes first, so its last words are kept.
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    // Keep the part of the page in view where it is: edit mode draws some parts taller.
    const parts = [...document.querySelectorAll<HTMLElement>("[data-part]")];
    const inView = parts.find((el) => el.getBoundingClientRect().bottom > 90);
    anchor.current = inView ? { id: inView.dataset.part ?? "", top: inView.getBoundingClientRect().top } : null;
    setMode(next);
    pageSave.flush();
    fieldSave.flush();
    const url = new URL(window.location.href);
    if (next === "edit") url.searchParams.set("edit", "1");
    else url.searchParams.delete("edit");
    window.history.replaceState(window.history.state, "", url);
  };

  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a) return;
    const el = document.querySelector<HTMLElement>(`[data-part="${a.id}"]`);
    if (el) window.scrollBy({ top: el.getBoundingClientRect().top - a.top, behavior: "instant" });
  }, [mode]);

  /* ------------------------------------------------- reveal on scroll */

  /*
   * A part that has come into view is marked with `data-in`, an attribute React does not own: a
   * class added here was wiped the moment React re-rendered a part's own classes — grabbing the
   * album strip (its `is-grabbing`) made the whole strip fade out and slide away, for good.
   */
  useEffect(() => {
    if (editing) return;
    const els = [...document.querySelectorAll<HTMLElement>(".st-reveal:not([data-in])")];
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.setAttribute("data-in", ""));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.06 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [editing]);

  /* ------------------------------------------------- a new text takes the caret */

  useEffect(() => {
    if (!focusPath) return;
    const el = document.querySelector<HTMLElement>(`[data-edit="${focusPath}"]`);
    setFocusPath(null);
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusPath]);

  /* ------------------------------------------------- lists: add, remove (with Undo) */

  const offer = (text: string, undo: () => void) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({
      text,
      undo: () => {
        undo();
        setNotice(null);
      },
    });
    noticeTimer.current = setTimeout(() => setNotice(null), 7000);
  };
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  const setParagraphs = (fn: (list: SiteText[]) => SiteText[]) => setPage((p) => ({ ...p, join: { ...p.join, paragraphs: fn(p.join.paragraphs) } }));
  const setCards = (fn: (list: SiteText[]) => SiteText[]) => setPage((p) => ({ ...p, about: { ...p.about, cards: fn(p.about.cards) } }));
  const setPhotos = useCallback(
    (next: SitePhoto[] | ((prev: SitePhoto[]) => SitePhoto[])) =>
      setPage((p) => ({ ...p, album: { ...p.album, photos: typeof next === "function" ? next(p.album.photos) : next } })),
    [],
  );

  const removeParagraph = (i: number) => {
    const item = page.join.paragraphs[i];
    setParagraphs((l) => removeAt(l, i));
    if (item?.text.trim()) offer("Paragraph removed", () => setParagraphs((l) => insertAt(l, i, item)));
  };
  const removeCard = (i: number) => {
    const item = page.about.cards[i];
    setCards((l) => removeAt(l, i));
    if (item?.text.trim()) offer("Paragraph removed", () => setCards((l) => insertAt(l, i, item)));
  };
  const removePhoto = (i: number) => {
    const item = page.album.photos[i];
    setPhotos((l) => removeAt(l, i));
    if (item) offer("Photo removed", () => setPhotos((l) => insertAt(l, i, item)));
  };

  /* ------------------------------------------------- the form's fields */

  const saveFields = (next: RegFieldKey[]) => {
    setOrder(next);
    fieldSave.push(next);
  };
  const setRequired = (key: RegFieldKey, required: boolean) =>
    setPage((p) => ({ ...p, fields: { ...p.fields, [key]: { ...p.fields[key], required } } }));

  /* ------------------------------------------------- the page */

  // Preview shows the page with its edits, exactly as visitors will see it once saved.
  const paragraphs = editing ? page.join.paragraphs : page.join.paragraphs.filter((t) => t.text.trim());
  const cards = editing ? page.about.cards : page.about.cards.filter((t) => t.text.trim());
  const photos = page.album.photos;
  // In edit mode a button is words to type into, not a link to follow.
  const Go = editing ? "span" : "a";
  const to = (href: string) => (editing ? {} : { href });

  const body = (
    <div className={cx("st-page", admin && "st-hosted", editing && "st-editing")}>
      <noscript dangerouslySetInnerHTML={{ __html: "<style>.st-reveal{opacity:1;transform:none}</style>" }} />

      <header className={cx("st-nav", scrolled && "is-scrolled")}>
        <div className="st-wrap st-nav-in">
          <a className="st-mark" href="#top" aria-label="InCircle Community — back to the top">
            {/* InCircle's own wordmark, the words only (public/brand/typeface.png). */}
            {/* eslint-disable-next-line @next/next/no-img-element -- a small fixed brand file, shown as it is */}
            <img src="/brand/typeface.png" alt="InCircle Community" width={103} height={42} />
          </a>
          <Go className="st-btn st-btn-commit st-btn-sm" {...to("#register")}>
            <T className="lbl" path="nav.cta" value={page.nav.cta} placeholder="+ A button" />
          </Go>
        </div>
      </header>

      <main id="top">
        {/* ── the invitation ── */}
        <section className="st-hero" data-part="hero">
          <div className="st-wrap st-hero-in">
            <span className="st-hero-mark">
              {/* InCircle's own logo, the circle with the words (public/brand/logo.png). */}
              {/* eslint-disable-next-line @next/next/no-img-element -- a small fixed brand file, shown as it is */}
              <img src="/brand/logo.png" alt="InCircle Community" width={216} height={216} />
            </span>
            <T as="p" className="st-eyebrow" path="hero.tagline" value={page.hero.tagline} placeholder="+ A line over the heading" />
            <T as="h1" className="st-h1" path="intro.heading" value={page.intro.heading} placeholder="+ The invitation" />
            <T as="p" className="st-lead" path="intro.sub" value={page.intro.sub} placeholder="+ A line under it" />
            {when ? (
              <p className="st-when" title={editing ? "The event's day and place: set in the control room's Settings" : undefined}>
                <i aria-hidden />
                {when}
              </p>
            ) : null}
            <div className="st-cta">
              <Go className="st-btn st-btn-commit" {...to("#register")}>
                <T className="lbl" path="nav.cta" value={page.nav.cta} placeholder="+ A button" />
                <Arrow className="arr" />
              </Go>
            </div>
          </div>
          <div className="st-wrap st-hero-shot">
            <EditImage
              src={page.hero.image}
              alt="The InCircle community, together"
              editing={editing}
              defaultSrc={DEFAULT_HERO_IMAGE}
              onChange={(src) => setPage((p) => ({ ...p, hero: { ...p.hero, image: src } }))}
            />
          </div>
        </section>

        {/* ── the registration ── */}
        <section className="st-join" id="join" data-part="join">
          <div className="st-wrap st-join-grid">
            <div className="st-join-copy st-reveal">
              <T as="p" className="st-eyebrow" path="join.kicker" value={page.join.kicker} placeholder="+ A small line" />
              <T as="h2" className="st-h2" path="join.heading" value={page.join.heading} placeholder="+ A heading" />
              {paragraphs.length || editing ? (
                <div className="st-paras">
                  {paragraphs.map((t, i) => (
                    <RichText key={i} path={`join.paragraphs.${i}.text`} value={t.text} className="st-body" onRemove={() => removeParagraph(i)} />
                  ))}
                </div>
              ) : null}
              {editing ? (
                <button
                  type="button"
                  className="st-add"
                  disabled={paragraphs.length >= LIST_MAX.paragraphs}
                  onClick={() => {
                    setParagraphs((l) => [...l, { text: "" }]);
                    setFocusPath(`join.paragraphs.${paragraphs.length}.text`);
                  }}
                >
                  + Add a paragraph
                </button>
              ) : null}
            </div>
            {/* The form never waits for a reveal: "Register" lands on it exactly. */}
            <div>
              <SiteForm content={page} fields={order} editing={editing} open={open} full={full} onFields={saveFields} onRequired={setRequired} />
            </div>
          </div>
        </section>

        {/* ── about: one statement, its key words in ink ── */}
        {editing || cards.length ? (
          <section className="st-about" id="about" data-part="about">
            <div className="st-wrap">
              <T as="p" className="st-eyebrow st-reveal" path="about.heading" value={page.about.heading} placeholder="+ A heading" />
              {cards.map((t, i) => (
                <div key={i} className="st-reveal">
                  <RichText
                    path={`about.cards.${i}.text`}
                    value={t.text}
                    className={i === 0 ? "st-statement" : "st-body st-about-more"}
                    placeholder={i === 0 ? "Say what InCircle is, in one sentence" : "Write a paragraph"}
                    onRemove={() => removeCard(i)}
                  />
                </div>
              ))}
              {editing ? (
                <button
                  type="button"
                  className="st-add"
                  disabled={cards.length >= LIST_MAX.cards}
                  onClick={() => {
                    setCards((l) => [...l, { text: "" }]);
                    setFocusPath(`about.cards.${cards.length}.text`);
                  }}
                >
                  + Add a paragraph
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* ── the album ── */}
        {editing || photos.length ? (
          <section className="st-album" id="moments" data-part="moments">
            <Album
              heading={<T as="h2" className="st-h2" path="album.heading" value={page.album.heading} placeholder="+ A heading" />}
              photos={photos}
              editing={editing}
              onChange={setPhotos}
              onRemove={removePhoto}
            />
          </section>
        ) : null}

        {/* ── the words a visitor only sees at times ── */}
        {editing ? (
          <section className="st-msgsec" data-part="messages">
            <div className="st-wrap">
              <div className="st-card st-msgs">
                <h3>Shown only at times</h3>
                <Msg k="After someone registers" path="join.thanks" value={page.join.thanks} />
                <Msg k="Under it" path="join.thanksNote" value={page.join.thanksNote} />
                <Msg k="When every seat is taken (over the form)" path="join.full" value={page.join.full} />
                <Msg k="While registration is closed (instead of the form)" path="join.closed" value={page.join.closed} />
                <Msg k="The page's title, in search results and shared links" path="meta.title" value={page.meta.title} />
                <Msg k="The line under it" path="meta.description" value={page.meta.description} />
              </div>
            </div>
          </section>
        ) : null}
      </main>

      <footer className="st-foot">
        <div className="st-wrap st-foot-in">
          <p>
            <T path="footer.text" value={page.footer.text} placeholder="+ A line" />
            <T as="b" path="footer.brand" value={page.footer.brand} placeholder="+ A name" />
          </p>
        </div>
      </footer>

      {admin ? (
        <AdminBar
          mode={mode}
          onMode={changeMode}
          live={open}
          save={worst(pageSave.state, fieldSave.state)}
          onRetry={() => {
            pageSave.flush();
            fieldSave.flush();
          }}
          notice={notice}
        />
      ) : null}

      <div ref={setLayer} className="st-layer" />
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      {editing ? (
        <EditScope cfg={page} lang="en" edit={edit} kind={SITE_KIND} layer={layer}>
          {body}
        </EditScope>
      ) : (
        body
      )}
    </MotionConfig>
  );
}

/**
 * One line of the page's words: typed into where it shows in edit mode, drawn as it is for a
 * visitor, and not drawn at all for a visitor when it is empty.
 */
function T({ path, value, as, className, placeholder }: { path: string; value: string; as?: ElementType; className?: string; placeholder?: string }) {
  const edit = useEdit();
  if (!edit && !value.trim()) return null;
  return <Tx text={line(value)} path={path} as={as} className={className} placeholder={placeholder} />;
}

/** One of the words a visitor only sees at times, with what it is for. */
function Msg({ k, path, value }: { k: string; path: string; value: string }) {
  return (
    <div className="st-msg">
      <span className="k">{k}</span>
      <T as="div" className="v" path={path} value={value} placeholder="+ Write it" />
    </div>
  );
}
