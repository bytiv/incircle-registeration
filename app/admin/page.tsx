import { isUnlocked } from "@/lib/admin/auth";
import { emailReady } from "@/lib/email";
import { hasServiceRoleKey, isSupabaseConfigured } from "@/lib/env";
import { getAdminData } from "@/lib/queries/admin";
import { AdminGate } from "@/components/admin/AdminGate";
import { AdminRoot } from "@/components/admin/AdminRoot";
import { Code, SetupNotice } from "@/components/SetupNotice";

/**
 * The host control room.
 *
 * The passcode is checked HERE, server-side, before anything is fetched or
 * rendered: a locked browser is sent the gate and nothing else — no rail, no
 * list, no attendee data.
 */
export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ v?: string | string[] }>;
}) {
  if (!isSupabaseConfigured || !hasServiceRoleKey()) {
    return (
      <SetupNotice
        title="Connect Supabase to open the control room."
        detail={
          <>
            The admin reads and writes the event, so it needs the keys in <Code>.env.local</Code> before it can render.
          </>
        }
        steps={[
          <>
            Paste <Code>NEXT_PUBLIC_SUPABASE_URL</Code> and <Code>SUPABASE_SERVICE_ROLE_KEY</Code>, then restart{" "}
            <Code>npm run dev</Code>.
          </>,
        ]}
      />
    );
  }

  if (!(await isUnlocked())) return <AdminGate />;

  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  /*
   * `?v=…` is the PAGE the host was on — written by AdminRoot as they move, read here so a
   * reload (and every router.refresh a mutation triggers) lands them where they were.
   */
  const initialView = { v: one(params.v) };
  const result = await getAdminData();
  if (!result.ok) {
    return (
      <SetupNotice
        title="The control room could not read the event."
        detail={<>{result.error}</>}
        steps={[
          <>
            Run the files in <Code>supabase/</Code> in order (the last one makes the event), or point{" "}
            <Code>NEXT_PUBLIC_EVENT_SLUG</Code> at an <Code>events.slug</Code>.
          </>,
        ]}
      />
    );
  }

  return <AdminRoot key={result.data.event.id} initial={result.data} initialView={initialView} emailReady={emailReady()} />;
}
