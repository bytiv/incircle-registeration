import "server-only";

import { emailEnv } from "@/lib/env";

/**
 * EMAIL, through Resend (resend.com): its REST API straight, one POST per message, no SDK.
 *
 * Off until RESEND_API_KEY and EMAIL_FROM are in the environment (lib/env.ts emailEnv) — then
 * `emailReady()` is true and the sign-up route sends the welcome email (lib/regEmail.ts).
 * It never throws: a send that fails answers why, for the caller to log.
 */
export function emailReady(): boolean {
  return emailEnv() !== null;
}

export async function sendEmail(msg: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend's Idempotency-Key: the same key twice within a day sends once. */
  key?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const env = emailEnv();
  if (!env) return { ok: false, error: "RESEND_API_KEY / EMAIL_FROM are not set." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.apiKey}`,
        "Content-Type": "application/json",
        ...(msg.key ? { "Idempotency-Key": msg.key } : {}),
      },
      body: JSON.stringify({
        from: env.from,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        ...(env.replyTo ? { reply_to: env.replyTo } : {}),
      }),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: `${res.status} ${body.message ?? res.statusText}` };
    return { ok: true, id: body.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
