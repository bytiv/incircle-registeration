import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { requireServiceRoleKey, SUPABASE_URL } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Service-role client. Bypasses every RLS policy.
 *
 * The `server-only` import above is the guard: importing this module from any
 * "use client" file fails the build rather than leaking the key into the bundle.
 *
 * Legitimate users, all server-side:
 *   - /api/claim         — check verify_code, link auth.uid() to an attendee
 *   - /api/admin/state   — the host writes event_state
 *   - /api/admin/people  — add/edit/remove, reset, restore, CSV
 *   - /api/register, /register — the public sign-up, and the page it serves
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(SUPABASE_URL, requireServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
