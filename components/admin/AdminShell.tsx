"use client";

import type { ReactNode } from "react";
import { motion, MotionConfig } from "motion/react";

import { GuideLayer, GuideProvider, GuideToggle } from "@/components/admin/guide";
import { cx } from "@/components/admin/ui";
import { LogoOrb } from "@/components/ui/InCircleBrand";
import { spring } from "@/lib/motion";

/** Breakpoints are measured, not media-queried — see AdminRoot. */
export type Layout = {
  vw: number;
  mob: boolean;
  nar: boolean;
  navOpen: boolean;
};

export type NavItem = {
  key: string;
  label: string;
  /** The small number or word on the right — "LIVE", "93", "2". */
  count: string;
  /** `warm`: something waits for you (a peach badge) · `live`: it is on (cyan). */
  tone?: "warm" | "live";
  on: boolean;
  go: () => void;
};

/** BEFORE · GENERAL — the rail's groups. */
export type NavGroup = { label: string; items: NavItem[] };

type Props = {
  layout: Layout;
  groups: NavGroup[];
  viewTitle: string;
  viewSub: string;
  /** The small cyan line over the title: what the page acts on. */
  viewKicker?: string;
  /** Changes when the page does, so the page settles in (a fade and a short rise). */
  viewKey?: string;
  /** The page draws its own header: the shell shows none, so the name is not said twice. */
  hideHeader?: boolean;
  /** The event this control room is working on — the rail's WORKING ON card. */
  eventName: string;
  eventDate: string;
  /** The card's state: the page is taking registrations, or not. */
  eventState: { label: string; tone: "live" | "" };
  /** The card opens the event's details (Settings). */
  openEvent: () => void;
  /** The foot card: seats held, the seat count (0 = no limit), sign-ups waiting. */
  roster: { seated: number; capacity: number; waiting: number };
  lockAdmin: () => void;
  toggleNav: () => void;
  closeNav: () => void;
  children: ReactNode;
};

/** What each page of the rail is for, in the guide's one sentence. */
const NAV_GUIDE: Record<string, string> = {
  regpage: "Opens the public sign-up page and the sign-ups waiting for you.",
  people: "Opens everyone on this event's list, to add, edit or remove people.",
  settings: "Opens the event's name, date and location, the links, and sign-out.",
};

/**
 * The control room's shell — InCircle's, transcribed from its settings mockup
 * ("incircle settings organization/InCircle-Settings.html": `.shell`, `.rail`,
 * `.logo`, `.evcard`, `.navg`, `.livecard`, `.railmeta`):
 *
 *   the page       InCircle's drifting light gradient, its five slow blobs
 *   the rail       frosted white: the breathing orb over "InCircle / EVENT
 *                  CONTROL", the WORKING ON card (the event, and whether
 *                  registration is open — it opens the event's details), the
 *                  groups, each page a dot and a word (cyan where you are, on a
 *                  white pill that glides between pages), and at the foot the
 *                  registration card (who is on the list, of how many seats) and
 *                  Sign out
 *   the page       the header (title, one line, the guide's switch) and the page
 *
 * The structural classes stay CIB's (`.app`, `.side`, `main`, `.pad`, `.hd`), because the
 * drawers lock `.app > main`'s scroll and the narrow layout turns `.side` into a drawer;
 * InCircle's look comes from app/incircle.css. Below 1180px the rail is a drawer from the burger.
 */
export function AdminShell({
  layout,
  groups,
  viewTitle,
  viewSub,
  viewKicker,
  viewKey,
  hideHeader,
  eventName,
  eventDate,
  eventState,
  openEvent,
  roster,
  lockAdmin,
  toggleNav,
  closeNav,
  children,
}: Props) {
  const { mob, navOpen } = layout;
  const pct = roster.capacity > 0 ? Math.min(100, Math.round((roster.seated / roster.capacity) * 100)) : 0;

  return (
    <GuideProvider>
      <MotionConfig reducedMotion="user">
        <div className={cx("app ic-app", mob && "mob")} lang="en" dir="ltr">
          <div className="ic-blobs" aria-hidden>
            <i className="b1" />
            <i className="b2" />
            <i className="b3" />
            <i className="b4" />
            <i className="b5" />
          </div>

          {mob && navOpen ? <div className="scrim" onClick={closeNav} /> : null}

          <aside className={cx("side ic-rail", mob && navOpen && "open")} data-sc="" aria-label="Control room" data-guide-at="right">
            <div className="ic-logo">
              <LogoOrb size={36} />
              <div>
                <b>InCircle</b>
                <em>EVENT CONTROL</em>
              </div>
            </div>

            <button
              type="button"
              className="ic-evcard"
              onClick={openEvent}
              title="The event's name, date and location"
              data-guide="Opens the event's name, date and location."
            >
              <span className="k">
                <span>WORKING ON</span>
                <span>EDIT ›</span>
              </span>
              <span className="n" title={eventName}>
                {eventName}
              </span>
              {eventDate ? <span className="d">{eventDate}</span> : null}
              <span className={cx("ic-st", eventState.tone)}>
                <i />
                {eventState.label}
              </span>
            </button>

            <nav className="ic-navg">
              {groups.map((g) => (
                <div key={g.label} className="ic-navgroup">
                  <div className="ic-g">{g.label}</div>
                  {g.items.map((it) => (
                    <button
                      key={it.key}
                      type="button"
                      className={cx("ic-nav", it.on && "on")}
                      onClick={it.go}
                      title={it.label}
                      aria-current={it.on ? "page" : undefined}
                      data-guide={NAV_GUIDE[it.key]}
                      data-nav={it.key}
                    >
                      {it.on ? <motion.i layoutId="ic-navpill" className="ic-navpill" transition={spring.snappy} aria-hidden /> : null}
                      <i className="dot" aria-hidden />
                      <span>{it.label}</span>
                      {it.count ? <em className={it.tone}>{it.count}</em> : null}
                    </button>
                  ))}
                </div>
              ))}
            </nav>

            <div className="ic-railfoot">
              <div className="ic-livecard">
                <div className="lv">
                  <span className="ic-ping" aria-hidden>
                    <i />
                    <b />
                  </span>
                  REGISTRATION
                </div>
                <div className="kv">
                  <span>On the list</span>
                  <b>
                    {roster.seated}
                    {roster.capacity > 0 ? <small> / {roster.capacity}</small> : null}
                  </b>
                </div>
                {roster.capacity > 0 ? (
                  <div className="ic-bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                ) : null}
                {roster.waiting > 0 ? (
                  <div className="w">
                    {roster.waiting} waiting for you
                  </div>
                ) : null}
              </div>
              <div className="ic-railmeta">
                <button
                  type="button"
                  className="signout"
                  onClick={lockAdmin}
                  data-guide="Signs you out of the control room; the passcode is asked again."
                  data-action="sign-out"
                >
                  SIGN OUT
                </button>
              </div>
            </div>
          </aside>

          <main data-sc="">
            <div className="mtop">
              <button type="button" className="burger" onClick={toggleNav} aria-label="Open the menu">
                <i />
                <i />
                <i />
              </button>
              <b className="mtop-t">{viewTitle}</b>
            </div>
            <div className="pad">
              {/* keyed by the page: a new page settles in, a re-render of the same one does not */}
              <div key={viewKey ?? viewTitle} className="pagein">
                {hideHeader ? null : (
                  <div className="hd">
                    <div style={{ minWidth: 0 }}>
                      {viewKicker ? <div className="kick">{viewKicker}</div> : null}
                      <h1>{viewTitle}</h1>
                      {viewSub ? <p>{viewSub}</p> : null}
                    </div>
                    <div className="r">
                      <GuideToggle />
                    </div>
                  </div>
                )}
                {children}
              </div>
            </div>
          </main>
          <GuideLayer />
        </div>
      </MotionConfig>
    </GuideProvider>
  );
}
