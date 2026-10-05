import type { Metadata, Viewport } from "next";

import { gilroy } from "./fonts";
import "./globals.css";
/*
 * The control room's stylesheets, once, after Tailwind: CIB's base (app/cib.css) and its premium
 * layer (app/cib-premium.css), whose class names the screens use — both reading InCircle's
 * tokens from globals.css — then InCircle's own finish (app/incircle.css). The public page's
 * stylesheet is its own (components/site/site.css).
 */
import "./cib.css";
import "./cib-premium.css";
import "./incircle.css";

export const metadata: Metadata = {
  title: "InCircle",
  description: "InCircle — registration.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* The page runs edge to edge on a real phone, so cover the viewport and pad against env(safe-area-*). */
  viewportFit: "cover",
  themeColor: "#F0F8FC",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    /*
     * suppressHydrationWarning is scoped to the element it sits on, one level
     * deep — it does not hide mismatches anywhere inside the app. <html> and
     * <body> each need their own, because dark-mode and accessibility
     * extensions stamp attributes onto both before React hydrates, and the
     * server HTML can never contain them.
     */
    <html lang="en" dir="ltr" className={gilroy.variable} suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
