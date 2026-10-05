"use client";

import { useEffect, useRef, useState } from "react";

import { FaceOrb } from "@/components/ui/FacePhoto";
import { pclFor } from "@/lib/design/cib";
import { roleFraming, type FaceFraming } from "@/lib/faceFraming";
import type { AttendeeFaceRow, AttendeeRole } from "@/lib/supabase/types";

/**
 * Align a person's photo inside their round face, and see it while you do.
 *
 * Asked for by Belal (2026-08-21): "the picture on the profiles, we should be
 * able to align it ourselves like on edit or when we are adding it new, so like
 * we can see how it will look". Since 2026-09-29 it is the middle of the person
 * form (components/admin/people/PersonForm.tsx): one circle, centred, that you
 * drag; four small nudges on its edge; a zoom slider under it. With no photo
 * the circle is the way to add one.
 *
 * THE PREVIEW IS THE REAL COMPONENT. The stage renders <FaceOrb/> — the same
 * round face every phone and hall screen draws — with the framing being
 * dragged passed in as a prop, so objectFit, the bottom-anchored
 * transformOrigin and the role base are not reproduced here, they are the same
 * code. transformOrigin in particular is not the CSS default: scale grows the
 * photo UPWARD from the bottom edge, and zoom and pan interact.
 */

/** The stage, in px, when the caller does not say. Also the drag denominator: one full sweep = the full range. */
const STAGE = 156;

/**
 * A stand-in id whose palette colour is `tint`.
 *
 * FaceOrb paints the circle from its row's id (pclFor), and the room paints a
 * person's circle in THEIR colour — which shows through a cut-out photo. The
 * row cannot carry the person's real id (see stageRow), so it carries an id
 * that hashes to the same colour instead.
 */
function stageIdFor(tint: string | undefined): string {
  if (!tint) return "aligner";
  for (let k = 0; k < 96; k += 1) if (pclFor(`aligner-${k}`) === tint) return `aligner-${k}`;
  return "aligner";
}

/**
 * A row that exists only to feed <FaceOrb/>.
 *
 * `photo_path` MUST stay blank and the id must not be a real person's:
 * lib/faceCache's faceSources() returns [] for a blank path, and its warm store
 * is keyed by id, so this row never enters the winners / held / memo maps or
 * the `cib.faces.v1` localStorage store. The picture arrives through
 * srcOverride instead — which is also why the aligner works for any image URL,
 * where a canvas-based cropper could not read a cross-origin byte back.
 */
function stageRow(role: AttendeeRole, id: string): AttendeeFaceRow {
  return {
    id,
    event_id: "",
    full_name: "",
    slug: "",
    title: null,
    role,
    photo_path: null,
    bubble_left: null,
    bubble_top: null,
    photo_x: null,
    photo_y: null,
    photo_zoom: null,
  };
}

/** A camera, drawn: the empty circle's "add a photo". */
function Camera() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.4-2h6.2l1.4 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

export function PhotoAligner({
  src,
  framing,
  role,
  onChange,
  onReset,
  initials,
  tint,
  onPick,
  size = STAGE,
}: {
  /** An already-resolved URL or data URL. Null means there is nothing to align. */
  src: string | null;
  framing: FaceFraming;
  /** Drives the role base, so flipping HOST/MEMBER re-frames the preview live. */
  role: AttendeeRole;
  onChange: (f: FaceFraming) => void;
  /** Back to the role default — which is stored as null, not as 50/50/1. */
  onReset: () => void;
  /** The letters the empty circle shows. */
  initials?: string;
  /** The person's own colour (pclFor of their id), so a cut-out sits on what the room shows. */
  tint?: string;
  /** Tapping the empty circle picks a photo. */
  onPick?: () => void;
  size?: number;
}) {
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const base = roleFraming(role);
  const isDefault = !framing.aligned || (framing.x === base.x && framing.y === base.y && framing.zoom === 1);

  /*
   * Probe the URL before the face ever renders it.
   *
   * FacePhoto's own onError belongs to lib/faceCache's two-host chain, and a
   * srcOverride is outside that chain — so a URL that 404s would paint a broken
   * image glyph inside the circle, which reads as "the aligner is broken" rather
   * than "there is no photo". This is also the honest answer for anyone whose
   * photo_path is empty: the admin row optimistically tries a legacy URL for
   * them, and here we find out whether it actually exists before offering a
   * control that pretends it does.
   */
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!src) {
      setOk(null);
      return;
    }
    let live = true;
    setOk(null);
    const probe = new Image();
    probe.referrerPolicy = "no-referrer";
    probe.onload = () => live && setOk(true);
    probe.onerror = () => live && setOk(false);
    probe.src = src;
    return () => {
      live = false;
    };
  }, [src]);

  const shown = !!src && ok === true;

  if (!shown) {
    const failed = !!src && ok === false;
    const loading = !!src && ok === null;
    const face = (
      <>
        {initials ? <b>{initials}</b> : <Camera />}
        {onPick && !loading ? <span>{failed ? "Choose another" : "+ Add a photo"}</span> : null}
      </>
    );
    return (
      <div className="ppl-photo">
        <div className="ppl-stage" style={{ width: size, height: size }}>
          {onPick ? (
            <button type="button" className="ppl-blank" onClick={onPick} aria-label="Add a photo">
              {face}
            </button>
          ) : (
            <div className="ppl-blank">{face}</div>
          )}
        </div>
        {failed ? <div className="ppl-err">That photo did not load.</div> : null}
      </div>
    );
  }

  const clamp = (n: number) => Math.min(100, Math.max(0, n));

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, fx: framing.x, fy: framing.y };
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    /*
     * A drag ALWAYS moves the photo — the aligned model is `contain` plus a
     * plain translate (lib/faceFraming.ts), so there is no shape or zoom at
     * which panning is a no-op. One full sweep of the stage covers the whole
     * ±half-frame range. Negative on purpose: x toward 100 slides the photo
     * left, so dragging right must decrease x.
     */
    onChange({
      ...framing,
      aligned: true,
      x: clamp(d.fx - ((e.clientX - d.x) / size) * 100),
      y: clamp(d.fy - ((e.clientY - d.y) / size) * 100),
    });
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  /** One arrow tap: move the photo this far, in x/y units (100 = a full frame). */
  const NUDGE = 5;
  const nudge = (dx: number, dy: number) =>
    onChange({
      ...framing,
      aligned: true,
      // The same inversion as the drag: moving the photo RIGHT means showing
      // more of its LEFT, which is x going DOWN.
      x: clamp(framing.x - dx),
      y: clamp(framing.y - dy),
    });

  /** The four nudge buttons pinned to the face's edges. */
  const arrow = (glyph: string, label: string, dx: number, dy: number, pos: React.CSSProperties) => (
    <button
      type="button"
      className="ppl-nudge"
      aria-label={label}
      onClick={() => nudge(dx, dy)}
      // A tap on an arrow must not also start a drag on the stage beneath it.
      onPointerDown={(e) => e.stopPropagation()}
      style={pos}
    >
      {glyph}
    </button>
  );

  return (
    <div className="ppl-photo">
      <div
        className="ppl-stage ok"
        title="Drag to line up their face"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        /*
         * Kill the browser's native image drag. Without this, grabbing the
         * photo starts an HTML drag-and-drop of the <img> — a floating
         * silhouette follows the cursor and the pointermove stream stops, so
         * the face itself never moves. Prevented here on the stage (dragstart
         * bubbles), so the pointer handlers above are the only drag there is.
         */
        onDragStart={(e) => e.preventDefault()}
        style={{ width: size, height: size }}
      >
        <FaceOrb face={stageRow(role, stageIdFor(tint))} srcOverride={src} framing={framing} />
        {/* One tap = one small step, for fingers and trackpads that hate dragging. */}
        {arrow("‹", "Move photo left", -NUDGE, 0, { left: -13, top: "50%", marginTop: -13 })}
        {arrow("›", "Move photo right", NUDGE, 0, { right: -13, top: "50%", marginTop: -13 })}
        {arrow("˄", "Move photo up", 0, -NUDGE, { top: -13, left: "50%", marginLeft: -13 })}
        {arrow("˅", "Move photo down", 0, NUDGE, { bottom: -13, left: "50%", marginLeft: -13 })}
      </div>

      <div className="ppl-zoom">
        <span className="z" aria-hidden>
          −
        </span>
        {/*
         * A slider, not a scroll-wheel handler. This sits in a drawer that
         * scrolls, and a wheel listener here would steal the scroll from a host
         * trying to get past it during a live event.
         */}
        <input
          type="range"
          min={0.5}
          max={3}
          step={0.02}
          value={framing.zoom}
          aria-label="Zoom"
          onChange={(e) => onChange({ ...framing, zoom: Number(e.target.value), aligned: true })}
        />
        <span className="z" aria-hidden>
          +
        </span>
        <button type="button" className="back flat blue ppl-recentre" onClick={onReset} disabled={isDefault} title="Back to how the room frames them by default">
          Recentre
        </button>
      </div>
    </div>
  );
}
