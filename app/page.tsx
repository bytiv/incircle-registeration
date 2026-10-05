import type { Metadata } from "next";

import { isUnlocked } from "@/lib/admin/auth";
import { eventDay } from "@/lib/admin/eventClock";
import { SITE_URL } from "@/lib/env";
import { loadSite } from "@/lib/queries/site";
import { plainText } from "@/lib/sitePage";

import { SiteRoot } from "@/components/site/SiteRoot";

/**
 * THE PUBLIC PAGE — incircle.community: the invitation, the registration form, about InCircle,
 * and moments from the circle (components/site).
 *
 * A signed-in host (the control room's passcode cookie) sees the same page with a bar at the
 * bottom: PREVIEW shows it exactly as a visitor does; EDIT lets every word, the hero picture,
 * the album and the form be changed where they show, saved as they go. `?edit=1` opens it
 * straight in EDIT (the control room's "Edit the page"). Nobody else ever sees the bar: the
 * check is made here, on the server, before anything renders.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { content } = await loadSite();
  const title = content.meta.title;
  const description = plainText(content.meta.description);
  return {
    title,
    description,
    authors: [{ name: "DOTMENT" }],
    ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
    openGraph: { title, description, type: "website", images: [{ url: "/site/og.jpg", width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: ["/site/og.jpg"] },
  };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ edit?: string | string[] }> }) {
  const [admin, data, params] = await Promise.all([isUnlocked(), loadSite(), searchParams]);
  const edit = admin && (Array.isArray(params.edit) ? params.edit[0] : params.edit) === "1";
  // Written here, in the event's own time zone, so the server and the browser never disagree on it.
  const when = [data.event?.startsAt ? eventDay(data.event.startsAt) : null, data.event?.venue].filter(Boolean).join(" · ");
  return <SiteRoot {...data} when={when} admin={admin ? { edit } : null} />;
}
