"use client";

import { createContext, type ReactNode } from "react";

import type { Lang } from "@/lib/moments/types";

/** The language the nearest shell is drawn in — <Tx> reads it. */
export const LangCtx = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangCtx.Provider value={lang}>{children}</LangCtx.Provider>;
}

/** `dir` for a language. */
export const dirOf = (lang: Lang): "rtl" | "ltr" => (lang === "ar" ? "rtl" : "ltr");
