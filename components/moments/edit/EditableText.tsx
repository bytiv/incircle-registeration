"use client";

import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";

import { cx } from "@/components/moments/ui/cx";

import { caretToEnd } from "./caret";
import { ListItemCtx, useEdit, type EditTextProps } from "./context";
import { EditHint } from "./EditHint";

/** How many characters of `el` the selection covers (what typing would replace). */
function selectedIn(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return 0;
  return sel.toString().length;
}

/**
 * A TEXT YOU TYPE INTO WHERE IT SHOWS — Belal's portfolio editor, adapted
 * (P/src/components/editor/editable-text.tsx there):
 *
 * - The screen's own element becomes `contentEditable="plaintext-only"`, keeping its tag and
 *   classes, so the words keep their exact type and place.
 * - React never rewrites the text under the caret: the element is filled by hand, and only
 *   while it does not have the caret.
 * - Enter finishes, Escape leaves; in body text Shift+Enter starts a new line. Backspace in an
 *   empty item of a list takes the item away (above the list's minimum).
 * - Typing stops at the text's limit — the kind's own validate says where — with a small count
 *   under it as the limit nears (drawn beside the scaled screen, so it stays crisp).
 * - Keys and clicks stop here, so the screen's own handlers (an option's tap, a drag) never fire.
 * - Empty, it shows a grey placeholder, never nothing.
 */
export function EditableText({ path, as, className, placeholder, multiline }: EditTextProps) {
  const edit = useEdit();
  const item = useContext(ListItemCtx);
  const ref = useRef<HTMLElement | null>(null);
  const focused = useRef(false);
  const [typing, setTyping] = useState<number | null>(null);
  const pair = edit?.textAt(path) ?? null;
  const value = pair ? (edit?.lang === "ar" ? pair.ar : pair.en) : "";
  const limit = edit ? edit.limit(path) : null;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || focused.current) return;
    if (el.textContent !== value) el.textContent = value;
    el.toggleAttribute("data-empty", value === "");
  }, [value]);

  // Typing stops at the limit: a key past it never lands (a paste is cut to fit in onPaste).
  useEffect(() => {
    const el = ref.current;
    if (!el || limit === null) return;
    const onBefore = (e: InputEvent) => {
      if (e.isComposing || !e.inputType.startsWith("insert") || e.inputType === "insertFromPaste") return;
      const adding = e.inputType === "insertText" ? (e.data?.length ?? 0) : 1;
      if ((el.textContent ?? "").length - selectedIn(el) + adding > limit) e.preventDefault();
    };
    el.addEventListener("beforeinput", onBefore);
    return () => el.removeEventListener("beforeinput", onBefore);
  }, [limit]);

  if (!edit) return null;
  const Tag = as ?? "span";
  const stop = (e: SyntheticEvent) => e.stopPropagation();

  const onInput = (e: SyntheticEvent<HTMLElement>) => {
    const el = e.currentTarget;
    let text = el.textContent ?? "";
    let trimmed = false;
    if (!multiline && text.includes("\n")) {
      text = text.replace(/\s*\n\s*/g, " ");
      trimmed = true;
    }
    if (limit !== null && text.length > limit) {
      text = text.slice(0, limit);
      trimmed = true;
    }
    if (trimmed) {
      el.textContent = text;
      caretToEnd(el);
    }
    el.toggleAttribute("data-empty", text === "");
    setTyping(text.length);
    edit.setText(path, text);
  };

  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    let text = e.clipboardData.getData("text/plain");
    if (!multiline) text = text.replace(/\s*\n\s*/g, " ");
    if (limit !== null) text = text.slice(0, Math.max(0, limit - ((el.textContent ?? "").length - selectedIn(el))));
    // The browser's own insert: the field's own undo (⌘Z inside it) keeps working.
    if (text) document.execCommand("insertText", false, text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    if (e.key === "Enter" && !(multiline && e.shiftKey)) {
      e.preventDefault();
      el.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      el.blur();
    } else if (e.key === "Backspace" && item?.canRemove && (el.textContent ?? "") === "") {
      e.preventDefault();
      item.remove();
    }
  };

  return (
    <>
      <Tag
        ref={ref}
        className={cx(className, "mo-ed", multiline && "mo-lines")}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={typing !== null}
        role="textbox"
        aria-label={placeholder ? placeholder.replace(/^\+\s*/, "") : "Edit this text"}
        aria-multiline={multiline || undefined}
        data-tx={path}
        data-edit={path}
        data-placeholder={placeholder ?? (edit.lang === "ar" ? "اكتب هنا" : "Type here")}
        lang={edit.lang}
        dir={edit.lang === "ar" ? "rtl" : "ltr"}
        onFocus={(e: SyntheticEvent<HTMLElement>) => {
          focused.current = true;
          setTyping((e.currentTarget.textContent ?? "").length);
        }}
        onBlur={(e: SyntheticEvent<HTMLElement>) => {
          focused.current = false;
          setTyping(null);
          const el = e.currentTarget;
          const text = el.textContent ?? "";
          // A text left empty drops whatever the browser kept to hold its line open.
          if (text === "" && el.childNodes.length) el.textContent = "";
          el.toggleAttribute("data-empty", text === "");
          if (text !== value) edit.setText(path, text);
        }}
        onInput={onInput}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onClick={stop}
        onPointerDown={stop}
      />
      {typing !== null ? (
        <EditHint anchor={ref.current} layer={edit.layer} length={typing} limit={limit} multiline={multiline} />
      ) : null}
    </>
  );
}
