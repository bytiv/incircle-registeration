import type { Metadata } from "next";

/*
 * The control room draws with the mockup's stylesheet (app/cib.css), which
 * the root layout loads once for every route — so the registration page's
 * preview inside the control room shares the real page's rules.
 */
export const metadata: Metadata = {
  title: "InCircle — Control room",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
