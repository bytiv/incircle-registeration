"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * THE GUIDE — "enable the guide, or don't" (Belal, 2026-09-30): for somebody new to the control
 * room, hovering any control says in one sentence what pressing it does. One switch per viewer,
 * off by default, kept in this browser only (localStorage), never on the server.
 *
 * The contract every page writes to: an element carries its guide in `data-guide="…"` (one plain
 * sentence on what pressing it does; `data-guide=""` silences it). As a fallback, a button or a
 * link with a `title` counts too. GuideLayer (one per control room, mounted by AdminShell) reads
 * them; GuideToggle is the switch (the page header and Settings).
 */

const KEY = "cib.guide";

/** Storage can throw (a private window, blocked site data) or come back empty: off, then. */
function readStored(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

function writeStored(on: boolean) {
  try {
    if (on) window.localStorage.setItem(KEY, "on");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* the switch still works for this visit */
  }
}

type GuideState = {
  /** The guide is on for this viewer. */
  on: boolean;
  /** The stored value has been read and painted: switches may animate from here on. */
  ready: boolean;
  setOn: (on: boolean) => void;
};

const GuideContext = createContext<GuideState>({ on: false, ready: true, setOn: () => undefined });

export function useGuide(): GuideState {
  return useContext(GuideContext);
}

export function GuideProvider({ children }: { children: ReactNode }) {
  /* Off on the server and on the first paint, so the page hydrates as it was rendered. */
  const [on, setOnState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setOnState(readStored());
    /* Two frames: the stored state is painted before the switch is allowed to glide. */
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true));
    });
    /* Another tab of the control room flipped it: follow. */
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY || e.key === null) setOnState(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setOn = useCallback((next: boolean) => {
    setOnState(next);
    writeStored(next);
  }, []);

  const value = useMemo(() => ({ on, ready, setOn }), [on, ready, setOn]);
  return <GuideContext.Provider value={value}>{children}</GuideContext.Provider>;
}
