"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { BRAND, faceBucketUrl } from "@/lib/photos";
import type { AttendeeFaceRow } from "@/lib/supabase/types";

/**
 * Face photos, fetched before the screen that shows them exists.
 *
 * Three things were making the bubbles land empty and fill in afterwards:
 *
 *  1. Every face <img> was `loading="lazy"`. P1's strip is ~1800px wide and
 *     P2/P12's field is ~2000px tall, so the browser deliberately fetched only
 *     the handful in view and left the rest for when you scrolled — and a screen
 *     that hasn't mounted yet fetches nothing at all.
 *  2. Each photo resolves a two-host chain (Supabase `faces` bucket, then the
 *     legacy host). While the bucket files are missing that means every single
 *     face pays a full 404 round trip *before* its real download starts.
 *  3. That resolution was redone from scratch on every mount of every screen,
 *     and again after every reload.
 *
 * So: warm all 50 the moment the app opens (they are small, and every
 * face-bearing screen shows the same 50 people, which makes "one screen ahead"
 * and "all of them" the same job), remember which host answered, and hand that
 * URL straight to the <img> so it never repeats the doomed request.
 *
 * Two layers of cache, deliberately:
 *  - the browser HTTP cache does the actual byte-level caching, which is what it
 *    is for — nothing here re-implements it;
 *  - localStorage remembers only *which URL won*, so a reload skips the probe.
 *    A bounded window of decoded bitmaps is held in `held` (see HELD_MAX) so a
 *    screen mounting straight after the warm does not immediately re-decode;
 *    everything on screen is held by its own <img>, which is the DOM's job.
 */

export type FaceLike = Pick<AttendeeFaceRow, "id" | "photo_path" | "slug" | "role">;

/**
 * The candidate chain, bucket first — the order the screens have always used.
 *
 * An empty `photo_path` returns NO candidates at all, which is the difference
 * between an empty glass shell and a broken one: a synthesised URL for a
 * person we have no photo for would be in the server HTML from the first
 * painted frame, render an <img> with a dead src and `alt={full_name}` — the
 * person's NAME typed inside the ring — until the 404 came back, and cost one
 * doomed request per photo-less face per phone on venue wifi.
 *
 * Returning [] makes useFaceSrc hand back src=null, so FacePhoto/FaceBubble
 * render no <img> at all and the shell reads as the designed "no photo yet".
 *
 * This is sound because `photo_path` is authoritative — set if and only if the
 * object exists in the `faces` bucket (see lib/photos.ts). The bucket is the
 * one candidate today; the chain stays a list so a second source can follow it.
 */
export function faceSources(face: FaceLike): string[] {
  if (!face.photo_path?.trim()) return [];
  return [faceBucketUrl(face)].filter((s): s is string => Boolean(s));
}

/**
 * How long a remembered URL is trusted across reloads.
 *
 * Long enough to cover an event day from setup to the last handshake, short
 * enough that uploading the bucket files the night before is picked up by
 * phones that opened the app earlier.
 */
const TTL_MS = 12 * 60 * 60 * 1000;
const STORE_KEY = "cib.faces.v1";

/** face id -> the URL that actually decoded (or was remembered as having done). */
const winners = new Map<string, string>();
/**
 * Face ids that have resolved successfully. Ids only — a few hundred short
 * strings — so it can safely be complete, and it is what "already warmed, do
 * not fetch again" is asked of below.
 */
const resolved = new Set<string>();
/**
 * The decoded bitmaps still being held, most recently resolved last.
 *
 * This used to be an unbounded `Map<string, HTMLImageElement>` that nothing ever
 * deleted from, and it is what killed the tab. `photo-fill` caps a face at
 * 512x512 (scripts/photo-fill.mjs:124), so one decoded face is 512*512*4 =
 * 1 MiB of RGBA; warmFaces() is called with the whole roster (~117 people) from
 * SIX places — AttendeeApp plus five projector boards that stay open all night —
 * so the tab was pinning ~117 MiB of bitmap that nothing on screen was using.
 *
 * A detached Image is also the WORST place to hold one: it has no layout box,
 * so it can only ever be held at full 512x512, where the same photo inside an
 * 82px bubble in the DOM can be decoded down to the size it is drawn at.
 *
 * So the ceiling is HELD_MAX and eviction is by resolution order. What is on
 * screen keeps its own bitmap alive through its <img> — that is the DOM's job,
 * and it does it better. What is left here is only a cushion for the handful
 * that resolved last, which are the ones a just-mounted screen is most likely
 * still painting.
 */
const held = new Map<string, HTMLImageElement>();
/** The ceiling, in decoded faces. 8 x 1 MiB = 8 MiB, whatever the roster is. */
const HELD_MAX = 8;

function hold(id: string, img: HTMLImageElement): void {
  held.delete(id);
  held.set(id, img);
  // Map iterates in insertion order, so the first key is the oldest hold.
  while (held.size > HELD_MAX) {
    const oldest = held.keys().next().value;
    if (oldest === undefined) break;
    held.delete(oldest);
  }
}
/** face id -> [chain head at the time, URL that won]. Survives a reload. */
const memo = new Map<string, [head: string, won: string]>();
/** In-flight resolutions, so two screens never race the same face. */
const inflight = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

/*
 * There was a `bucketAlive` hint here: three consecutive bucket misses latched
 * "the bucket is empty" for the life of the tab and stripped the bucket URL
 * from every remaining face.
 *
 * Its premise — "either the 50 .webp files are uploaded or they are not, so one
 * answer covers the whole room" — is no longer true, and holding onto it was
 * actively dangerous. photo_path is now authoritative (set if and only if the
 * object exists), so a bucket URL is only ever built for a file we believe is
 * there, and faceSources() returns nothing at all for people with no photo.
 * Meanwhile load() resolves null on ANY failure — a 400, a timeout, one wifi
 * hiccup on a venue network — so three unlucky faces could demote all 46 real
 * photos to a legacy host that no longer holds most of them, blanking people
 * for the rest of the tab with no way back short of a reload.
 *
 * One misplaced request is cheaper than that, so the chain is simply tried in
 * order now.
 */

/* ------------------------------------------------------------------ store */

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

let notifyQueued = false;
/**
 * Coalesced to one flush per frame. useSyncExternalStore re-reads each
 * subscriber's snapshot and bails on an unchanged value, so a flush only
 * re-renders the faces that actually resolved.
 */
function notify(): void {
  if (notifyQueued) return;
  notifyQueued = true;
  const flush = () => {
    notifyQueued = false;
    for (const listener of listeners) listener();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush);
  else queueMicrotask(flush);
}

/* ------------------------------------------------------- reload-persistence */

type Persisted = { t: number; m: Record<string, [string, string]> };

let hydrated = false;
function hydrate(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Persisted | null;
    if (!parsed || typeof parsed.t !== "number" || Date.now() - parsed.t > TTL_MS) {
      window.localStorage.removeItem(STORE_KEY);
      return;
    }
    for (const [id, pair] of Object.entries(parsed.m ?? {})) {
      if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string") {
        memo.set(id, [pair[0], pair[1]]);
      }
    }
  } catch {
    // Private mode, a full quota, or a corrupt entry. Everything below still
    // works, it just re-resolves — never worth failing the app over.
  }
}

let persistQueued = false;
function schedulePersist(): void {
  if (persistQueued || typeof window === "undefined") return;
  persistQueued = true;
  setTimeout(() => {
    persistQueued = false;
    try {
      const m: Persisted["m"] = {};
      for (const [id, pair] of memo) m[id] = pair;
      window.localStorage.setItem(STORE_KEY, JSON.stringify({ t: Date.now(), m }));
    } catch {
      /* see hydrate() */
    }
  }, 500);
}

/* ----------------------------------------------------------------- loading */

type PrioritisedImage = HTMLImageElement & { fetchPriority?: string };

function load(url: string, priority: "low" | "high"): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img: PrioritisedImage = new Image();
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    // Warming must never take bandwidth from the screen the attendee is on.
    if ("fetchPriority" in img) img.fetchPriority = priority;
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function resolveFace(face: FaceLike): Promise<string | null> {
  // `resolved`, not `held` — a face evicted from the bounded window above is
  // still resolved, and re-fetching it would turn eviction into a fetch loop.
  if (resolved.has(face.id)) return winners.get(face.id) ?? null;
  const existing = inflight.get(face.id);
  if (existing) return existing;

  const run = (async (): Promise<string | null> => {
    const chain = faceSources(face);
    const head = chain[0];

    // Try the URL that won last time first — on a reload that is a cache hit
    // and the loop ends there.
    const remembered = memo.get(face.id);
    let candidates = chain;
    if (remembered && remembered[0] === head && chain.includes(remembered[1])) {
      candidates = [remembered[1], ...candidates.filter((u) => u !== remembered[1])];
    }

    for (const url of candidates) {
      const img = await load(url, "low");
      if (img) {
        winners.set(face.id, url);
        resolved.add(face.id);
        hold(face.id, img);
        if (head) memo.set(face.id, [head, url]);
        schedulePersist();
        notify();
        return url;
      }
    }

    // Nothing answered. Drop any optimistic guess so the shell reads as the
    // designed "no photo yet" gap rather than a URL that will never load.
    if (winners.delete(face.id)) notify();
    memo.delete(face.id);
    schedulePersist();
    return null;
  })();

  inflight.set(face.id, run);
  void run.finally(() => inflight.delete(face.id));
  return run;
}

/** Called by a screen when the URL it was handed turned out to be dead. */
function forget(faceId: string, url: string): void {
  if (winners.get(faceId) !== url) return;
  winners.delete(faceId);
  resolved.delete(faceId);
  held.delete(faceId);
  memo.delete(faceId);
  schedulePersist();
  notify();
}

/* -------------------------------------------------------------- public API */

/**
 * Fetch every face in the background.
 *
 * Idempotent and safe to call from more than one screen — a face already loaded
 * or already in flight is skipped. `concurrency` is small on purpose: 50 parallel
 * requests over venue wifi is slower than six at a time, not faster.
 */
export function warmFaces(faces: FaceLike[], concurrency = 6): void {
  if (typeof window === "undefined") return;
  hydrate();

  /*
   * Publish what a previous load already proved BEFORE a single request goes
   * out. This is the bit that stops a reload showing empty shells: the first
   * render after mount already has each face's known-good URL, so there is no
   * probe, no 404, and no fill-in.
   *
   * Optimistic — the loop below still verifies each one, and the <img>'s own
   * onError un-remembers anything that has since gone away.
   */
  let adopted = false;
  for (const face of faces) {
    if (winners.has(face.id)) continue;
    const remembered = memo.get(face.id);
    if (remembered && remembered[0] === faceSources(face)[0]) {
      winners.set(face.id, remembered[1]);
      adopted = true;
    }
  }
  if (adopted) notify();

  const queue = faces.filter((f) => !resolved.has(f.id) && !inflight.has(f.id));
  if (queue.length === 0) return;

  let next = 0;
  for (let worker = 0; worker < Math.min(concurrency, queue.length); worker++) {
    void (async () => {
      while (next < queue.length) await resolveFace(queue[next++]);
    })();
  }
}

const brandHeld: HTMLImageElement[] = [];
const brandWarmed = new Set<string>();

/** The local brand files (the CIB logos, lib/photos.ts), fetched once before any screen needs them. */
export function warmBrand(): void {
  if (typeof window === "undefined") return;
  for (const url of Object.values(BRAND)) {
    if (brandWarmed.has(url)) continue;
    brandWarmed.add(url);
    void load(url, "high").then((img) => {
      if (img) brandHeld.push(img);
    });
  }
}

const NO_FAILURES: readonly string[] = [];

/**
 * The URL a face should render right now, plus the error handler that walks the
 * chain if it turns out to be dead.
 *
 * Returns null once every candidate has failed — an empty glass shell reads as
 * "no photo yet", which is right, where a broken-image glyph reads as a bug.
 */
export function useFaceSrc(face: FaceLike): { src: string | null; onError: () => void } {
  const sources = useMemo(() => faceSources(face), [face]);

  /*
   * getServerSnapshot is always null, so the server HTML and the first client
   * render agree on `sources[0]` no matter what the warmer already knows. React
   * re-reads the real snapshot immediately after hydration.
   */
  const warm = useSyncExternalStore(
    subscribe,
    () => winners.get(face.id) ?? null,
    () => null,
  );

  const [dead, setDead] = useState<readonly string[]>(NO_FAILURES);
  const chain = warm ? [warm, ...sources.filter((s) => s !== warm)] : sources;
  const src = chain.find((s) => !dead.includes(s)) ?? null;

  const onError = useCallback(() => {
    if (!src) return;
    forget(face.id, src);
    setDead((d) => (d.includes(src) ? d : [...d, src]));
  }, [face.id, src]);

  return { src, onError };
}
