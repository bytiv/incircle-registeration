import { cleanOwners } from "@/lib/leads";
import { DEFAULT_FIELD_ORDER, isRegFieldKey, LOCKED_FIELDS, type RegFieldKey } from "@/lib/regFields";
import { DEFAULT_PAGE, normalizePage, type SitePage } from "@/lib/sitePage";

/**
 * Event-level settings — the registration page's knobs.
 *
 * The values live in `event_state.settings` (jsonb). The write path is
 * /api/admin/state: an admin control sends `{type:"setting", key, value}`, the
 * route looks the key up in SETTING_RULES and merges the CLAMPED value — so
 * validation is server-true no matter what a client sends, and an unknown key
 * is a no-op. Readers go through getSetting(), which re-validates and fills in
 * SETTINGS_DEFAULTS, so a missing or hand-mangled key can never surface as
 * `undefined` in a component.
 *
 * This is CIB's lib/settings.ts with only the registration keys kept: the
 * agenda, recap, rounds, waiting screens and drafts belong to the event app,
 * which InCircle gets later. `reg_approve`, `reg_capacity` and `reg_fields` are
 * CIB's own; the page's words and pictures are InCircle's `reg_page` (its
 * website, edited on the page itself — lib/sitePage.ts).
 */

export type EventSettings = {
  /*
   * THE REGISTRATION PAGE — the public page at /, its rules set from the
   * control room's Registration page and its words on the page itself. Settings rather than a table because every one of these
   * is one event-level knob, and riding event_state means an edit reaches the
   * public page on its next request. lib/registration.ts is the vocabulary both
   * sides read them through. WHETHER the page is published is not here: it is
   * `events.is_public`, one event at a time across the whole database.
   */
  /** New sign-ups land as "New" and wait for approval; off, they land as "Approved". */
  reg_approve?: boolean;
  /**
   * How many seats the evening has — the registration seat count
   * (lib/registration.ts registrationCapacity). 0 = no limit: the page never
   * reads as full.
   */
  reg_capacity?: number;
  /** Which fields the form shows, in the form's order — lib/regFields.ts; name and email are always on. */
  reg_fields?: string[];
  /**
   * THE PAGE ITSELF — every word, picture and photo of the public page (lib/sitePage.ts),
   * edited on the page by a signed-in host. One value: a page is saved whole.
   */
  reg_page?: SitePage;
  /**
   * LEAD MANAGEMENT'S OWNERS — the names every Owner drop-down offers (lib/leads.ts), edited
   * from Lead management's OWNERS. InCircle's own key, not CIB's.
   */
  lead_owners?: string[];
};

export const SETTINGS_DEFAULTS: Required<EventSettings> = {
  // The registration page ships closed, asking for approval, with
  // incircle.community's words, pictures and form.
  reg_approve: true,
  reg_capacity: 0,
  reg_fields: DEFAULT_FIELD_ORDER,
  reg_page: DEFAULT_PAGE,
  // Nobody yet: the team writes its own list.
  lead_owners: [],
};

/** Returns the normalized value, or undefined when the input is unusable. */
type SettingRule = (value: unknown) => EventSettings[keyof EventSettings] | undefined;

const intBetween =
  (min: number, max: number): SettingRule =>
  (value) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.round(value)))
      : undefined;

const bool: SettingRule = (value) => (typeof value === "boolean" ? value : undefined);

/**
 * The registration form's field list — lib/regFields.ts's keys. ITS ORDER IS
 * THE FORM'S ORDER (the host drags the fields into it), so it is kept as
 * given: unknown keys and repeats dropped, nothing re-sorted. Name and email
 * are put back, first, if a client dropped them: they are the key, and a form
 * without them registers nobody.
 */
const regFieldList: SettingRule = (value) => {
  if (!Array.isArray(value)) return undefined;
  const out: RegFieldKey[] = [];
  for (const v of value) if (isRegFieldKey(v) && !out.includes(v)) out.push(v);
  return [...LOCKED_FIELDS.filter((k) => !out.includes(k)), ...out];
};

/**
 * The server-side clamp, one rule per key. Ranges are wide on purpose — they
 * exist to keep a typo from breaking the page (a negative seat count, a
 * runaway list), not to encode opinions the admin controls already hold.
 */
export const SETTING_RULES: Record<keyof EventSettings, SettingRule> = {
  reg_approve: bool,
  reg_capacity: intBetween(0, 10000),
  reg_fields: regFieldList,
  reg_page: normalizePage,
  lead_owners: cleanOwners,
};

/**
 * The way settings are read. Never index `state.settings` directly — this
 * fills in the default for a missing key AND re-validates what is there, so a
 * database that predates the key (or a hand-edited row) reads as the default
 * rather than as undefined.
 */
export function getSetting<K extends keyof EventSettings>(
  state: { settings?: EventSettings | null } | null | undefined,
  key: K,
): Required<EventSettings>[K] {
  const raw = state?.settings?.[key];
  const checked = raw === undefined || raw === null ? undefined : SETTING_RULES[key](raw);
  return (checked ?? SETTINGS_DEFAULTS[key]) as Required<EventSettings>[K];
}
