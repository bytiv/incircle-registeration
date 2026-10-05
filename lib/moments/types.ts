/**
 * The text vocabulary the in-place editor speaks — the part of CIB's
 * lib/moments/types.ts that the registration page's editor uses (the editor
 * itself, components/moments/edit, is CIB's own; it edits the moments in CIB
 * and the registration page in both). Unchanged, so the editor and <Tx> are
 * CIB's files as they are.
 */

/* ------------------------------------------------------------------ language */

export type Lang = "en" | "ar";

/** Every piece of audience text is a pair. The control room is English only. */
export type Text = { en: string; ar: string };

/** The display rule (MOMENTS_SPEC §2.9): Arabic when asked for and not empty, else English. */
export function t(text: Text | null | undefined, lang: Lang): string {
  if (!text) return "";
  if (lang === "ar" && text.ar.trim() !== "") return text.ar;
  return text.en;
}

/* ------------------------------------------------------------ the studio */

/**
 * A KIND'S OWN TEXT RESOLVER — for texts the shared one (lib/moments/textPath.ts) cannot read.
 * Answer `undefined` for a path that is not the kind's own, and the shared resolver takes it.
 * `set` returns a new config (the old one untouched), or null when the path names no text.
 */
export type TextResolver<C extends object = object> = {
  at(cfg: C, path: string): Text | null | undefined;
  set(cfg: C, path: string, lang: Lang, value: string): C | null | undefined;
};

/**
 * What the editor needs of a moment's kind: its id, its validate, and its own text resolver when
 * it has one. CIB's AnyKind is the whole moment kind; the registration editor passes no kind at
 * all (its lines are plain keys of its own copy), so this is all the editor ever reads of one.
 */
export type AnyKind = {
  id?: string;
  validate(raw: unknown): object;
  texts?: TextResolver<object>;
};
