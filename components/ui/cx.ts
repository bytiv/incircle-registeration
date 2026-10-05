/** Join class names, dropping the falsy ones: cx("btn", on && "on"). */
export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(" ");
