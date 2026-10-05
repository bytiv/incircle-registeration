/**
 * THE STORAGE NAMES — what a stored file is called, what may be stored, and how a stored
 * address is read back into a file. Pure: no I/O and no imports, so the server
 * (lib/storage), the browser's upload (the limits) and scripts/azure-*.mjs share one copy.
 *
 * Two places keep files:
 *
 *   Azure Blob Storage — one container (AZURE_STORAGE_CONTAINER, default `cib-launchpad`),
 *     as soon as AZURE_STORAGE_CONNECTION_STRING is set. Every name is unique, so a file is
 *     cached for a year and never overwritten:
 *       faces/<event>/<slug>-<random>.<ext>          a person's photo
 *       moments/<event>/<moment>/<uuid>.<ext>        a picture on a moment
 *     The rows keep the file's full public address.
 *
 *   Supabase Storage — the two public buckets `faces` and `moments`, until then, exactly as
 *     before: a photo is `<slug>.<ext>` in `faces` (the row keeps that bare key, and
 *     lib/photos.ts makes the address), a picture `<event>/<moment>/<uuid>.<ext>` in
 *     `moments` (the row keeps its public address).
 */

export type StorageProvider = "azure" | "supabase";

/** Azure as soon as a connection string is set; Supabase Storage until then. */
export function providerFor(connectionString: string | null | undefined): StorageProvider {
  return typeof connectionString === "string" && connectionString.trim() ? "azure" : "supabase";
}

/** An error's code: Azure's ("ContainerNotFound", "PublicAccessNotPermitted", …) or Node's ("ENOTFOUND"). */
export function errorCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: unknown; details?: { errorCode?: unknown } };
  if (typeof e.code === "string") return e.code;
  return typeof e.details?.errorCode === "string" ? e.details.errorCode : null;
}

/**
 * An Azure container name: 3–63 lowercase letters, digits and single hyphens, starting and
 * ending with a letter or digit.
 */
export function validContainerName(name: string): boolean {
  return /^(?=.{3,63}$)[a-z0-9]+(-[a-z0-9]+)*$/.test(name);
}

/** Every name is unique, so a stored file never changes and may be cached for a year. */
export const CACHE_FOREVER = "public, max-age=31536000, immutable";

/* ------------------------------------------------------------- what may be stored */

/** The pictures a host may put on a moment. */
export const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type PictureType = (typeof PICTURE_TYPES)[number];

/** A person's photo: no GIF, no SVG (a picture that can carry a script). */
export const FACE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type FaceType = (typeof FACE_TYPES)[number];

export const EXT: Record<PictureType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * The largest file the upload route takes: under Vercel's 4.5 MB request limit, so its own
 * message is the one the host sees. The browser makes a picture smaller well before this.
 */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** A declared type as one of the picture types ("image/jpg" reads as image/jpeg), or null. */
export function pictureType(mime: unknown): PictureType | null {
  const m = String(mime ?? "").trim().toLowerCase();
  if (m === "image/jpg" || m === "image/pjpeg") return "image/jpeg";
  return (PICTURE_TYPES as readonly string[]).includes(m) ? (m as PictureType) : null;
}

export function isFaceType(type: PictureType | null): type is FaceType {
  return type !== null && (FACE_TYPES as readonly string[]).includes(type);
}

/**
 * What the bytes really are, read from their first bytes. A file's label (its extension, the
 * browser's `type`, a data URL's prefix) can be wrong; the stored Content-Type comes from this.
 */
export function sniffPictureType(b: Uint8Array): PictureType | null {
  const at = (i: number, text: string) => [...text].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length >= 8 && b[0] === 0x89 && at(1, "PNG\r\n\x1a\n")) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && (at(0, "GIF87a") || at(0, "GIF89a"))) return "image/gif";
  if (b.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  return null;
}

/* --------------------------------------------------------------------- the names */

/**
 * One segment of a name: lowercase letters, digits, `_` and `-`, at most `max` long, never
 * empty, never `.` or `..` (there are no dots at all), so no value can leave its folder.
 */
export function cleanSegment(value: unknown, fallback: string, max = 60): string {
  const s = String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, max)
    .replace(/[-_]+$/g, "");
  return s || fallback;
}

/** Azure: a person's photo, `faces/<event>/<slug>-<random>.<ext>`. */
export function faceBlobName(eventId: string, slug: string, random: string, type: FaceType): string {
  return `faces/${cleanSegment(eventId, "event", 64)}/${cleanSegment(slug, "guest", 40)}-${cleanSegment(random, "x", 16)}.${EXT[type]}`;
}

/** Azure: a picture on a moment, `moments/<event>/<moment>/<uuid>.<ext>`. */
export function momentBlobName(eventId: string, pageId: string, id: string, type: PictureType): string {
  return `moments/${cleanSegment(eventId, "event", 64)}/${cleanSegment(pageId, "moment", 40)}/${cleanSegment(id, "picture", 64)}.${EXT[type]}`;
}

/** Supabase Storage, as it has always been: the photo is `<slug>.<ext>` in `faces`. */
export function supabaseFaceKey(slug: string, type: FaceType): string {
  return `${slug}.${EXT[type]}`;
}

/** Supabase Storage, as it has always been: `<event>/<moment>/<uuid>.<ext>` in `moments`. */
export function supabaseMomentKey(eventId: string, pageId: unknown, id: string, type: PictureType): string {
  const page = String(pageId ?? "moment").replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "moment";
  return `${eventId}/${page}/${id}.${EXT[type]}`;
}

/* -------------------------------------------------------- addresses, read back */

const trimSlash = (s: string) => s.replace(/\/+$/, "");
const withoutQuery = (s: string) => s.split(/[?#]/)[0];

/** http(s)://… — the column's "absolute URL" form; anything else is a bare storage key. */
export function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** Where the Azure files are. */
export type AzureTarget = {
  /** The container's own address, e.g. https://acct.blob.core.windows.net/cib-launchpad. */
  containerUrl: string;
  /** The container's name. */
  container: string;
  /**
   * NEXT_PUBLIC_AZURE_BLOB_BASE_URL: a CDN or custom domain in front of the account, which
   * serves a file at `<base>/<container>/<name>`. New addresses use it when it is set.
   */
  baseUrl?: string | null;
};

/** A blob name as a URL path: each segment encoded, the slashes kept. */
const encodeName = (name: string) => name.split("/").map(encodeURIComponent).join("/");

/** A file's public address: through the CDN when one is set, else the container's own. */
export function azurePublicUrl(t: AzureTarget, name: string): string {
  const root = t.baseUrl ? `${trimSlash(t.baseUrl.trim())}/${t.container}` : trimSlash(withoutQuery(t.containerUrl));
  return `${root}/${encodeName(name)}`;
}

/** A name a delete may act on: no empty, `.` or `..` segment, no backslash. */
export function validBlobName(name: string): boolean {
  if (!name || name.length > 1024 || name.includes("\\")) return false;
  return name.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** The roots a file of ours can sit under: the container's own address, and the CDN's. */
function azureRoots(t: AzureTarget): string[] {
  const roots = [withoutQuery(t.containerUrl)];
  if (t.baseUrl) roots.push(`${trimSlash(t.baseUrl.trim())}/${t.container}`);
  return roots;
}

/**
 * The blob an address names, when it is one of OURS — under this container, by its own address
 * or the CDN's. Anything else (a pasted link, another account, another container, Supabase) is
 * null, and nothing may be deleted for it.
 */
export function azureBlobName(url: string, t: AzureTarget): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  for (const root of azureRoots(t)) {
    let r: URL;
    try {
      r = new URL(root);
    } catch {
      continue;
    }
    if (u.origin !== r.origin) continue;
    const prefix = `${trimSlash(r.pathname)}/`;
    if (!u.pathname.startsWith(prefix)) continue;
    let name: string;
    try {
      name = u.pathname
        .slice(prefix.length)
        .split("/")
        .map((seg) => decodeURIComponent(seg))
        .join("/");
    } catch {
      return null;
    }
    return validBlobName(name) ? name : null;
  }
  return null;
}

/** Every address one of our blobs is known by (its own, and the CDN's): for "is it still used?". */
export function azureAliases(t: AzureTarget, name: string): string[] {
  const own = azurePublicUrl({ ...t, baseUrl: null }, name);
  return [...new Set([azurePublicUrl(t, name), own])];
}

const PUBLIC_PATH = "/storage/v1/object/public/";

/** A Supabase Storage file's public address, as lib/photos.ts writes it for a face. */
export function supabasePublicUrl(supabaseUrl: string, bucket: string, key: string): string {
  return `${trimSlash(supabaseUrl.trim())}${PUBLIC_PATH}${bucket}/${encodeURIComponent(key)}`;
}

/**
 * `<SUPABASE_URL>/storage/v1/object/public/<bucket>/<key>` → its bucket and key (decoded), for
 * THIS project's address only; null for anything else.
 */
export function parseSupabasePublicUrl(url: string, supabaseUrl: string): { bucket: string; key: string } | null {
  let u: URL;
  let base: URL;
  try {
    u = new URL(url.trim());
    base = new URL(supabaseUrl.trim());
  } catch {
    return null;
  }
  if (u.origin !== base.origin) return null;
  const prefix = `${trimSlash(base.pathname)}${PUBLIC_PATH}`;
  if (!u.pathname.startsWith(prefix)) return null;
  const rest = u.pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  try {
    const bucket = decodeURIComponent(rest.slice(0, slash));
    const key = decodeURIComponent(rest.slice(slash + 1));
    return bucket && key ? { bucket, key } : null;
  } catch {
    return null;
  }
}

/**
 * Every way a row may spell one Supabase file: the bare key (a face's photo_path), and its
 * public address encoded as lib/photos.ts does and as supabase-js's getPublicUrl does.
 */
export function supabaseAliases(supabaseUrl: string, bucket: string, key: string): string[] {
  const out = new Set<string>();
  if (bucket === "faces") out.add(key);
  if (supabaseUrl.trim()) {
    out.add(supabasePublicUrl(supabaseUrl, bucket, key));
    out.add(`${trimSlash(supabaseUrl.trim())}${PUBLIC_PATH}${encodeURI(`${bucket}/${key}`)}`);
  }
  return [...out];
}
