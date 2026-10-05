import type { CSSProperties } from "react";

import { cx } from "@/components/ui/cx";

/**
 * InCircle's marks, drawn in CSS the way InCircle draws them (its register page's `.rg-borb`,
 * its rail's `.logo .o`, its wordmark) — so they are sharp at any size and breathe. The styles
 * are in app/incircle.css (`.ic-orb`, `.ic-logo-orb`, `.ic-wm`).
 */

/** The glass orb with colour swirling inside it — the hero of the public page and the passcode door. */
export function Orb({ size, className, style }: { size: number; className?: string; style?: CSSProperties }) {
  return (
    <div className={cx("ic-orb", className)} style={{ width: size, ...style }} aria-hidden>
      <div className="sh" />
      <div className="core">
        <div className="pa" />
        <div className="pb" />
        <div className="pc" />
      </div>
      <div className="sp" />
    </div>
  );
}

/** The small breathing orb beside the name — the rail's logo. */
export function LogoOrb({ size = 36, glow }: { size?: number; glow?: boolean }) {
  return (
    <span className={cx("ic-logo-orb", glow && "glow")} style={{ width: size, height: size }} aria-hidden>
      <i />
    </span>
  );
}

/** "InCircle", set in Gilroy ExtraBold — the wordmark over every public page. */
export function Wordmark({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={cx("ic-wm", className)} style={style}>
      InCircle
    </div>
  );
}

/** The sign-off at the foot of a page: INCIRCLE BY DOTMENT. */
export function ByDotment({ className }: { className?: string }) {
  return <div className={cx("ic-by", className)}>INCIRCLE BY DOTMENT</div>;
}
