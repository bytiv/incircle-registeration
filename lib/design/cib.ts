/**
 * CIB's tokens for inline styles — docs/DESIGN.md §12.
 *
 * Almost everything is styled by the mockup's classes (app/cib.css,
 * app/cib-phone.css, app/cib-hall.css). Where a component still has to write
 * an inline style — a computed width, a family colour picked at runtime — it
 * takes a variable from here, never a hex, so a restyle stays one edit in
 * app/globals.css.
 */

/** The §12 custom properties, by the names the design guide uses. */
export const C = {
  blue: "var(--color-cib-blue)",
  orange: "var(--color-cib-orange)",
  ink: "var(--color-ink)",
  text2: "var(--color-text-2)",
  muted: "var(--color-muted)",
  faint: "var(--color-faint)",
  line: "var(--color-line)",
  lineSoft: "var(--color-line-soft)",
  lineStrong: "var(--color-line-strong)",
  track: "var(--color-track)",
  chip: "var(--color-chip)",
  hint: "var(--color-hint)",
  hover: "var(--color-hover)",
  sunken: "var(--color-sunken)",
  page: "var(--color-page)",
  surface: "var(--color-surface)",
  backdrop: "var(--color-backdrop)",
  scrim: "var(--color-scrim)",
  white: "var(--color-white)",
  blue50: "var(--color-blue-50)",
  blue100: "var(--color-blue-100)",
  blue200: "var(--color-blue-200)",
  blue950: "var(--color-blue-950)",
  onBlue: "var(--color-on-blue)",
  onBlue2: "var(--color-on-blue-2)",
  onBlue3: "var(--color-on-blue-3)",
  orange50: "var(--color-orange-50)",
  orange100: "var(--color-orange-100)",
  orangeLine: "var(--color-orange-line)",
  orange700: "var(--color-orange-700)",
  orange800: "var(--color-orange-800)",
  success: "var(--color-success)",
  successBg: "var(--color-success-bg)",
  win: "var(--color-win)",
  winBg: "var(--color-win-bg)",
  danger: "var(--color-danger)",
  dangerStrong: "var(--color-danger-strong)",
  dangerBg: "var(--color-danger-bg)",
  dangerLine: "var(--color-danger-line)",
  destructive: "var(--color-destructive)",
  live: "var(--color-live)",
  hall: "var(--color-hall)",
  hallSurround: "var(--color-hall-surround)",
  hallFg: "var(--color-hall-fg)",
  hallFg2: "var(--color-hall-fg-2)",
  hallKicker: "var(--color-hall-kicker)",
  hallTile: "var(--color-hall-tile)",
  hallTrack: "var(--color-hall-track)",
  hallEmpty: "var(--color-hall-empty)",
  turquoise: "var(--color-cib-turquoise)",
  melon: "var(--color-cib-melon)",
  purple: "var(--color-cib-purple)",
  olive: "var(--color-cib-olive)",
  brown: "var(--color-cib-brown)",
  mustard: "var(--color-cib-mustard)",
  lime: "var(--color-cib-lime)",
  greyDark: "var(--color-cib-grey-dark)",
} as const;

/** The six moment families' colours (the mockup's LIB6, L1026–1033). */
export const FAMILY = {
  show: "var(--color-family-show)",
  ask: "var(--color-family-ask)",
  connect: "var(--color-family-connect)",
  discuss: "var(--color-family-discuss)",
  play: "var(--color-family-play)",
  wait: "var(--color-family-wait)",
} as const;

/**
 * Avatar fallbacks, in the mockup's order (`PCL`, L2888): turquoise, melon,
 * mustard, lime, purple, orange, olive, blue — initials in white, weight 700.
 */
export const PCL = [
  "var(--color-cib-turquoise)",
  "var(--color-cib-melon)",
  "var(--color-cib-mustard)",
  "var(--color-cib-lime)",
  "var(--color-cib-purple)",
  "var(--color-cib-orange)",
  "var(--color-cib-olive)",
  "var(--color-cib-blue)",
] as const;

/**
 * A person's initials, the mockup's `INI` (L2887): the first letter of each
 * word — capped at two, because a long legal name would otherwise print four.
 */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const pick = parts.length > 2 ? [parts[0], parts[parts.length - 1]] : parts;
  return pick.map((w) => Array.from(w)[0] ?? "").join("").toUpperCase();
}

/**
 * The fallback colour for one person: stable per id, so the same face keeps
 * the same colour on the phone, the hall and in the control room.
 *
 * The mockup's list ends with CIB Blue, which vanishes on the blue hall stage
 * (its own `whoHall` has the flaw). So the blue entry is written as
 * `--face-blue`, which is CIB Blue on white and CIB Dark Grey inside any
 * `[data-surface]` (app/globals.css) — every face stays visible, automatically.
 */
export function pclFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const c = PCL[h % PCL.length];
  return c === "var(--color-cib-blue)" ? "var(--face-blue, var(--color-cib-blue))" : c;
}

/**
 * Fixed artboards. `projector` is the 1920×1080 stage ProjectorShell scales to
 * the window (DESIGN.md §6.3); `phone` is the review frame's cap on a desktop
 * (§5.16); `phone.width`/`height` are the screen the control-room previews draw
 * at before scaling (390×844, §6.2).
 */
export const FRAME = {
  projector: { width: 1920, height: 1080 },
  phone: { maxWidth: 430, maxHeight: 860, width: 390, height: 844 },
} as const;

/** The smallest touch target, in px (DESIGN.md §6.2). A rule, not a style. */
export const TOUCH_MIN = 44;
