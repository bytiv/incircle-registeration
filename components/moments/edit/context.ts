"use client";

import { createContext, useContext, type ComponentType, type ElementType, type ReactNode } from "react";

import type { Lang, Text } from "@/lib/moments/types";

/**
 * THE EDIT CONTEXT — mounted only by the studio (the moment page's Settings: the moment built on
 * its own screens, components/moments/admin/Studio.tsx) and by the Registration editor, around
 * the screens they edit (docs/briefs/DIRECT_EDITING.md §4). `<Tx path>` asks for it; with none,
 * it draws text as always. The editing parts come IN the context, so Tx and the kit (on every
 * phone) never import editor code: the phones download nothing extra.
 */

/** How a change reaches the draft: a typing run in one text undoes as one step; a removal can be undone from its toast. */
export type ChangeOpts = {
  /** Changes with the same key within a short while undo as one step (typing in one text). */
  key?: string;
  /** Something was taken away ("Option", "Picture"): the studio offers it back ("Option removed · Undo"). */
  removed?: string;
};

export type EditTextProps = {
  path: string;
  as?: ElementType;
  className?: string;
  /** What an empty text shows, grey: "+ Add a line". */
  placeholder?: string;
  /** Body text: Shift+Enter starts a new line (Enter still finishes). */
  multiline?: boolean;
};

export type EditPicturesProps = {
  mode: "none" | "one" | "grid" | "swipe";
  count: number;
  urls: string[];
  /** Where the pictures live in the config ("imgs"). */
  path: string;
  /** The screen they are drawn on: the phone's layouts, or the big screen's picture column. */
  surface?: "phone" | "hall";
};

export type EditPictureProps = {
  /** Where the picture's URL lives in the config ("img", "bg"). */
  path: string;
  url: string;
  className?: string;
  /** What the empty slot says: "the picture". */
  label?: string;
  /** "box": the picture fills the box · "cover": a background behind other content (a card's). */
  look?: "box" | "cover";
};

/** How a list edits in place: where it lives, its bounds, and what a new item is. */
export type ListSpec = {
  path: string;
  min: number;
  max: number;
  make: () => unknown;
  addLabel?: string;
  /** One item, as the Undo toast names it: "Option". */
  itemLabel?: string;
  /** Its items can be dragged into another order (a grip beside each; Alt+↑/↓ on a focused one), as the Registration page's fields. */
  reorder?: boolean;
};

export type EditListProps = {
  spec: ListSpec;
  count: number;
  className?: string;
  /** One item's own markup; its words are `<Tx path={`${spec.path}.${i}`} />`. */
  item: (i: number) => ReactNode;
};

export type EditApi = {
  /** The half of each pair being edited. Phones are English for now. */
  lang: Lang;
  textAt(path: string): Text | null;
  setText(path: string, value: string): void;
  /** Any other change to the draft config (a list's add, remove or move, a picture). */
  change(next: (cfg: object) => object, opts?: ChangeOpts): void;
  /** The most characters the text at `path` takes (its kind's validate), or null. */
  limit(path: string): number | null;
  /** A picture into the moment's storage; resolves with its URL (throws the refusal). `onProgress` hears the upload, 0 to 1. */
  upload?(file: File, onProgress?: (fraction: number) => void): Promise<string>;
  Text: ComponentType<EditTextProps>;
  /** A kit list changed where it shows (the kit's Options hand their spec to it). */
  List?: ComponentType<EditListProps>;
  Pictures?: ComponentType<EditPicturesProps>;
  Picture?: ComponentType<EditPictureProps>;
  /** Where floating tools draw: a layer beside the scaled screen, so they stay crisp. */
  layer: HTMLElement | null;
  /** The screen's scale (1 = real size). */
  scale: number;
};

export const EditCtx = createContext<EditApi | null>(null);

export function useEdit(): EditApi | null {
  return useContext(EditCtx);
}

/** One item of a list edited in place: Backspace in its empty text takes it away (above the list's minimum). */
export type ListItemApi = { index: number; canRemove: boolean; remove(): void };

export const ListItemCtx = createContext<ListItemApi | null>(null);
