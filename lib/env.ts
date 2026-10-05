/**
 * Environment access, in one place.
 *
 * NEXT_PUBLIC_* values are inlined into the browser bundle by design. The
 * secrets (SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSCODE) are read through
 * functions, so no top-level constant can carry one into a client bundle.
 *
 * Copied from CIB's lib/env.ts, minus what registration does not use: the
 * device token's JWT secret (no attendee app here) and Azure storage (photos
 * live in Supabase Storage's `faces` bucket). The browser never talks to
 * Supabase: every read and write is a server route with the service role, so
 * the anon key is not needed either.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const EVENT_SLUG = process.env.NEXT_PUBLIC_EVENT_SLUG || "incircle";

/**
 * Where this app is reachable — the origin the Registration page prints as the
 * public page's link (and the page's own address in shared links), so it must
 * be one a visitor can open.
 *
 * Set NEXT_PUBLIC_SITE_URL to the deployed origin. Vercel's own VERCEL_URL is
 * used automatically when it is present, so production needs no configuration.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.NEXT_PUBLIC_VERCEL_URL ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}` : "")
).replace(/\/$/, "");

/**
 * The timezone the host's clocks render in — the event's, not the server's
 * (Vercel runs in UTC). Cairo by default; override for a different city.
 */
export const EVENT_TZ = process.env.NEXT_PUBLIC_EVENT_TZ || "Africa/Cairo";

/**
 * True once a real Supabase URL is in the environment. The copied .env.example
 * ships a placeholder, so we check for it too — otherwise the app would try to
 * reach https://xxxxxxxxxxxx.supabase.co and fail with a confusing network
 * error instead of showing the setup notice. Public (the browser builds photo
 * addresses from the URL); the server pages also check hasServiceRoleKey().
 */
export const isSupabaseConfigured =
  (SUPABASE_URL.startsWith("https://") || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(SUPABASE_URL)) &&
  !SUPABASE_URL.includes("xxxxxxxxxxxx");

/** Server-only: whether the service-role key is set (and not the .env.example placeholder). */
export function hasServiceRoleKey(): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return key.length > 0 && !key.startsWith("eyJhbGci...");
}

export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. It is server-only — add it to " +
        ".env.local locally and to Vercel's environment variables in production.",
    );
  }
  return key;
}

export function requireAdminPasscode(): string {
  const code = process.env.ADMIN_PASSCODE;
  if (!code) {
    throw new Error("ADMIN_PASSCODE is not set. /admin cannot be unlocked without it.");
  }
  return code;
}
