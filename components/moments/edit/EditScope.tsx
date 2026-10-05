"use client";

import { useMemo, type ReactNode } from "react";

import { limitOf, textOf, withTextOf } from "@/lib/moments/textPath";
import type { AnyKind, Lang } from "@/lib/moments/types";

import { EditCtx, type ChangeOpts, type EditApi } from "./context";
import { EditableText } from "./EditableText";

/**
 * Makes the screens below it editable: every `<Tx path>` becomes an EditableText bound to
 * `cfg`, and each change goes back through `edit` — the page's own draft.
 *
 * CIB's EditScope, for the registration page: its lines are plain keys of its own copy, so
 * there is no kind, and the moments' lists and pictures (EditableList, EditablePictures) are
 * not wired in — the context leaves them optional and nothing on the page asks for them.
 */
export function EditScope({
  cfg,
  lang,
  edit,
  kind,
  upload,
  layer = null,
  scale = 1,
  children,
}: {
  cfg: object;
  lang: Lang;
  /** Apply a change to the page's draft config (a functional update: typing never loses a key). */
  edit: (next: (cfg: object) => object, opts?: ChangeOpts) => void;
  kind?: AnyKind | null;
  upload?: (file: File, onProgress?: (fraction: number) => void) => Promise<string>;
  /** The tools' layer beside the scaled screen (the hint under a text). */
  layer?: HTMLElement | null;
  scale?: number;
  children: ReactNode;
}) {
  const api = useMemo<EditApi>(() => {
    const valid = (c: object) => (kind ? kind.validate(c) : c);
    return {
      lang,
      textAt: (path) => textOf(kind, cfg, path),
      setText: (path, value) => edit((c) => valid(withTextOf(kind, c, path, lang, value) ?? c), { key: `text:${path}` }),
      change: (next, opts) => edit((c) => valid(next(c)), opts),
      limit: (path) => (kind ? limitOf(kind, cfg, path, lang) : null),
      upload,
      Text: EditableText,
      layer,
      scale,
    };
  }, [cfg, lang, edit, kind, upload, layer, scale]);
  return <EditCtx.Provider value={api}>{children}</EditCtx.Provider>;
}
