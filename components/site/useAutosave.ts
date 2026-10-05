"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EventSettings } from "@/lib/settings";

/** How a setting stands: stored · on its way · refused (a retry is offered) · the passcode cookie is gone. */
export type SaveState = "saved" | "saving" | "failed" | "signedout";

/** The worst of several, for the one dot the bar shows. */
export function worst(...states: SaveState[]): SaveState {
  for (const s of ["signedout", "failed", "saving"] as const) if (states.includes(s)) return s;
  return "saved";
}

/**
 * ONE SETTING THAT SAVES ITSELF — what the page's edit mode writes through.
 *
 * `push(value)` says what the setting should now be. After `delay` ms without another push the
 * value goes to /api/admin/state (the control room's own writer: the row is re-read and the
 * setting's rule applied there, conditional on its seq). One save is in flight at a time; a push
 * made meanwhile is saved right after it, so the last edit always lands last. A value equal to
 * what is stored sends nothing.
 *
 * A refused save stays refused (and says so) until `flush()` — the bar's Retry — or the next edit,
 * or the browser coming back online. Closing the tab with something unsaved asks first.
 */
export function useAutosave<K extends keyof EventSettings>(key: K, initial: unknown, delay: number, enabled: boolean) {
  const saved = useRef(JSON.stringify(initial));
  const want = useRef(saved.current);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<SaveState>("saved");

  const pump = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (busy.current) return;
    while (want.current !== saved.current) {
      const json = want.current;
      busy.current = true;
      setState("saving");
      let res: Response | null = null;
      try {
        res = await fetch("/api/admin/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: `{"type":"setting","key":${JSON.stringify(key)},"value":${json}}`,
          // Small enough to outlive the tab: a save made as it closes still lands.
          keepalive: json.length < 60_000,
        });
      } catch {
        res = null;
      }
      busy.current = false;
      if (!res?.ok) {
        setState(res?.status === 401 ? "signedout" : "failed");
        return;
      }
      saved.current = json;
    }
    setState("saved");
  }, [key]);

  const push = useCallback(
    (value: unknown) => {
      if (!enabled) return;
      want.current = JSON.stringify(value);
      if (timer.current) clearTimeout(timer.current);
      if (want.current === saved.current) {
        timer.current = null;
        if (!busy.current) setState("saved");
        return;
      }
      setState("saving");
      timer.current = setTimeout(() => void pump(), delay);
    },
    [delay, enabled, pump],
  );

  const flush = useCallback(() => void pump(), [pump]);
  const dirty = useCallback(() => busy.current || want.current !== saved.current, []);

  useEffect(() => {
    if (!enabled) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!dirty()) return;
      void pump();
      e.preventDefault();
      e.returnValue = "";
    };
    const onHide = () => {
      if (document.visibilityState === "hidden" && dirty()) void pump();
    };
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [enabled, dirty, flush, pump]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { state, push, flush, dirty };
}
