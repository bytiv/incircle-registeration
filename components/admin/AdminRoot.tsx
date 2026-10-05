"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { AdminShell, type Layout, type NavGroup } from "@/components/admin/AdminShell";
import { PeopleView } from "@/components/admin/PeopleView";
import { PersonView } from "@/components/admin/PersonView";
import { RegistrationView } from "@/components/admin/RegistrationView";
import { SettingsView } from "@/components/admin/SettingsView";
import { Drawer } from "@/components/admin/ui";
import type { FlowAction } from "@/lib/admin/flow";
import type { PersonAsk } from "@/lib/admin/runs";
import { useAdminEventState, type Press, type RoomAnswer } from "@/lib/admin/useAdminEventState";
import { fold, spring } from "@/lib/motion";
import { oneAtATime } from "@/lib/roomSync";
import { holdsSeat, registrationCapacity, type RegStatus } from "@/lib/registration";
import type { AdminShellData } from "@/lib/queries/admin";

/**
 * The control room. Everything below the passcode.
 *
 * CIB's control room, cut to registration: the rail's PRE EVENT pages —
 * Registration page (the public page, edited where it shows, and the sign-ups
 * waiting for you) and People (everyone who is coming) — and Settings. CIB's
 * Manage events, Build, Run and Results are the event app, which InCircle gets
 * when it moves to CIB's platform.
 *
 * Settings go out through /api/admin/state, the only thing allowed to write
 * them; the list changes through /api/admin/people. The view is client state,
 * mirrored into the URL (`?v=…`) so a reload lands where the host was.
 */

type View = "regpage" | "people" | "settings";

const VIEWS: View[] = ["regpage", "people", "settings"];

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
  const [navOpen, setNavOpen] = useState(false);
  /** Writes in flight, each until its refreshed render has landed. */
  const [writing, setWriting] = useState(0);
  const [sendError, setSendError] = useState("");

  // The People table's own state.
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
   * People and the editors change rows the server rendered, so the page is re-fetched rather
   * than patched locally — one source of truth. Resolves with the body once the refreshed render
   * has landed (so nothing comes back showing the old data), null on any failure.
   */
  const mutate = useCallback(
    async (url: string, body: unknown): Promise<unknown | null> => {
      setWriting((n) => n + 1);
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
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          setSendError(b.error ?? "That did not save.");
          return null;
        }
        const parsed = (await res.json().catch(() => ({}))) as unknown;
        await refresh();
        return parsed;
      } catch {
        setSendError("That did not save.");
        return null;
      } finally {
        setWriting((n) => n - 1);
      }
    },
    [refresh],
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
  const regCounts = useMemo(() => {
    const ppl = snapshot.people;
    const seated = ppl.filter((p) => holdsSeat(p.regStatus));
    return {
      registered: ppl.filter((p) => p.regStatus !== null).length,
      seated: seated.length,
      invited: seated.filter((p) => p.regStatus === null).length,
      waiting: ppl.filter((p) => p.regStatus === "new").length,
      queue: ppl.length - seated.length,
    };
  }, [snapshot.people]);

  /* The rail: before the doors (InCircle's BEFORE group), and the general page. */
  const groups: NavGroup[] = [
    {
      label: "BEFORE",
      items: [
        {
          key: "regpage",
          label: "Registration page",
          // Sign-ups waiting: their number as a peach badge. Otherwise whether the page is up.
          count: regCounts.queue ? String(regCounts.queue) : registrationOpen ? "LIVE" : "OFF",
          tone: regCounts.queue ? "warm" : registrationOpen ? "live" : undefined,
          on: view === "regpage",
          go: () => go("regpage"),
        },
        {
          key: "people",
          label: "People",
          count: String(regCounts.seated),
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
        ? `On the public page · ${regCounts.queue} waiting for you · ${regCounts.registered} signed up so far`
        : regCounts.queue
          ? `Not published · ${regCounts.queue} still waiting for you`
          : `The public page for ${initial.eventName} · not published`,
    ],
    people: ["People", `Everyone who is coming · ${regCounts.seated} on the list`],
    settings: ["Settings", "The event, the links, and access to this control room"],
  };
  const [viewTitle, viewSub] = titles[view];

  /* On the list, or under People › Removed — a removed person's record still opens. */
  const selPerson = personId
    ? (snapshot.people.find((p) => p.id === personId) ?? snapshot.removedPeople.find((p) => p.id === personId))
    : null;

  /* The rail's WORKING ON card says whether the page is taking registrations; its foot card, how full the list is. */
  const eventState = registrationOpen
    ? { label: "Taking registrations", tone: "live" as const }
    : { label: "Registration closed", tone: "" as const };
  const roster = { seated: regCounts.seated, capacity: registrationCapacity(state), waiting: regCounts.queue };

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
          counts={regCounts}
          queue={snapshot.people.filter((p) => !holdsSeat(p.regStatus))}
          onRegStatus={(id, status: RegStatus | null) => mutate("/api/admin/people", { action: "regStatus", id, status })}
          onDecline={(id) => mutate("/api/admin/people", { action: "remove", id })}
          openPerson={openPerson}
        />
      )}

      {view === "people" && (
        <PeopleView
          layout={layout}
          snapshot={snapshot}
          state={state}
          waiting={regCounts.queue}
          openRegistrationPage={() => go("regpage")}
          onRegStatus={(id, status: RegStatus | null) => mutate("/api/admin/people", { action: "regStatus", id, status })}
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

      {/* One person, over the list — the mockup's drawer. */}
      <Drawer open={!!selPerson} onClose={closePerson} wide bare label="Person">
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
          />
        ) : null}
      </Drawer>
    </AdminShell>
  );
}
