/**
 * THE FIELDS THE REGISTRATION FORM CAN CARRY — keys only, and no imports, so the settings
 * (lib/settings.ts), the page's content (lib/sitePage.ts) and the registration helpers
 * (lib/registration.ts) can all read them without importing each other.
 *
 * Which of them the form shows, and in what order, is the `reg_fields` setting. Their words
 * (label, placeholder) and whether each is required live in the page's content, edited on the
 * page itself.
 */
export const REG_FIELD_KEYS = ["name", "title", "phone", "email", "linkedin", "company", "photo", "attendee"] as const;

export type RegFieldKey = (typeof REG_FIELD_KEYS)[number];

/** The key of a sign-up: always on the form, always required. */
export const LOCKED_FIELDS: readonly RegFieldKey[] = ["name", "email"];

/**
 * incircle.community's form, in its order, with the photo the face wall needs. The first-time /
 * attended-before choice is off (Belal, 2026-10-05: "remove this"); it stays under "+ Add a field"
 * in edit mode.
 */
export const DEFAULT_FIELD_ORDER: RegFieldKey[] = ["name", "title", "phone", "email", "linkedin", "photo"];

export const isRegFieldKey = (v: unknown): v is RegFieldKey =>
  typeof v === "string" && (REG_FIELD_KEYS as readonly string[]).includes(v);
