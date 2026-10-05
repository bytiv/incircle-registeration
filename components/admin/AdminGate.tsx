"use client";

import "./gate.css";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cx } from "@/components/ui/cx";
import { ByDotment, LogoOrb } from "@/components/ui/InCircleBrand";
import { SETTLE_EASING, spring } from "@/lib/motion";

/**
 * The passcode gate — InCircle's (incircle-application components/admin/AdminGate.tsx): on its
 * light gradient and two slow blobs, one frosted card: the breathing orb with its glow, "InCircle
 * Admin", one line, the passcode field (large, spaced digits), the ramp's UNLOCK, and INCIRCLE BY
 * DOTMENT. Its finish is in ./gate.css.
 *
 * The positioning contract is unchanged: app/admin/page.tsx renders this
 * INSTEAD of the control room, so the rail and the page never reach a locked
 * browser; the gate covers its own full-height box.
 *
 * THE PRESS ANSWERS (Belal, 2026-09-30: "we click once and the button becomes
 * unclicked again, then we try to click it again"). The check is the server's
 * (/api/admin/unlock sets the `cib_admin` cookie), and the door says what it is
 * doing the whole time:
 * - from the press, a small ring turns where the button's word was (same width,
 *   same blue), the digits hold, and a second press or Enter does nothing;
 * - a wrong passcode: the field shakes, its digits clear, the focus goes back
 *   to it, and one plain line says so;
 * - the right one: the ring settles into a tick, and the tick HOLDS until the
 *   refreshed page has actually landed (router.refresh inside a transition), so
 *   a slow network never shows the idle button again. Then the door eases out
 *   while the control room rises in (the shell's .pagein) — see `leaveCopy`;
 * - a request that fails says so plainly, and the button reads "Try again".
 *
 * The field takes digits only, eight at most, on a numeric keypad — the
 * passcode is a number.
 */

/** The shared timings (lib/motion.ts): a face crossing, a fold, a door easing out. */
const SNAPPY_MS = spring.snappy.visualDuration * 1000;
const SMOOTH_MS = spring.smooth.visualDuration * 1000;

/**
 * idle      the field is open, the button says Unlock (or Try again)
 * checking  the server is reading the passcode
 * wrong     the refusal's first beat: the digits shake, then clear
 * in        the server said yes; the control room is on its way
 */
type Phase = "idle" | "checking" | "wrong" | "in";

/** The button's faces, in the order a press moves through them: the word, the ring, the tick. */
const FACE: Record<Phase, number> = { idle: 0, wrong: 0, checking: 1, in: 2 };

/**
 * THE DOOR EASES OUT WHILE THE ROOM EASES IN. The page swaps the gate for the
 * control room in a single commit, so the gate cannot animate itself away. As
 * it unmounts (its DOM still in place, nothing painted yet) it leaves a still
 * copy of itself over the room; the copy fades and lifts 6px away (the mirror
 * of the room's rise) in the smooth spring's time, then goes. With reduced
 * motion it only fades, briefly (docs/DESIGN.md §9).
 */
function leaveCopy(door: HTMLElement) {
  const copy = door.cloneNode(true) as HTMLElement;
  copy.classList.add("gate-copy");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  copy.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  // A picture of the door: it keeps the dots, never the digits.
  copy.querySelectorAll("input").forEach((i) => {
    const dots = "•".repeat(i.value.length);
    i.removeAttribute("value");
    i.value = dots;
  });
  document.body.appendChild(copy);

  const gone = () => copy.remove();
  // Should the animation never report back (a throttled tab), the copy still goes.
  window.setTimeout(gone, 4000);
  try {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ms = reduce ? 150 : SMOOTH_MS;
    const timing: KeyframeAnimationOptions = { duration: ms, easing: SETTLE_EASING, fill: "forwards" };
    const fade = copy.animate([{ opacity: 1 }, { opacity: 0 }], timing);
    if (!reduce) copy.querySelector(".card")?.animate([{ transform: "none" }, { transform: "translateY(-6px)" }], timing);
    fade.finished.then(gone, gone);
  } catch {
    // This runs inside React's commit: an entrance that cannot play must never stop the room arriving.
    gone();
  }
}

export function AdminGate() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  /** The last passcode was refused: the field's border says so until the next digit. */
  const [invalid, setInvalid] = useState(false);
  const [shaking, setShaking] = useState(false);
  /** The last request failed (not a wrong passcode): the button offers to try again. */
  const [retry, setRetry] = useState(false);
  /** The one line under the field. Its text stays while it folds away. */
  const [note, setNote] = useState({ text: "", open: false });
  /** True from router.refresh() until the refreshed page has landed. */
  const [opening, startOpening] = useTransition();

  const door = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  /** A press is being answered (or the door is opening): another press does nothing. */
  const busy = useRef(false);
  /** The server said yes: the next unmount is the door opening. */
  const entering = useRef(false);
  const wasOpening = useRef(false);

  // The field takes focus as soon as it exists.
  useEffect(() => {
    const el = field.current;
    if (el && document.activeElement !== el) {
      requestAnimationFrame(() => {
        try {
          el.focus({ preventScroll: true });
        } catch {
          /* focus is a nicety, never a failure */
        }
      });
    }
  }, []);

  // Unmounting after a yes is the door opening (leaveCopy). Strict Mode's rehearsal unmount, and
  // any other, leaves nothing behind.
  useLayoutEffect(() => {
    const el = door.current;
    return () => {
      if (entering.current && el) leaveCopy(el);
    };
  }, []);

  const fail = useCallback((text: string) => {
    busy.current = false;
    setPhase("idle");
    setRetry(true);
    setNote({ text, open: true });
  }, []);

  // The refreshed page landed and it is still the door (the cookie did not take): say so.
  useEffect(() => {
    if (opening) {
      wasOpening.current = true;
      return;
    }
    if (!wasOpening.current) return;
    wasOpening.current = false;
    entering.current = false;
    fail("The control room did not open.");
  }, [opening, fail]);

  function refuse() {
    setPhase("wrong");
    setInvalid(true);
    setRetry(false);
    setShaking(true);
    setNote({ text: "That passcode is not right.", open: true });
    window.setTimeout(() => setShaking(false), SMOOTH_MS);
    // The digits shake, then clear, and the field is ready for the first one again.
    window.setTimeout(() => {
      setPw("");
      setPhase("idle");
      busy.current = false;
      field.current?.focus({ preventScroll: true });
    }, SNAPPY_MS);
  }

  async function unlock() {
    if (busy.current) return;
    busy.current = true;
    setPhase("checking");
    setInvalid(false);
    setShaking(false);
    setNote((n) => (n.open ? { ...n, open: false } : n));

    let res: Response;
    try {
      res = await fetch("/api/admin/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: pw }),
      });
    } catch {
      fail("Could not reach the server.");
      return;
    }
    if (res.ok) {
      // Yes. The tick holds (and presses stay ignored) until the control room has landed.
      entering.current = true;
      setPhase("in");
      startOpening(() => router.refresh());
      return;
    }
    if (res.status === 401) {
      refuse();
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    fail(body.error ?? "Could not reach the server.");
  }

  const at = FACE[phase];
  /** Where a face is: shown, gone by (it waits above), or still to come (below). */
  const face = (i: number) => (i === at ? "now" : i < at ? "past" : "next");
  const held = phase === "checking" || phase === "in";
  const status =
    phase === "checking"
      ? "Checking the passcode"
      : phase === "in"
        ? "Unlocked. Opening the control room."
        : note.open
          ? note.text
          : "";

  return (
    <div ref={door} className="gate" lang="en" dir="ltr" data-phase={phase}>
      <div className="gate-blobs" aria-hidden>
        <i className="b1" />
        <i className="b2" />
      </div>
      <div className="gate-stage">
        <form
          className="card pagein"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <LogoOrb size={62} glow />
          <h1 className="gate-t">InCircle Admin</h1>
          <p className="gate-s">Host access only. Enter the passcode to open the control room.</p>

          <div className={cx("gate-fieldwrap", shaking && "gate-shake")}>
            <input
              id="gate-passcode"
              ref={field}
              className="fld"
              value={pw}
              onChange={(e) => {
                // Digits only, eight at most.
                setPw(e.target.value.replace(/\D/g, "").slice(0, 8));
                if (invalid) {
                  setInvalid(false);
                  setNote((n) => ({ ...n, open: false }));
                }
              }}
              readOnly={phase !== "idle"}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              placeholder="••••••"
              aria-label="Passcode"
              aria-invalid={invalid || undefined}
              aria-describedby={note.open ? "gate-note" : undefined}
            />
          </div>

          <div className={cx("gate-note", note.open && "on")} aria-hidden={!note.open || undefined}>
            <div>
              <div id="gate-note" className="gate-msg">
                {note.text}
              </div>
            </div>
          </div>

          <button type="submit" className="btn gate-go" aria-busy={held || undefined}>
            <span className="gate-face" data-at={face(0)}>
              {retry ? "TRY AGAIN" : "UNLOCK"}
            </span>
            <span className="gate-face" data-at={face(1)} aria-hidden>
              <span className="gate-ring" />
            </span>
            <span className="gate-face" data-at={face(2)} aria-hidden>
              <svg className="gate-tick" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 9.5l3.2 3.2L14 5.6" />
              </svg>
            </span>
          </button>
          <ByDotment className="gate-by" />
          <span className="sr-only" role="status">
            {status}
          </span>
        </form>
      </div>
    </div>
  );
}
