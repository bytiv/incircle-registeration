"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { AdminShell, type Layout, type NavGroup } from "@/components/admin/AdminShell";
import { OwnersSheet, type LeadWrites } from "@/components/admin/lead";
import { PeopleView } from "@/components/admin/PeopleView";
import { PersonView } from "@/components/admin/PersonView";
import { RegistrationsView } from "@/components/admin/RegistrationsView";
import { RegistrationView } from "@/components/admin/RegistrationView";
import { SettingsView } from "@/components/admin/SettingsView";
import { Drawer } from "@/components/admin/ui";
import type { FlowAction } from "@/lib/admin/flow";
import type { PersonAsk } from "@/lib/admin/runs";
import { useAdminEventState, type Press, type RoomAnswer } from "@/lib/admin/useAdminEventState";
import { fold, spring } from "@/lib/motion";
import { oneAtATime } from "@/lib/roomSync";
import { holdsSeat, registrationCapacity } from "@/lib/registration";
import type { AdminShellData } from "@/lib/queries/admin";
import { getSetting } from "@/lib/settings";

/**
 * The control room. Everything below the passcode.
 *
 * CIB's control room, cut to registration: the rail's PRE EVENT pages —
 * Registration page (the public page, edited where it shows), Registrations
 * (everyone who signed up, and their four steps) and Lead management
 * (everyone on the list as leads: categories, owner, next action; CIB's
 * People) — and Settings. CIB's Manage events, Build, Run and Results are the
 * event app, which InCircle gets when it moves to CIB's platform.
 *
 * Settings go out through /api/admin/state, the only thing allowed to write
 * them; the list changes through /api/admin/people. The view is client state,
 * mirrored into the URL (`?v=…`) so a reload lands where the host was.
 */

/** `people` is Lead management (CIB's People, renamed on the screen only). */
type View = "regpage" | "registrations" | "people" | "settings";

const VIEWS: View[] = ["regpage", "registrations", "people", "settings"];

/** What app/admin/page.tsx read off the URL — the page to open on. */
export type InitialView = { v?: string };

/* No `v` is the Registration page — the page this app is for. */
function parseInitial(iv: InitialView | undefined): View {
  return VIEWS.includes(iv?.v as View) ? (iv!.v as View) : "regpage";
}

export function AdminRoot({
  initial,
  initialView,
}: {
  initial: AdminShellData;
  initialView?: InitialView;
}) {
  const router = useRouter();
  const start = useMemo(() => parseInitial(initialView), [initialView]);

  const [view, setView] = useState<View>(start);
  const [personId, setPersonId] = useState<string | null>(null);
  const [personEdit, setPersonEdit] = useState(false);
  const [ownersOpen, setOwnersOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  /** Writes in flight, each until its refreshed render has landed. */
  const [writing, setWriting] = useState(0);
  const [sendError, setSendError] = useState("");

  // Lead management's own state.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("name");
  const [dir, setDir] = useState(1);

  /*
   * The layout is measured, not media-queried. Starting at the design's own
   * server-side fallback (1440) keeps the first client render identical to the
   * server's, then the effect takes the real width.
   */
  const [vw, setVw] = useState(1440);
  useEffect(() => {
    const onVw = () => setVw(window.innerWidth);
    onVw();
    window.addEventListener("resize", onVw);
    return () => window.removeEventListener("resize", onVw);
  }, []);

  /* THE URL MIRRORS THE VIEW — `history.replaceState`, so a page change re-renders nothing on the server. */
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("v");
    if (view !== "regpage") url.searchParams.set("v", view);
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [view]);

  const { state, apply: applyState, latest: latestState } = useAdminEventState(initial.event.id, initial.state);

  /* The mockup's one breakpoint (L469): under it the rail is a drawer from the burger. */
  const mob = vw <= 1180;
  const nar = vw <= 1060;
  const layout: Layout = { vw, mob, nar, navOpen: navOpen && mob };

  const snapshot = initial.snapshot;

  /*
   * THE SERVER RENDER, RE-READ, AND WAITED FOR. `router.refresh()` alone is
   * fire-and-forget: the control came back showing the old data and the result
   * popped in when the render landed. In a transition the page keeps what it
   * shows until the new render is ready, and `refresh()` resolves when it has
   * landed — or when the gate replaces this page (a sign-out, a lapsed
   * passcode). Capped at 20 s so a render that never comes cannot hold a
   * control forever.
   */
  const [refreshing, startRefresh] = useTransition();
  const landing = useRef<(() => void)[]>([]);
  const refresh = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const cap = setTimeout(resolve, 20000);
        landing.current.push(() => {
          clearTimeout(cap);
          resolve();
        });
        startRefresh(() => router.refresh());
      }),
    [router],
  );
  useEffect(() => {
    if (refreshing) return;
    for (const landed of landing.current.splice(0)) landed();
  }, [refreshing]);
  useEffect(
    () => () => {
      for (const landed of landing.current.splice(0)) landed();
    },
    [],
  );

  /*
   * NEW SIGN-UPS ARRIVE ON THEIR OWN. Every change to the list — a stranger registering on the
   * public page included — bumps `roster_seq` (lib/admin/roster.ts), and the settings poll brings
   * the row (lib/admin/useAdminEventState.ts). When it is ahead of the list this page was rendered
   * with, the list is re-read. Not while a write of this page's own is landing: that write
   * refreshes the list itself.
   */
  const renderedRoster = initial.state.roster_seq ?? 0;
  useEffect(() => {
    if (writing > 0 || refreshing) return;
    if ((state.roster_seq ?? 0) > renderedRoster) void refresh();
  }, [state.roster_seq, renderedRoster, writing, refreshing, refresh]);

  /*
   * Every press ends up here, and sends are QUEUED, not dropped: the route re-reads the row and
   * reduces against it, so two requests in flight would both read the same state and the second
   * press would be lost. In line (lib/roomSync.ts `oneAtATime`), press two is reduced against the
   * state press one produced — and a press given as a function is BUILT when its turn comes,
   * from the newest row.
   */
  const [turn] = useState(oneAtATime);

  /**
   * The queued POST, and the ONE place /api/admin/state is called. The row the write returned
   * is shown the moment the route answers (through the seq guard). Resolves with the answer once
   * it is on screen, null on any failure, with the error line saying why. Never rejects: a
   * failed press must not break the line for the next one.
   */
  const post = useCallback(
    (press: Press<FlowAction>): Promise<RoomAnswer | null> => {
      setSendError("");
      const answered = turn(async (): Promise<{ body: RoomAnswer | null; reread: boolean }> => {
        try {
          const action = typeof press === "function" ? press(latestState()) : press;
          const res = await fetch("/api/admin/state", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action),
          });
          if (res.status === 401) return { body: null, reread: true };
          const body = (await res.json().catch(() => ({}))) as RoomAnswer & { error?: string };
          if (!res.ok) {
            setSendError(body.error ?? "That did not save.");
            return { body: null, reread: false };
          }
          applyState(body.state);
          return { body, reread: false };
        } catch {
          setSendError("That did not save.");
          return { body: null, reread: false };
        }
      });
      return answered.then(async ({ body, reread }) => {
        if (reread) await refresh();
        return body;
      });
    },
    [turn, applyState, latestState, refresh],
  );

  /** A press: queued like every other, and answered like `post`. */
  const send = useCallback((press: Press) => post(press), [post]);

  /**
   * One POST to a list route, and nothing else: its answer (null when it failed — the error line
   * says why), and whether the page must be re-read first (the passcode lapsed). Never rejects.
   */
  const writeOnce = useCallback(async (url: string, body: unknown): Promise<{ body: unknown | null; reread: boolean }> => {
    try {
      const json = JSON.stringify(body);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
        // Small enough to outlive the tab: a save made as it closes still lands (a photo is not).
        keepalive: json.length < 60_000,
      });
      if (res.status === 401) return { body: null, reread: true };
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        setSendError(b.error ?? "That did not save.");
        return { body: null, reread: false };
      }
      return { body: (await res.json().catch(() => ({}))) as unknown, reread: false };
    } catch {
      setSendError("That did not save.");
      return { body: null, reread: false };
    }
  }, []);

  /*
   * LEAD EDITS WAIT IN ONE LINE — the steps, the CONFIRMED tick, the categories, the owner, the
   * next action. Two quick presses on one person reach the server in the order they were made, so
   * the last one is what stays (the route also refuses to write over a record that changed under
   * it: app/api/admin/people `lead`). Only the write waits; the refresh after it does not hold up
   * the next one.
   */
  const [leadLine] = useState(oneAtATime);

  /* While anything is still saving, closing the tab asks first, so no press is dropped on the way out. */
  useEffect(() => {
    if (writing === 0) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [writing]);

  /**
   * People and the editors change rows the server rendered, so the page is re-fetched rather
   * than patched locally — one source of truth. Resolves with the body once the refreshed render
   * has landed (so nothing comes back showing the old data), null on any failure. `inLine` writes
   * wait their turn behind the other lead edits.
   */
  const mutate = useCallback(
    async (url: string, body: unknown, inLine = false): Promise<unknown | null> => {
      setWriting((n) => n + 1);
      setSendError("");
      try {
        const wrote = await (inLine ? leadLine(() => writeOnce(url, body)) : writeOnce(url, body));
        if (wrote.reread) {
          await refresh();
          return null;
        }
        if (wrote.body === null) return null;
        await refresh();
        return wrote.body;
      } finally {
        setWriting((n) => n - 1);
      }
    },
    [refresh, writeOnce, leadLine],
  );

  /** What a lead takes: one change to it, and Registrations' CONFIRMED tick (the seat). */
  const writes: LeadWrites = useMemo(
    () => ({
      onLead: (id, patch) => mutate("/api/admin/people", { action: "lead", id, patch }, true),
      onConfirm: (id, on) => mutate("/api/admin/people", { action: "regStatus", id, status: on ? "confirmed" : "approved" }, true),
    }),
    [mutate],
  );

  /** The owners list, rewritten from the newest list when its turn comes, so two quick changes both land. */
  const saveOwners = useCallback(
    (build: (list: string[]) => string[]) =>
      send((latest) => ({ type: "setting", key: "lead_owners", value: build(getSetting(latest, "lead_owners")) })),
    [send],
  );

  /**
   * A DRY RUN — a destructive action asked without `confirm`: the route writes nothing and
   * answers with what is at stake, for the sheet. A plain read: no refresh. Null on any failure.
   */
  const peek = useCallback(
    async (url: string, body: unknown): Promise<unknown | null> => {
      setSendError("");
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) {
          await refresh();
          return null;
        }
        const parsed = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setSendError(parsed.error ?? "That did not reach the server.");
          return null;
        }
        return parsed;
      } catch {
        setSendError("That did not reach the server.");
        return null;
      }
    },
    [refresh],
  );

  /** SIGN OUT. Resolves once the gate is on screen (or the press failed), so the button can show it is working. */
  const lockAdmin = useCallback(async (): Promise<void> => {
    try {
      await fetch("/api/admin/unlock", { method: "DELETE" });
    } catch {
      setSendError("That did not sign you out.");
      return;
    }
    await refresh();
  }, [refresh]);

  const go = useCallback((v: View) => {
    setNavOpen(false);
    setPersonId(null);
    setPersonEdit(false);
    setOwnersOpen(false);
    setView(v);
  }, []);

  /*
   * The person drawer, and whether its editor is unfolded. A row's EDIT opens the drawer with
   * the editor already open; the drawer's own EDIT DETAILS toggles it. Closing the drawer folds
   * the editor, so the next person opens on their facts, not on a form.
   */
  const openPerson = useCallback((id: string, edit = false) => {
    setPersonId(id);
    setPersonEdit(edit);
  }, []);
  const closePerson = useCallback(() => {
    setPersonId(null);
    setPersonEdit(false);
  }, []);

  /* ON THE PUBLIC PAGE is the event's own flag, not a setting. */
  const registrationOpen = initial.event.is_public === true;
  const signups = useMemo(() => snapshot.people.filter((p) => p.regStatus !== null), [snapshot.people]);
  const regCounts = useMemo(() => {
    const confirmed = signups.filter((p) => p.regStatus === "confirmed").length;
    return {
      /** Everyone who signed up on the page. */
      registered: signups.length,
      confirmed,
      /** Signed up, not confirmed yet. */
      notConfirmed: signups.length - confirmed,
      /** Seats held: the invited roster and the confirmed. */
      seated: snapshot.people.filter((p) => holdsSeat(p.regStatus)).length,
      everyone: snapshot.people.length,
    };
  }, [snapshot.people, signups]);
  const owners = getSetting(state, "lead_owners");
  /** How many people each owner looks after, for the owners list. */
  const assigned = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of snapshot.people) if (p.lead.owner) m[p.lead.owner] = (m[p.lead.owner] ?? 0) + 1;
    return m;
  }, [snapshot.people]);

  /* The rail: before the doors (InCircle's BEFORE group), and the general page. */
  const groups: NavGroup[] = [
    {
      label: "BEFORE",
      items: [
        {
          key: "regpage",
          label: "Registration page",
          // Whether the page is up.
          count: registrationOpen ? "LIVE" : "OFF",
          tone: registrationOpen ? "live" : undefined,
          on: view === "regpage",
          go: () => go("regpage"),
        },
        {
          key: "registrations",
          label: "Registrations",
          // Sign-ups not confirmed yet: their number as a peach badge. Otherwise how many signed up.
          count: regCounts.notConfirmed ? String(regCounts.notConfirmed) : regCounts.registered ? String(regCounts.registered) : "",
          tone: regCounts.notConfirmed ? "warm" : undefined,
          on: view === "registrations",
          go: () => go("registrations"),
        },
        {
          key: "people",
          label: "Lead management",
          count: String(regCounts.everyone),
          on: view === "people",
          go: () => go("people"),
        },
      ],
    },
    {
      label: "GENERAL",
      items: [{ key: "settings", label: "Settings", count: "", on: view === "settings", go: () => go("settings") }],
    },
  ];

  const titles: Record<View, [string, string]> = {
    regpage: [
      "Registration page",
      registrationOpen
        ? `On the public page · ${regCounts.registered} signed up so far`
        : `The public page for ${initial.eventName} · not published`,
    ],
    registrations: [
      "Registrations",
      regCounts.registered
        ? `Everyone who signed up · ${regCounts.confirmed} confirmed · ${regCounts.notConfirmed} not yet`
        : "Everyone who signs up on the public page, and their four steps",
    ],
    people: ["Lead management", `Everyone who registered, and anyone you add · ${regCounts.everyone} on the list`],
    settings: ["Settings", "The event, the links, and access to this control room"],
  };
  const [viewTitle, viewSub] = titles[view];

  /* On the list, or under Lead management › Removed — a removed person's record still opens. */
  const selPerson = personId
    ? (snapshot.people.find((p) => p.id === personId) ?? snapshot.removedPeople.find((p) => p.id === personId))
    : null;

  /* The rail's WORKING ON card says whether the page is taking registrations; its foot card, how full the list is. */
  const eventState = registrationOpen
    ? { label: "Taking registrations", tone: "live" as const }
    : { label: "Registration closed", tone: "" as const };
  const roster = { seated: regCounts.seated, capacity: registrationCapacity(state), waiting: regCounts.notConfirmed };

  return (
    <AdminShell
      layout={layout}
      groups={groups}
      viewTitle={viewTitle}
      viewSub={viewSub}
      viewKicker={initial.eventName}
      viewKey={view}
      eventName={initial.eventName}
      eventDate={initial.eventDate}
      eventState={eventState}
      openEvent={() => go("settings")}
      roster={roster}
      lockAdmin={lockAdmin}
      toggleNav={() => setNavOpen((v) => !v)}
      closeNav={() => setNavOpen(false)}
    >
      {/* A write that failed says so here. It folds in and out (the kit's fold), never shoving the page. */}
      <AnimatePresence initial={false}>
        {sendError ? (
          <motion.div key="send-error" {...fold} transition={spring.smooth} style={{ overflow: "hidden" }}>
            <div className="wrn line" role="alert" style={{ marginBottom: 14 }}>
              {sendError}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {view === "regpage" && (
        <RegistrationView
          state={state}
          event={{ name: initial.event.name, startsAt: initial.event.starts_at, venue: initial.event.venue }}
          open={registrationOpen}
          publish={(on) => mutate("/api/admin/events", on ? { action: "publish", id: initial.event.id } : { action: "unpublish" })}
          send={send}
          ready
          seated={regCounts.seated}
        />
      )}

      {view === "registrations" && (
        <RegistrationsView
          signups={signups}
          seated={regCounts.seated}
          capacity={registrationCapacity(state)}
          ready
          writes={writes}
          onDecline={(id) => mutate("/api/admin/people", { action: "remove", id })}
          openPerson={openPerson}
          openRegistrationPage={() => go("regpage")}
        />
      )}

      {view === "people" && (
        <PeopleView
          layout={layout}
          snapshot={snapshot}
          owners={owners}
          openOwners={() => setOwnersOpen(true)}
          writes={writes}
          query={query}
          onQuery={setQuery}
          filter={filter}
          onFilter={setFilter}
          sort={sort}
          dir={dir}
          onSort={(col) => {
            setDir((d) => (sort === col ? -d : 1));
            setSort(col);
          }}
          openPerson={openPerson}
          lastError={sendError}
          onAdd={(p) => mutate("/api/admin/people", { action: "add", ...p })}
          onBulk={(text) => mutate("/api/admin/people", { action: "bulk", text })}
          onRemove={(id) => mutate("/api/admin/people", { action: "remove", id })}
          onRestore={() => mutate("/api/admin/people", { action: "restore" })}
          onRestoreOne={(id) => mutate("/api/admin/people", { action: "restoreOne", id })}
          onPurgeOne={async (id, confirm) =>
            (await (confirm ? mutate : peek)("/api/admin/people", { action: "purgeOne", id, confirm })) as PersonAsk | null
          }
          onPurgeAll={async (confirm) =>
            (await (confirm ? mutate : peek)("/api/admin/people", { action: "purgeAll", confirm })) as
              | (PersonAsk & { count?: number })
              | null
          }
          exportHref="/api/admin/export"
        />
      )}

      {view === "settings" && (
        <SettingsView
          event={initial.event}
          eventDate={initial.eventDate}
          isPublic={registrationOpen}
          updateEvent={(patch) => mutate("/api/admin/events", { action: "update", id: initial.event.id, ...patch })}
          openRegistrationPage={() => go("regpage")}
          lockAdmin={lockAdmin}
        />
      )}

      {/* One person, over the list — the mockup's drawer. (Escape over the owners list closes only the list.) */}
      <Drawer
        open={!!selPerson}
        onClose={() => {
          if (!ownersOpen) closePerson();
        }}
        wide
        bare
        label="Person"
      >
        {selPerson ? (
          <PersonView
            layout={{ ...layout, nar: true }}
            person={selPerson}
            editing={personEdit}
            setEditing={setPersonEdit}
            lastError={sendError}
            onEdit={(id, p) => mutate("/api/admin/people", { action: "edit", id, ...p })}
            onRemove={(id) => mutate("/api/admin/people", { action: "remove", id })}
            back={closePerson}
            owners={owners}
            openOwners={() => setOwnersOpen(true)}
            writes={writes}
          />
        ) : null}
      </Drawer>

      {/* Lead management's owners: the names every Owner drop-down offers. */}
      <OwnersSheet open={ownersOpen} onClose={() => setOwnersOpen(false)} owners={owners} assigned={assigned} onSave={saveOwners} />
    </AdminShell>
  );
}
