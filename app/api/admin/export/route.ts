import { isUnlocked } from "@/lib/admin/auth";
import { exportCsv } from "@/lib/admin/exportCsv";
import { getAdminData } from "@/lib/queries/admin";

/**
 * EXPORT CSV — People's EXPORT button. The rows come from the database and the
 * file is built here, because `attendees` is not readable from a browser at
 * all. The columns are lib/admin/exportCsv.ts's.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isUnlocked())) {
    return new Response("Locked.", { status: 401 });
  }

  const result = await getAdminData();
  if (!result.ok) return new Response(result.error, { status: 500 });

  // The byte-order mark makes Excel read the file as UTF-8, so Arabic names open intact.
  return new Response("﻿" + exportCsv(result.data.snapshot), {
    headers: {
      "Content-Type": "text/csv;charset=utf-8",
      "Content-Disposition": 'attachment; filename="incircle-registrations.csv"',
      "Cache-Control": "no-store",
    },
  });
}
