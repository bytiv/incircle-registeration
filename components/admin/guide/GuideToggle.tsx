"use client";

import "./guide.css";

import { cx, Toggle } from "@/components/admin/ui";

import { useGuide } from "./GuideProvider";

/**
 * The guide's switch — the kit's own Toggle, so it looks and moves like every other switch here.
 *
 *   <GuideToggle />       the page header's small caps "GUIDE" (AdminShell, the .hd's right side)
 *   <GuideToggle row />   the Settings row's "Guide on / Guide off"
 *
 * Its title is the one hint that shows with the guide off (the browser's own tip); with the guide
 * on, the guide says it.
 */
export function GuideToggle({ row }: { row?: boolean }) {
  const { on, ready, setOn } = useGuide();
  return (
    <span className={cx("guide-tg", row ? "row" : "hd-tg", ready && "is-ready")} data-guide-switch="">
      <Toggle
        on={on}
        caps={!row}
        onClick={() => setOn(!on)}
        label={row ? (on ? "Guide on" : "Guide off") : "GUIDE"}
        title={on ? "Turns the guide off." : "Turns on the guide: hover any control to see what it does."}
      />
    </span>
  );
}
