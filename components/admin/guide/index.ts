/**
 * The guide (components/admin/guide): hover any control to learn what it does.
 *
 * THE CONTRACT for every page of the control room: an element carries its guide in
 * `data-guide="…"`, one plain sentence on what pressing it does (`data-guide=""` keeps it quiet).
 * As a fallback, a button or a link with a `title` counts too. Optional: `data-guide-at="right"`
 * (top | bottom | right | left) on the element or around it asks for that side first.
 */
export { GuideProvider, useGuide } from "./GuideProvider";
export { GuideLayer } from "./GuideLayer";
export { GuideToggle } from "./GuideToggle";
