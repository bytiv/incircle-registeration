import type { AdminPerson, AdminSnapshot } from "@/lib/admin/model";
import { EVENT_TZ } from "@/lib/env";
import { ATTENDEE_LABEL, REG_STATUS_LABEL } from "@/lib/registration";

/**
 * EXPORT CSV — People's EXPORT button (/api/admin/export): everyone on the
 * list, the sign-ups still waiting included, with what they registered with.
 *
 * CIB's lib/admin/exportCsv.ts builds the same kind of file around the night:
 * check-in, the last screen, a column group per moment. Before the event there
 * is only the list, so the sheet is the list's columns, always the same ones.
 *
 * Blank cells mean "not on record". Every cell is quoted, inner quotes doubled.
 */

type Cell = string | number;

/** How a person's cell for one column is read. Blank = nothing on record. */
type Column = { head: string; cell: (p: AdminPerson) => Cell };

/** "2026-10-05 14:30" in the event's timezone — a spreadsheet sorts it as written. */
function stamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: EVENT_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  } catch {
    return d.toISOString();
  }
}

export const COLUMNS: Column[] = [
  { head: "Name", cell: (p) => p.name },
  { head: "Title", cell: (p) => p.rawTitle ?? "" },
  { head: "Company", cell: (p) => p.company ?? "" },
  { head: "Email", cell: (p) => p.regEmail ?? "" },
  { head: "Phone", cell: (p) => p.phone ?? "" },
  { head: "LinkedIn", cell: (p) => p.li },
  { head: "Role", cell: (p) => (p.isTeam ? "Host team" : "Member") },
  { head: "Registration status", cell: (p) => (p.regStatus ? REG_STATUS_LABEL[p.regStatus] : "Added by host") },
  { head: "Attendee", cell: (p) => (p.attendee ? ATTENDEE_LABEL[p.attendee] : "") },
  { head: "Registered", cell: (p) => stamp(p.registeredAt) },
  { head: "Code", cell: (p) => p.code ?? "" },
];

/**
 * A cell a spreadsheet would run as a formula — anything a stranger typed into the public form
 * that starts with =, +, -, @, a tab or a return — is kept as text with a leading apostrophe
 * (OWASP's CSV-injection rule). A phone number like "+20 10 …" stays readable as it was typed.
 */
function safe(value: Cell): string {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function exportCsv(snapshot: AdminSnapshot): string {
  const rows: Cell[][] = [COLUMNS.map((c) => c.head)];
  for (const p of snapshot.people) rows.push(COLUMNS.map((c) => c.cell(p)));
  return rows.map((r) => r.map((c) => '"' + safe(c).replace(/"/g, '""') + '"').join(",")).join("\n");
}
