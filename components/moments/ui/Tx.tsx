"use client";

import { useContext, type ElementType } from "react";

import { EditCtx } from "@/components/moments/edit/context";
import { t, type Lang, type Text } from "@/lib/moments/types";

import { cx } from "./cx";
import { LangCtx } from "./lang";

/**
 * <Tx> — THE ONE WAY AUDIENCE TEXT IS DRAWN. Every string a phone or the hall shows goes
 * through here, whether it is the host's (a config pair) or built in (a pair written
 * inline), so the studio can make text editable in this one component.
 *
 *   <Tx text={pairOf(cfg, "head")} path="head" />     the host's pair, and where it lives
 *   <Tx en="Nothing to tap." ar="لا شيء للضغط." />      a built-in pair
 *
 * The language comes from the nearest shell (PhoneShell, HallFrame) unless `lang` is
 * given. Arabic falls back to English when empty (MOMENTS_SPEC §2.9); the fallback is
 * marked left-to-right so it reads correctly inside an Arabic screen.
 *
 * Under the studio's edit context a host text with a path that resolves is typed into where
 * it shows (components/moments/edit). The text it edits is the STORED one, so a text must be
 * drawn as it is stored: decoration (capitals, quotes) belongs in CSS or a sibling element.
 */
export function Tx({
  text,
  en,
  ar,
  lang,
  path,
  as,
  className,
  placeholder,
  multiline,
}: {
  text?: Text | null;
  en?: string;
  ar?: string;
  lang?: Lang;
  /** The config key this text lives under: what the in-place editor writes back to (lib/moments/textPath.ts). */
  path?: string;
  as?: ElementType;
  className?: string;
  /** What an empty line shows in the editor ("+ Add a line"); the real screen shows nothing. */
  placeholder?: string;
  /** Body text: its own line breaks show (Shift+Enter types one in the studio). */
  multiline?: boolean;
}) {
  const scoped = useContext(LangCtx);
  const edit = useContext(EditCtx);
  // In the studio, a host text with a path that resolves is typed into where it shows.
  if (edit && path && edit.textAt(path)) {
    const Editor = edit.Text;
    return <Editor path={path} as={as} className={className} placeholder={placeholder} multiline={multiline} />;
  }
  const l: Lang = lang ?? scoped;
  const pairText: Text = text ?? { en: en ?? "", ar: ar ?? "" };
  const shown = t(pairText, l);
  const fellBack = l === "ar" && pairText.ar.trim() === "" && shown !== "";
  const Tag = as ?? "span";
  return (
    <Tag className={cx(className, multiline && "mo-lines") || undefined} data-tx={path} {...(fellBack ? { lang: "en", dir: "ltr" } : {})}>
      {shown}
    </Tag>
  );
}
