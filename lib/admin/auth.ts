import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { requireAdminPasscode, requireServiceRoleKey } from "@/lib/env";

/**
 * The host gate.
 *
 * The prototype kept `sessionStorage["incircle_admin_unlocked"] = "1"` and
 * compared the passcode in the browser (design:353-362) — fine for a mockup,
 * useless here: anyone could set the key from a console and every show control
 * would render. So the check moved server-side, and the proof of it is an
 * httpOnly cookie the page reads before it renders anything.
 *
 * The cookie never carries the passcode. It carries a digest of it salted with
 * the service-role key, so a cookie lifted off a laptop reveals neither.
 */
export const ADMIN_COOKIE = "cib_admin";

function token(): string {
  return createHash("sha256")
    .update(`${requireAdminPasscode()}::${requireServiceRoleKey()}`)
    .digest("hex");
}

/** Constant-time, and never throws on a length mismatch. */
function sameToken(given: string): boolean {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(token(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function passcodeMatches(given: string): boolean {
  const want = requireAdminPasscode();
  const a = Buffer.from(String(given ?? ""), "utf8");
  const b = Buffer.from(want, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function issuedToken(): string {
  return token();
}

/**
 * Read by app/admin/page.tsx BEFORE any control renders, and by every
 * /api/admin/* route before it touches the service role.
 */
export async function isUnlocked(): Promise<boolean> {
  try {
    const jar = await cookies();
    const value = jar.get(ADMIN_COOKIE)?.value;
    return Boolean(value) && sameToken(value!);
  } catch {
    // ADMIN_PASSCODE or the service key is missing — treat as locked, and let
    // the page render the gate with its own explanation rather than crashing.
    return false;
  }
}
