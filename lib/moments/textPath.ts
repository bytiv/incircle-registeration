import type { Lang, Text, TextResolver } from "@/lib/moments/types";

/**
 * WHERE A TEXT LIVES IN A MOMENT'S CONFIG — the path `<Tx path>` prints as `data-tx`, read
 * and written back, so the studio can edit the words right on the screens
 * (docs/briefs/DIRECT_EDITING.md §4.4). Pure: no React.
 *
 *   "head"          a pair on the config itself:     cfg.head / cfg.headAr
 *   "qs.0.t"        a pair on an object in a list:   cfg.qs[0].t / cfg.qs[0].tAr
 *   "qs.0.opts.2"   a tuple [en, ar] in a list:       cfg.qs[0].opts[2][0] / [1]
 *
 * Anything else resolves to null, and the text stays as it is drawn (not editable). A kind
 * whose texts take another shape answers for them itself (`texts`, lib/moments/types.ts):
 * `textOf` and `withTextOf` ask it first.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isTuple = (v: unknown): v is [string, string, ...unknown[]] =>
  Array.isArray(v) && v.length >= 2 && typeof v[0] === "string" && typeof v[1] === "string";

/** Walk to the container that holds the last segment, or null. */
function parentOf(cfg: unknown, segs: string[]): unknown {
  let at: unknown = cfg;
  for (const seg of segs.slice(0, -1)) {
    if (Array.isArray(at)) at = at[Number(seg)];
    else if (isObj(at)) at = at[seg];
    else return null;
  }
  return at;
}

/** The pair at `path`, or null when the path names no text. */
export function textAt(cfg: object, path: string): Text | null {
  const segs = path.split(".").filter(Boolean);
  if (!segs.length) return null;
  const last = segs[segs.length - 1];
  const parent = parentOf(cfg, segs);
  if (isObj(parent) && typeof parent[last] === "string") {
    const ar = parent[`${last}Ar`];
    return { en: parent[last] as string, ar: typeof ar === "string" ? ar : "" };
  }
  const leaf = Array.isArray(parent) ? parent[Number(last)] : isObj(parent) ? parent[last] : undefined;
  if (isTuple(leaf)) return { en: leaf[0], ar: leaf[1] };
  return null;
}

/** A copy of `cfg` with the `lang` half of the text at `path` set to `value`, or null when the path names no text. */
export function withText<C extends object>(cfg: C, path: string, lang: Lang, value: string): C | null {
  const segs = path.split(".").filter(Boolean);
  if (!segs.length || !textAt(cfg, path)) return null;

  const write = (node: unknown, i: number): unknown => {
    const seg = segs[i];
    const lastSeg = i === segs.length - 1;
    if (Array.isArray(node)) {
      const k = Number(seg);
      const copy = node.slice();
      copy[k] = lastSeg ? setTuple(node[k], lang, value) : write(node[k], i + 1);
      return copy;
    }
    const obj = node as Obj;
    if (!lastSeg) return { ...obj, [seg]: write(obj[seg], i + 1) };
    if (typeof obj[seg] === "string") return { ...obj, [lang === "ar" ? `${seg}Ar` : seg]: value };
    return { ...obj, [seg]: setTuple(obj[seg], lang, value) };
  };
  return write(cfg, 0) as C;
}

function setTuple(tuple: unknown, lang: Lang, value: string): unknown {
  const copy = (tuple as unknown[]).slice();
  copy[lang === "ar" ? 1 : 0] = value;
  return copy;
}

/** The list at `path` ("qs.0.opts"), or null. */
export function listAt(cfg: object, path: string): unknown[] | null {
  const segs = path.split(".").filter(Boolean);
  let at: unknown = cfg;
  for (const seg of segs) {
    if (Array.isArray(at)) at = at[Number(seg)];
    else if (isObj(at)) at = at[seg];
    else return null;
  }
  return Array.isArray(at) ? at : null;
}

/** A copy of `cfg` with the list at `path` replaced by `next(list)`, or null when there is no list there. */
export function withList<C extends object>(cfg: C, path: string, next: (list: unknown[]) => unknown[]): C | null {
  const list = listAt(cfg, path);
  if (!list) return null;
  const segs = path.split(".").filter(Boolean);
  const write = (node: unknown, i: number): unknown => {
    if (i === segs.length) return next(list);
    const seg = segs[i];
    if (Array.isArray(node)) {
      const copy = node.slice();
      copy[Number(seg)] = write(node[Number(seg)], i + 1);
      return copy;
    }
    const obj = node as Obj;
    return { ...obj, [seg]: write(obj[seg], i + 1) };
  };
  return write(cfg, 0) as C;
}

/* ------------------------------------------------------- through the kind */

/** What the helpers below need of a kind: its validate, and its own resolver when it has one. */
type KindTexts = { id?: string; validate(raw: unknown): object; texts?: TextResolver<object> };

/** The text at `path`: the kind's own resolver first, then the shared one. */
export function textOf(kind: KindTexts | null | undefined, cfg: object, path: string): Text | null {
  const own = kind?.texts?.at(cfg, path);
  return own === undefined ? textAt(cfg, path) : own;
}

/** A copy of `cfg` with one half of the text at `path` set: the kind's own resolver first, then the shared one. */
export function withTextOf<C extends object>(kind: KindTexts | null | undefined, cfg: C, path: string, lang: Lang, value: string): C | null {
  const own = kind?.texts?.set(cfg, path, lang, value);
  return own === undefined ? withText(cfg, path, lang, value) : (own as C | null);
}

/** "qs.3.opts.12" → "qs.*.opts.*": one limit serves every item of a list. */
const shapeOf = (path: string) => path.replace(/\.\d+(?=\.|$)/g, ".*");
const LIMITS = new Map<string, number | null>();
const PROBE = 4000;

/**
 * THE MOST CHARACTERS A TEXT TAKES — found from the kind's own `validate`, the one source of
 * truth (DIRECT_EDITING §4.5): hand it a text far too long and measure what comes back. Null
 * when the kind keeps any length (or the path names no text). Remembered per kind and shape.
 */
export function limitOf(kind: KindTexts | null | undefined, cfg: object, path: string, lang: Lang = "en"): number | null {
  if (!kind) return null;
  const key = `${kind.id ?? "?"}|${shapeOf(path)}|${lang}`;
  if (LIMITS.has(key)) return LIMITS.get(key) ?? null;
  let limit: number | null = null;
  try {
    const probe = withTextOf(kind, cfg, path, lang, "x".repeat(PROBE));
    const back = probe ? textOf(kind, kind.validate(probe), path) : null;
    const kept = back ? (lang === "ar" ? back.ar : back.en) : null;
    limit = kept !== null && kept.length < PROBE && /^x+$/.test(kept) ? kept.length : null;
  } catch {
    limit = null;
  }
  LIMITS.set(key, limit);
  return limit;
}
