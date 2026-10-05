/**
 * LEAD MANAGEMENT — what the team records about a person beyond what they registered with
 * (InCircle-One-System.html, "Registration & Lead Management"):
 *
 *   steps   Registrations' contact steps: MESSAGE · CALL · CALENDAR. The fourth, CONFIRMED, is
 *           not stored here: it is the seat itself, `reg_status = 'confirmed'` (lib/registration.ts)
 *   cats    Lead management's categories — a person can hold several
 *   owner   who on the team looks after them, from the `lead_owners` list (lib/settings.ts)
 *   next    the next action, in a few words
 *
 * Stored on the seat, as `attendees.profile.lead`. `profile` is CIB's own jsonb, which CIB fills
 * with other keys (dept, lang …) and always MERGES into (CIB's app/api/moment/route.ts), so this
 * needs no table change and CIB's SQL can still run on this database. Every key of the profile
 * other than `lead` is kept exactly as it was (`withLead`).
 *
 * Pure, so the route (app/api/admin/people, `lead`), the snapshot (lib/queries/admin.ts) and the
 * views all read and write it the same way; leads.test.ts holds them to it.
 */

export const STEP_KEYS = ["message", "call", "calendar"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export const STEP_LABEL: Record<StepKey, string> = { message: "Message", call: "Call", calendar: "Calendar" };

export const LEAD_CATS = ["potential_client", "current_client", "potential_collab", "potential_speaker"] as const;
export type LeadCat = (typeof LEAD_CATS)[number];
export const LEAD_CAT_LABEL: Record<LeadCat, string> = {
  potential_client: "Potential client",
  current_client: "Current client",
  potential_collab: "Potential collaboration",
  potential_speaker: "Potential speaker",
};

export type Lead = {
  steps: Record<StepKey, boolean>;
  cats: LeadCat[];
  /** A name from the owners list, or null: unassigned. */
  owner: string | null;
  /** "" when there is none. */
  next: string;
};

export const OWNER_MAX = 40;
export const OWNERS_MAX = 50;
export const NEXT_MAX = 200;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** One line of text: whitespace runs made one space, trimmed, capped. Anything not a string is "". */
const clean = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export const isStepKey = (v: unknown): v is StepKey => typeof v === "string" && (STEP_KEYS as readonly string[]).includes(v);
export const isLeadCat = (v: unknown): v is LeadCat => typeof v === "string" && (LEAD_CATS as readonly string[]).includes(v);

/** A person's lead as stored — anything missing or malformed reads as not done, none, unassigned. */
export function leadOf(profile: unknown): Lead {
  const raw = isObj(profile) && isObj(profile.lead) ? profile.lead : {};
  const steps = isObj(raw.steps) ? raw.steps : {};
  const cats = Array.isArray(raw.cats) ? raw.cats : [];
  return {
    steps: { message: steps.message === true, call: steps.call === true, calendar: steps.calendar === true },
    // In the categories' own order, each once.
    cats: LEAD_CATS.filter((c) => cats.includes(c)),
    owner: clean(raw.owner, OWNER_MAX) || null,
    next: clean(raw.next, NEXT_MAX),
  };
}

/**
 * ONE CHANGE to a lead, as the views send it. Each carries the value it SETS, never "flip it", so
 * a change sent twice lands the same way once.
 */
export type LeadPatch =
  | { kind: "step"; key: StepKey; on: boolean }
  | { kind: "cat"; key: LeadCat; on: boolean }
  | { kind: "owner"; value: string | null }
  | { kind: "next"; value: string };

/** A patch from a request body, checked and cleaned; null when it is not one. */
export function cleanLeadPatch(v: unknown): LeadPatch | null {
  if (!isObj(v)) return null;
  switch (v.kind) {
    case "step":
      return isStepKey(v.key) && typeof v.on === "boolean" ? { kind: "step", key: v.key, on: v.on } : null;
    case "cat":
      return isLeadCat(v.key) && typeof v.on === "boolean" ? { kind: "cat", key: v.key, on: v.on } : null;
    case "owner":
      return v.value === null || typeof v.value === "string" ? { kind: "owner", value: clean(v.value, OWNER_MAX) || null } : null;
    case "next":
      return v.value === null || typeof v.value === "string" ? { kind: "next", value: clean(v.value, NEXT_MAX) } : null;
    default:
      return null;
  }
}

/** The lead with the one change made. */
export function applyLead(lead: Lead, patch: LeadPatch): Lead {
  switch (patch.kind) {
    case "step":
      return { ...lead, steps: { ...lead.steps, [patch.key]: patch.on } };
    case "cat":
      return { ...lead, cats: LEAD_CATS.filter((c) => (c === patch.key ? patch.on : lead.cats.includes(c))) };
    case "owner":
      return { ...lead, owner: patch.value };
    case "next":
      return { ...lead, next: patch.value };
  }
}

/** Two leads that say the same thing. */
export const sameLead = (a: Lead, b: Lead) => JSON.stringify(a) === JSON.stringify(b);

/** The profile with this lead written into it — every other key (the form's choice, CIB's) as it was. */
export function withLead(profile: unknown, lead: Lead): Obj {
  const base = isObj(profile) ? profile : {};
  return { ...base, lead: { steps: { ...lead.steps }, cats: [...lead.cats], owner: lead.owner, next: lead.next } };
}

/**
 * A record as the text of a filter (`profile=eq.<this>`), for the route's conditional write:
 * JSON with every space and plus written as a \u escape. Postgres reads it as the same jsonb, and a
 * URL cannot read it two ways (a "+" in a query string may be taken for a space).
 */
export const profileFilter = (profile: unknown): string =>
  JSON.stringify(profile ?? {}).replace(/ /g, "\\u0020").replace(/\+/g, "\\u002b");

/**
 * THE OWNERS LIST — the `lead_owners` setting's rule: names cleaned, empty ones and repeats (in
 * any case) dropped, in the order given, at most OWNERS_MAX. Undefined for a value that is not a
 * list at all (getSetting then reads the default, an empty list).
 */
export function cleanOwners(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    const name = clean(item, OWNER_MAX);
    if (name && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
    if (out.length >= OWNERS_MAX) break;
  }
  return out;
}
