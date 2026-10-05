"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { LIST_MAX, type SitePhoto } from "@/lib/sitePage";

import { Chevron, Close } from "./icons";
import { uploadSitePicture } from "./upload";

/** The strip's height on a desktop (CSS `.st-shot`), for the size each photo is served at. */
const SHOT_H = 440;

/**
 * MOMENTS FROM THE CIRCLE — the album.
 *
 * For visitors: one strip of photos, each at its own shape and all one height, starting in line
 * with the page and running off its right edge — swiped on a phone; on a laptop grabbed with the
 * mouse and slid (it glides on, then settles on a photo), or stepped with the two arrows beside
 * the heading. Every photo opens full screen with a click (Lightbox: arrows, ←/→, swipe, Esc).
 * Each is served at the size its screen needs (next/image).
 *
 * In edit mode: every photo as a tile with its number and its controls (move it earlier or later,
 * take it out), dragged into place on a desktop, and one tile to add photos — chosen from the
 * computer or phone, or dropped on it, several at once; each is made web-sized and kept in
 * Supabase Storage (components/site/upload.ts).
 */
export function Album({
  heading,
  photos,
  editing,
  onChange,
  onRemove,
}: {
  heading: ReactNode;
  photos: SitePhoto[];
  editing: boolean;
  onChange: (next: SitePhoto[] | ((prev: SitePhoto[]) => SitePhoto[])) => void;
  /** Takes the photo at `index` out (the page offers it back); without it, the album does it itself. */
  onRemove?: (index: number) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);

  if (editing) {
    return (
      <div className="st-wrap">
        <div className="st-album-head">{heading}</div>
        <AlbumEditor photos={photos} onChange={onChange} onRemove={onRemove} />
      </div>
    );
  }
  if (!photos.length) return null;
  return (
    <>
      <Filmstrip heading={heading} photos={photos} onOpen={setOpen} />
      {open !== null ? <Lightbox photos={photos} start={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/** The heading with its two arrows, and the strip. */
function Filmstrip({ heading, photos, onOpen }: { heading: ReactNode; photos: SitePhoto[]; onOpen: (i: number) => void }) {
  const track = useRef<HTMLDivElement | null>(null);
  const [ends, setEnds] = useState({ start: true, end: false });

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      const next = { start: el.scrollLeft <= 4, end: el.scrollLeft >= max - 4 };
      setEnds((cur) => (cur.start === next.start && cur.end === next.end ? cur : next));
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [photos.length]);

  const step = (dir: -1 | 1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.75), behavior: "smooth" });
  };

  const grab = useGrab(track);

  return (
    <>
      <div className="st-wrap st-album-head st-reveal">
        {heading}
        <div className="st-arrows">
          <button type="button" className="st-arrow" onClick={() => step(-1)} disabled={ends.start} aria-label="Earlier photos">
            <Chevron dir="left" />
          </button>
          <button type="button" className="st-arrow" onClick={() => step(1)} disabled={ends.end} aria-label="More photos">
            <Chevron dir="right" />
          </button>
        </div>
      </div>
      <div
        ref={track}
        className={cx("st-track st-reveal", grab.grabbing && "is-grabbing")}
        role="list"
        aria-label="Photos"
        onPointerDown={grab.onPointerDown}
        onPointerMove={grab.onPointerMove}
        onPointerUp={grab.onPointerUp}
        onPointerCancel={grab.onPointerUp}
        onClickCapture={grab.onClickCapture}
        onDragStart={(e) => e.preventDefault()}
      >
        {photos.map((p, i) => {
          const ratio = p.w / p.h;
          return (
            <button
              key={`${p.src}-${i}`}
              type="button"
              role="listitem"
              className="st-shot"
              style={{ aspectRatio: `${p.w} / ${p.h}` }}
              onClick={() => onOpen(i)}
              aria-label={`Open photo ${i + 1} of ${photos.length}`}
            >
              <Image
                src={p.src}
                alt={p.alt || `InCircle community gathering ${i + 1}`}
                fill
                sizes={`(max-width: 760px) 86vw, ${Math.round(SHOT_H * ratio)}px`}
                loading={i < 3 ? "eager" : "lazy"}
                draggable={false}
              />
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * THE STRIP, GRABBED WITH A MOUSE — a phone swipes it natively; on a laptop it is held and slid.
 * Past a few pixels a press becomes a drag (the strip follows the pointer, snapping is paused so
 * the two never fight); let go and it glides on with the drag's speed and settles on the nearest
 * photo, where snapping comes back without a jump. A press that never moved is a click: the photo
 * opens. A drag's own click is swallowed, so letting go over a photo never opens it.
 */
function useGrab(track: React.RefObject<HTMLDivElement | null>) {
  const [grabbing, setGrabbing] = useState(false);
  const held = useRef<{ id: number; x: number; left: number; moved: boolean; trail: { t: number; x: number }[] } | null>(null);
  const swallow = useRef(false);
  const settle = useRef<(() => void) | null>(null);

  useEffect(() => () => settle.current?.(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = track.current;
    if (!el || e.pointerType !== "mouse" || e.button !== 0) return;
    settle.current?.();
    held.current = { id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false, trail: [{ t: e.timeStamp, x: e.clientX }] };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = track.current;
    const h = held.current;
    if (!el || !h || e.pointerId !== h.id) return;
    const dx = e.clientX - h.x;
    if (!h.moved) {
      if (Math.abs(dx) < 6) return;
      h.moved = true;
      el.setPointerCapture(e.pointerId);
      setGrabbing(true);
    }
    el.scrollLeft = h.left - dx;
    h.trail.push({ t: e.timeStamp, x: e.clientX });
    if (h.trail.length > 6) h.trail.shift();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = track.current;
    const h = held.current;
    held.current = null;
    if (!el || !h || e.pointerId !== h.id || !h.moved) return;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    // The click this release makes is the drag's, not a press on a photo.
    swallow.current = true;
    setTimeout(() => (swallow.current = false), 0);

    // Glide on with the drag's speed (px/ms over its last moments), then settle on a photo.
    const recent = h.trail.filter((p) => e.timeStamp - p.t < 120);
    const a = recent[0] ?? h.trail[0];
    const b = recent[recent.length - 1] ?? h.trail[h.trail.length - 1];
    const speed = (b.x - a.x) / Math.max(16, b.t - a.t);
    const aim = el.scrollLeft - speed * 280;
    const pad = parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0;
    const base = el.getBoundingClientRect().left - el.scrollLeft;
    const max = el.scrollWidth - el.clientWidth;
    let target = aim;
    let best = Infinity;
    el.querySelectorAll<HTMLElement>(".st-shot").forEach((shot) => {
      const at = Math.min(max, Math.max(0, shot.getBoundingClientRect().left - base - pad));
      if (Math.abs(at - aim) < best) {
        best = Math.abs(at - aim);
        target = at;
      }
    });
    el.scrollTo({ left: target, behavior: "smooth" });

    // Snapping comes back once the glide has landed (on a snap point, so nothing jumps).
    const done = () => {
      clearTimeout(timer);
      el.removeEventListener("scrollend", done);
      settle.current = null;
      setGrabbing(false);
    };
    const timer = setTimeout(done, 900);
    el.addEventListener("scrollend", done);
    settle.current = done;
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (!swallow.current) return;
    swallow.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return { grabbing, onPointerDown, onPointerMove, onPointerUp, onClickCapture };
}

/** One photo at a time, as large as the screen allows. */
function Lightbox({ photos, start, onClose }: { photos: SitePhoto[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [closing, setClosing] = useState(false);
  const n = photos.length;
  // It fades away rather than vanishing.
  const close = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 200);
  }, [onClose]);
  const go = useCallback((by: number) => setI((v) => (v + by + n) % n), [n]);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const was = html.style.overflow;
    html.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      html.style.overflow = was;
    };
  }, [go, close]);

  // The next and the previous photo, fetched before they are asked for.
  useEffect(() => {
    for (const k of [1, -1]) {
      const img = new window.Image();
      img.src = photos[(i + k + n) % n].src;
    }
  }, [i, n, photos]);

  const p = photos[i];
  return (
    <div
      className={cx("st-lb", closing && "is-closing")}
      role="dialog"
      aria-modal="true"
      aria-label="Photos"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onPointerDown={(e) => {
        touch.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t) return;
        const dx = e.clientX - t.x;
        const dy = e.clientY - t.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- the original, at full size, on demand */}
      <img key={p.src} src={p.src} alt={p.alt || `InCircle community gathering ${i + 1}`} draggable={false} />
      <button ref={closeRef} type="button" className="st-lb-btn st-lb-close" onClick={close} aria-label="Close">
        <Close />
      </button>
      {n > 1 ? (
        <>
          <button type="button" className="st-lb-btn st-lb-prev" onClick={() => go(-1)} aria-label="Previous photo">
            <Chevron dir="left" />
          </button>
          <button type="button" className="st-lb-btn st-lb-next" onClick={() => go(1)} aria-label="Next photo">
            <Chevron dir="right" />
          </button>
        </>
      ) : null}
      <div className="st-lb-count" aria-live="polite">
        {i + 1} / {n}
      </div>
    </div>
  );
}

/** The album in edit mode. */
function AlbumEditor({
  photos,
  onChange,
  onRemove,
}: {
  photos: SitePhoto[];
  onChange: (next: SitePhoto[] | ((prev: SitePhoto[]) => SitePhoto[])) => void;
  onRemove?: (index: number) => void;
}) {
  const file = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState("");
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const room = LIST_MAX.photos - photos.length;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    onChange((prev) => {
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };
  const remove = (i: number) => (onRemove ? onRemove(i) : onChange((prev) => prev.filter((_, k) => k !== i)));

  const add = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (!pics.length) return;
    setError("");
    setUploading((n) => n + pics.length);
    // One after another, each added as soon as it is stored, in the order they were chosen.
    for (const f of pics) {
      try {
        const up = await uploadSitePicture(f, "album");
        onChange((prev) => [...prev, up]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "A photo did not upload.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  return (
    <>
      <div className="st-albumedit">
        {photos.map((p, i) => (
          <div
            key={`${p.src}-${i}`}
            className={cx("st-tile", dragFrom === i && "drag", dragOver === i && dragFrom !== i && "over")}
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              setDragOver(i);
            }}
            onDragLeave={() => setDragOver((v) => (v === i ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) move(dragFrom, i);
              setDragFrom(null);
              setDragOver(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDragOver(null);
            }}
          >
            <Image src={p.src} alt="" fill sizes="220px" draggable={false} />
            <span className="st-tile-n">{i + 1}</span>
            <div className="st-tile-acts">
              <span className="grp">
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move photo ${i + 1} earlier`}>
                  <Chevron dir="left" className="ico" />
                </button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === photos.length - 1} aria-label={`Move photo ${i + 1} later`}>
                  <Chevron dir="right" className="ico" />
                </button>
              </span>
              <button type="button" className="warm" onClick={() => remove(i)} aria-label={`Take photo ${i + 1} out of the album`}>
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className={cx("st-addtile", uploading > 0 && "busy", dropping && "drop")}
          onClick={() => file.current?.click()}
          disabled={room <= 0}
          onDragOver={(e) => {
            if (dragFrom !== null || !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(e) => {
            if (dragFrom !== null) return;
            e.preventDefault();
            setDropping(false);
            void add([...e.dataTransfer.files]);
          }}
        >
          <b>{uploading > 0 ? "…" : "+"}</b>
          {uploading > 0 ? `Uploading ${uploading}…` : room > 0 ? "Add photos" : "The album is full"}
          <small>{room > 0 ? "Choose several, or drop them here" : `${LIST_MAX.photos} photos at most`}</small>
        </button>
      </div>
      {error ? (
        <p className="st-error" role="alert">
          {error}
        </p>
      ) : null}
      <input
        ref={file}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const list = [...(e.target.files ?? [])];
          e.target.value = "";
          void add(list);
        }}
      />
    </>
  );
}
