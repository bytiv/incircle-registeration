"use client";

import { Fragment, useLayoutEffect, useRef, useState, type ClipboardEvent, type ElementType, type KeyboardEvent } from "react";

import { useEdit } from "@/components/moments/edit/context";
import { cx } from "@/components/ui/cx";
import { richParts } from "@/lib/sitePage";

/**
 * A PARAGRAPH WITH BOLD WORDS — "We bring **together** people…". The page keeps the words with
 * `**` around the bold ones (lib/sitePage.ts); visitors see <strong>.
 *
 * In edit mode the paragraph is typed into where it shows (contentEditable), and a word is made
 * bold the way any editor does it: select it, then ⌘B / Ctrl+B, or the small B above the
 * paragraph. The text is read back out of the paragraph on every keystroke, bold runs as `**`,
 * and the paragraph is only refilled while it does not have the caret, so React never moves it.
 * Enter finishes; a paste comes in as plain text. A paragraph in a list (`onRemove`) also has
 * Remove beside the B, and Backspace in it once it is empty takes it away.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function toHtml(value: string): string {
  return richParts(value)
    .map((p) => (p.bold ? `<strong>${esc(p.text)}</strong>` : esc(p.text)))
    .join("");
}

/** The paragraph's words back out of its DOM, bold runs between `**`. */
function serialize(root: HTMLElement): string {
  const OPEN = "\u0000";
  const CLOSE = "\u0001";
  let out = "";
  const walk = (node: Node, bold: boolean) => {
    node.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        const t = n.textContent ?? "";
        if (t) out += bold ? `${OPEN}${t}${CLOSE}` : t;
        return;
      }
      if (!(n instanceof HTMLElement)) return;
      if (n.tagName === "BR") {
        out += " ";
        return;
      }
      const weight = n.style.fontWeight;
      const isBold = bold || n.tagName === "B" || n.tagName === "STRONG" || weight === "bold" || Number(weight) >= 600;
      walk(n, isBold);
    });
  };
  walk(root, false);
  return (
    out
      // one bold run, not two, where two bold nodes touch
      .replace(/\u0001\u0000/g, "")
      // a "bold" run of nothing but spaces is just the spaces
      .replace(/\u0000(\s*)\u0001/g, "$1")
      // the spaces at a run's edges sit outside it, so ** never hugs a space
      .replace(/\u0000(\s+)/g, "$1\u0000")
      .replace(/(\s+)\u0001/g, "\u0001$1")
      .replace(/[\u0000\u0001]/g, "**")
      .replace(/\s+/g, " ")
  );
}

export function RichText({
  path,
  value,
  as,
  className,
  placeholder = "Write a paragraph",
  onRemove,
}: {
  /** Where the text lives in the page's content: "about.cards.0.text". */
  path: string;
  value: string;
  as?: ElementType;
  className?: string;
  placeholder?: string;
  /** Takes this paragraph out of its list (edit mode). */
  onRemove?: () => void;
}) {
  const edit = useEdit();
  const Tag = as ?? "p";
  if (!edit) {
    return (
      <Tag className={className}>
        {richParts(value).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>))}
      </Tag>
    );
  }
  return <RichEditable path={path} value={value} as={Tag} className={className} placeholder={placeholder} onRemove={onRemove} />;
}

function RichEditable({
  path,
  value,
  as: Tag,
  className,
  placeholder,
  onRemove,
}: {
  path: string;
  value: string;
  as: ElementType;
  className?: string;
  placeholder: string;
  onRemove?: () => void;
}) {
  const edit = useEdit();
  const ref = useRef<HTMLElement | null>(null);
  const focused = useRef(false);
  const [active, setActive] = useState(false);

  // Filled by hand, and only while it does not have the caret.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || focused.current) return;
    const html = toHtml(value);
    if (el.innerHTML !== html) el.innerHTML = html;
    el.toggleAttribute("data-empty", value.trim() === "");
  }, [value]);

  const sync = () => {
    const el = ref.current;
    if (!el || !edit) return;
    const text = serialize(el);
    el.toggleAttribute("data-empty", text.trim() === "");
    edit.setText(path, text);
  };

  const bold = () => {
    document.execCommand("bold");
    sync();
  };

  // Its words are kept first (the blur writes them to this paragraph's own path), then it goes.
  const remove = () => {
    ref.current?.blur();
    onRemove?.();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    e.stopPropagation();
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      bold();
    } else if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "i" || e.key.toLowerCase() === "u")) {
      // Italic and underline are not part of the page's words.
      e.preventDefault();
    } else if (e.key === "Backspace" && onRemove && (e.currentTarget.textContent ?? "").trim() === "") {
      e.preventDefault();
      remove();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
    if (text) document.execCommand("insertText", false, text);
  };

  return (
    <div className="st-richwrap">
      {active ? (
        <div className="st-rtools">
          <button
            type="button"
            // Pressed without taking the caret, so the selection it bolds is still there.
            onMouseDown={(e) => {
              e.preventDefault();
              bold();
            }}
            title="Make the selected words bold (⌘B / Ctrl+B)"
          >
            B <small>bold</small>
          </button>
          {onRemove ? (
            <button type="button" className="warm" onMouseDown={(e) => e.preventDefault()} onClick={remove} title="Take this paragraph out">
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
      <Tag
        ref={ref}
        className={cx(className, "st-rich")}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Edit this paragraph"
        aria-multiline
        data-placeholder={placeholder}
        data-edit={path}
        onFocus={() => {
          focused.current = true;
          setActive(true);
        }}
        onBlur={() => {
          focused.current = false;
          setActive(false);
          const el = ref.current;
          // Gone already (its list item was taken out): its words belong to nothing now.
          if (!el || !edit || !el.isConnected) return;
          const text = serialize(el).trim();
          el.toggleAttribute("data-empty", text === "");
          edit.setText(path, text);
          // Put the paragraph back in its own clean form (the browser's spans and <b>s go).
          const html = toHtml(text);
          if (el.innerHTML !== html) el.innerHTML = html;
        }}
        onInput={sync}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
      />
    </div>
  );
}
