import { NextResponse } from "next/server";

import { ADMIN_COOKIE, issuedToken, passcodeMatches } from "@/lib/admin/auth";

/**
 * POST { passcode } -> sets the httpOnly gate cookie.
 * DELETE            -> clears it. This is the rail's "Sign out" and Settings'
 *                      "Sign out now".
 *
 * The prototype compared the passcode in the browser (design:353-362); the
 * comparison lives here instead so the show controls are never sent to a
 * browser that has not proved it knows the code.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let passcode = "";
  try {
    const body = (await request.json()) as { passcode?: unknown };
    passcode = typeof body?.passcode === "string" ? body.passcode : "";
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  let ok = false;
  try {
    ok = passcodeMatches(passcode);
  } catch (e) {
    // ADMIN_PASSCODE is not set. Say so plainly rather than failing as "wrong code".
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  if (!ok) {
    // design:359 — the gate shakes and clears; it does not explain which part was wrong.
    return NextResponse.json({ error: "That passcode is not right" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, issuedToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    // The host's laptop stays unlocked for the evening, not forever.
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
