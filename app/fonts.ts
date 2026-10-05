import localFont from "next/font/local";

/**
 * Gilroy, 7 weights — InCircle's typeface, from its design handoff
 * (incircle-application/incircle_design_source/fonts, the same files its
 * lib/fonts.ts loads).
 *
 * The screens lean on the full range: 600 body, 800 titles, 900 eyebrows.
 * Only .woff was shipped, no .woff2, so these are ~36KB each.
 *
 * Licence note (carried over from InCircle): confirm Gilroy is licensed for
 * web use. The fallback is the system stack.
 *
 * `--font-gilroy` is the contract: app/globals.css builds `--font-sans` from it.
 */
export const gilroy = localFont({
  src: [
    { path: "./fonts/Gilroy-Light.woff", weight: "300", style: "normal" },
    { path: "./fonts/Gilroy-Regular.woff", weight: "400", style: "normal" },
    { path: "./fonts/Gilroy-Medium.woff", weight: "500", style: "normal" },
    { path: "./fonts/Gilroy-SemiBold.woff", weight: "600", style: "normal" },
    { path: "./fonts/Gilroy-Bold.woff", weight: "700", style: "normal" },
    { path: "./fonts/Gilroy-ExtraBold.woff", weight: "800", style: "normal" },
    { path: "./fonts/Gilroy-Black.woff", weight: "900", style: "normal" },
  ],
  display: "swap",
  variable: "--font-gilroy",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});
