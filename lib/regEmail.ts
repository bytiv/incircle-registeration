/**
 * THE WELCOME EMAIL — what a person is sent the moment they register (app/api/register), its
 * words written in the control room's Settings (WELCOME EMAIL) and kept in the `reg_email`
 * setting (lib/settings.ts). lib/email.ts sends it through Resend.
 *
 * The host writes plain text: a blank line starts a new paragraph, a link becomes clickable, and
 * {first_name}, {name} and {event} are filled in for each person. Nothing else is read as code,
 * so a name like "<b>Sara</b>" arrives as those exact characters.
 *
 * Pure, so the route and Settings read it the same way; regEmail.test.ts holds them to it.
 */

export type RegEmail = {
  /** Send it at all. Off, nobody is emailed; the words are kept. */
  on: boolean;
  subject: string;
  body: string;
};

export const REG_EMAIL_SUBJECT_MAX = 150;
export const REG_EMAIL_BODY_MAX = 5000;

/** The fill-ins, as the host types them. */
export const REG_EMAIL_FILLS = ["{first_name}", "{name}", "{event}"] as const;

/*
 * On from the start: the sign-up route only sends once Resend's keys are in the environment
 * (lib/email.ts). The words are Marina's note for the 3rd InCircle (IC Strategy Lab, 27 October),
 * as the team wrote it: a call to come, never a confirmed seat, so neither the approval rule nor a
 * full room can make it untrue. The next event's words are written in Settings.
 */
export const DEFAULT_REG_EMAIL: RegEmail = {
  on: true,
  subject: "Welcome to InCircle, {first_name}",
  body:
    "Hi {first_name},\n\n" +
    "This is Marina, Marketing & Community Manager at DOTMENT.\n" +
    "Thank you for registering to join InCircle Community and for your interest in our upcoming 3rd InCircle — IC Strategy Lab on 27 October.\n\n" +
    "I’d love to personally connect with you before the Circle. You can expect a quick call from me soon to share more about InCircle, answer any questions you may have, and walk you through the next steps.\n\n" +
    "I’ll be calling you from +20 11 31087978, so you’ll know it’s me when I reach out.\n\n" +
    "Looking forward to connecting soon,\n" +
    "Marina",
};

const oneLine = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const text = (s: string, max: number) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);

/** The `reg_email` setting's rule: undefined when unusable, every missing part from the default. */
export function normalizeRegEmail(v: unknown): RegEmail | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  return {
    on: typeof o.on === "boolean" ? o.on : DEFAULT_REG_EMAIL.on,
    subject: typeof o.subject === "string" ? oneLine(o.subject, REG_EMAIL_SUBJECT_MAX) : DEFAULT_REG_EMAIL.subject,
    body: typeof o.body === "string" ? text(o.body, REG_EMAIL_BODY_MAX) : DEFAULT_REG_EMAIL.body,
  };
}

export type RegEmailWho = { name: string; event: string };

/** {first_name}, {name} and {event}, filled in. An unknown {word} is left as typed. */
export function fillRegEmail(s: string, who: RegEmailWho): string {
  const name = who.name.trim();
  const fills: Record<string, string> = {
    first_name: name.split(/\s+/)[0] ?? "",
    name,
    event: who.event.trim(),
  };
  return s.replace(/\{(first_name|name|event)\}/g, (_, k: string) => fills[k]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Links in already-escaped text; a full stop or bracket right after one is not part of it. */
const linkify = (s: string) =>
  s.replace(/\bhttps?:\/\/[^\s<]*[^\s<.,;:!?)\]]/g, (url) => `<a href="${url}" style="color:#1A1A1A;text-decoration:underline">${url}</a>`);

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

/**
 * The message for one person: its subject, the plain text, and the HTML — one calm white card on
 * a pale ground, InCircle's ink, and the words (a mail client cannot load Gilroy, so the system
 * face). `logo` is an absolute https address of the wordmark; without one the card is words only.
 */
export function renderRegEmail(email: RegEmail, who: RegEmailWho, opts: { logo?: string } = {}) {
  const subject = oneLine(fillRegEmail(email.subject || DEFAULT_REG_EMAIL.subject, who), REG_EMAIL_SUBJECT_MAX);
  const body = fillRegEmail(email.body || DEFAULT_REG_EMAIL.body, who);
  const paras = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const logo = opts.logo
    ? `<img src="${esc(opts.logo)}" width="78" alt="InCircle" style="display:block;border:0;height:auto;margin:0 0 28px">`
    : "";
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#F5F5F7">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7"><tr><td align="center" style="padding:40px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border-radius:20px"><tr>` +
    `<td style="padding:40px 36px 24px;font-family:${FONT};font-size:16px;line-height:1.6;color:#1A1A1A">${logo}${paras}</td>` +
    `</tr></table></td></tr></table></body></html>`;
  return { subject, text: body, html };
}
