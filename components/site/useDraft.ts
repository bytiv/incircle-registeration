"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EventSettings } from "@/lib/settings";

/** How the draft stands: nothing to save · edits waiting · on their way · refused · the passcode cookie is gone. */
export type SaveState = "saved" | "unsaved" | "saving" | "failed" | "signedout";

type Values = Partial<Record<keyof EventSettings, unknown>>;

const stringify = (v: Values) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, JSON.stringify(x)])) as Record<string, string>;

/**
 * THE PAGE'S DRAFT — nothing the host edits reaches visitors until they press Save.
 *
 * `current` is what the page shows right now (its state); `initial` is what is stored. The two
 * are compared as JSON: while they differ the draft is `unsaved`, and the bar offers Save and
 * Discard. `save()` sends every setting that differs to /api/admin/state (the control room's own
 * writer: the row is re-read and the setting's rule applied there), one after the other, and
 * remembers what landed. A refused save stays `failed` (and says so) until Retry. `stored()`
 * gives back what is stored, for Discard to put the page back to.
 *
 * Closing the tab with something unsaved asks first; nothing is sent on its own.
 */
export function useDraft<T extends Values>(current: T, initial: T, enabled: boolean) {
  const [saved, setSaved] = useState(() => stringify(initial));
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const want = useRef(stringify(current));
  want.current = stringify(current);
  const busy = useRef(false);
  const [sending, setSending] = useState<"saving" | "failed" | "signedout" | null>(null);

  const dirty = Object.keys(want.current).some((k) => want.current[k] !== saved[k]);
  const state: SaveState = sending ?? (dirty ? "unsaved" : "saved");

  const save = useCallback(async () => {
    if (!enabled || busy.current) return false;
    busy.current = true;
    setSending("saving");
    const snapshot = { ...want.current };
    const landed = { ...savedRef.current };
    let fail: "failed" | "signedout" | null = null;
    for (const [key, json] of Object.entries(snapshot)) {
      if (json === landed[key]) continue;
      let res: Response | null = null;
      try {
        res = await fetch("/api/admin/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: `{"type":"setting","key":${JSON.stringify(key)},"value":${json}}`,
        });
      } catch {
        res = null;
      }
      if (!res?.ok) {
        fail = res?.status === 401 ? "signedout" : "failed";
        break;
      }
      landed[key] = json;
    }
    busy.current = false;
    setSaved(landed);
    setSending(fail);
    return fail === null;
  }, [enabled]);

  const stored = useCallback(() => Object.fromEntries(Object.entries(savedRef.current).map(([k, j]) => [k, JSON.parse(j)])) as T, []);

  const clear = useCallback(() => setSending(null), []);

  useEffect(() => {
    if (!enabled || !dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [enabled, dirty]);

  return { state, dirty, save, stored, clear };
}
