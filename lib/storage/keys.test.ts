import assert from "node:assert/strict";
import { test } from "node:test";

import {
  azureAliases,
  azureBlobName,
  azurePublicUrl,
  cleanSegment,
  errorCode,
  faceBlobName,
  isAbsoluteUrl,
  isFaceType,
  momentBlobName,
  parseSupabasePublicUrl,
  pictureType,
  providerFor,
  sniffPictureType,
  supabaseAliases,
  supabaseFaceKey,
  supabaseMomentKey,
  supabasePublicUrl,
  validBlobName,
  validContainerName,
  type AzureTarget,
} from "./keys";

/**
 * THE STORAGE NAMES (lib/storage/keys.ts): which store a file goes to, what it is called there,
 * and how a stored address is read back into one of our files — or recognised as not ours, so
 * nothing is ever deleted for it. Run with `npm test`.
 */

const EVENT = "6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b";
const UUID = "0b7c4a52-9e2d-4f1a-8c3b-5d6e7f8a9b0c";

const AZURE: AzureTarget = { containerUrl: "https://cibfiles.blob.core.windows.net/cib-launchpad", container: "cib-launchpad" };
const AZURITE: AzureTarget = { containerUrl: "http://127.0.0.1:10000/devstoreaccount1/cib-launchpad", container: "cib-launchpad" };
const CDN: AzureTarget = { ...AZURE, baseUrl: "https://files.example.com/" };
const SUPABASE = "https://abcdefghijkl.supabase.co";

/* ------------------------------------------------------------------ provider */

test("Azure once a connection string is set, Supabase Storage until then", () => {
  assert.equal(providerFor(undefined), "supabase");
  assert.equal(providerFor(null), "supabase");
  assert.equal(providerFor(""), "supabase");
  assert.equal(providerFor("   "), "supabase");
  assert.equal(providerFor("DefaultEndpointsProtocol=https;AccountName=cibfiles;AccountKey=abc==;EndpointSuffix=core.windows.net"), "azure");
});

test("a container name follows Azure's rule", () => {
  for (const ok of ["cib-launchpad", "abc", "a1-b2-c3", "x".repeat(63)]) assert.equal(validContainerName(ok), true, ok);
  for (const bad of ["ab", "CIB", "cib--launchpad", "-cib", "cib-", "cib_launchpad", "x".repeat(64), "cib launchpad"]) {
    assert.equal(validContainerName(bad), false, bad);
  }
});

test("an error's code is read from Azure's errors and Node's", () => {
  assert.equal(errorCode({ code: "ContainerNotFound" }), "ContainerNotFound");
  assert.equal(errorCode({ details: { errorCode: "PublicAccessNotPermitted" } }), "PublicAccessNotPermitted");
  assert.equal(errorCode(new Error("plain")), null);
  assert.equal(errorCode(null), null);
});

/* ------------------------------------------------------------- what is stored */

test("a declared type is read leniently, and only pictures pass", () => {
  assert.equal(pictureType("image/png"), "image/png");
  assert.equal(pictureType(" IMAGE/JPEG "), "image/jpeg");
  assert.equal(pictureType("image/jpg"), "image/jpeg");
  assert.equal(pictureType("image/gif"), "image/gif");
  assert.equal(pictureType("image/svg+xml"), null);
  assert.equal(pictureType("text/html"), null);
  assert.equal(pictureType(undefined), null);
});

test("a person's photo may be PNG, JPEG or WebP; never a GIF or an SVG", () => {
  assert.equal(isFaceType("image/png"), true);
  assert.equal(isFaceType("image/jpeg"), true);
  assert.equal(isFaceType("image/webp"), true);
  assert.equal(isFaceType("image/gif"), false);
  assert.equal(isFaceType(null), false);
});

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

test("the bytes say what a picture is, whatever its label says", () => {
  assert.equal(sniffPictureType(bytes([0x89], "PNG\r\n\x1a\n", [0, 0, 0, 13])), "image/png");
  assert.equal(sniffPictureType(bytes([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffPictureType(bytes("GIF89a", [1, 0])), "image/gif");
  assert.equal(sniffPictureType(bytes("GIF87a")), "image/gif");
  assert.equal(sniffPictureType(bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ")), "image/webp");
  // An SVG, an HTML page, a RIFF that is not WebP, a truncated PNG, nothing at all.
  assert.equal(sniffPictureType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(sniffPictureType(bytes("<!doctype html><script>")), null);
  assert.equal(sniffPictureType(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt ")), null);
  assert.equal(sniffPictureType(bytes([0x89], "PNG")), null);
  assert.equal(sniffPictureType(new Uint8Array()), null);
});

/* --------------------------------------------------------------------- names */

test("a segment keeps letters, digits, _ and -, lowercased; never empty, never a dot", () => {
  assert.equal(cleanSegment("basma_tawfik", "x"), "basma_tawfik");
  assert.equal(cleanSegment("Show-Leadership-Keynote", "x"), "show-leadership-keynote");
  assert.equal(cleanSegment("Zoë Ångström", "x"), "zoe-angstrom");
  assert.equal(cleanSegment("../../etc/passwd", "x"), "etc-passwd");
  assert.equal(cleanSegment("..", "fallback"), "fallback");
  assert.equal(cleanSegment("", "fallback"), "fallback");
  assert.equal(cleanSegment(null, "fallback"), "fallback");
  assert.equal(cleanSegment("a b//c", "x"), "a-b-c");
  assert.equal(cleanSegment("-_-x-_-", "x"), "x");
  assert.equal(cleanSegment("abcdefghij", "x", 4), "abcd");
  assert.equal(cleanSegment("abc-defg", "x", 4), "abc", "a cut never ends on a hyphen");
  assert.equal(cleanSegment("مرحبا", "guest"), "guest");
});

test("Azure: a photo is faces/<event>/<slug>-<random>.<ext>", () => {
  assert.equal(faceBlobName(EVENT, "basma_tawfik", "a1b2c3d4e5", "image/webp"), `faces/${EVENT}/basma_tawfik-a1b2c3d4e5.webp`);
  assert.equal(faceBlobName(EVENT, "sara", "0f0f0f0f0f", "image/jpeg"), `faces/${EVENT}/sara-0f0f0f0f0f.jpg`);
  assert.equal(faceBlobName(EVENT, "x", "1", "image/png").endsWith(".png"), true);
  // Whatever arrives, the name stays inside its folders.
  const odd = faceBlobName("../evil", "../../a b", "../r", "image/png");
  assert.equal(odd, "faces/evil/a-b-r.png");
  assert.equal(validBlobName(odd), true);
});

test("Azure: a picture is moments/<event>/<moment>/<uuid>.<ext>", () => {
  assert.equal(momentBlobName(EVENT, "show-leadership-keynote", UUID, "image/png"), `moments/${EVENT}/show-leadership-keynote/${UUID}.png`);
  assert.equal(momentBlobName(EVENT, "filler-ambient", UUID, "image/gif"), `moments/${EVENT}/filler-ambient/${UUID}.gif`);
  assert.equal(momentBlobName(EVENT, "", UUID, "image/jpeg"), `moments/${EVENT}/moment/${UUID}.jpg`);
  assert.equal(momentBlobName(EVENT, "a/../../b", UUID, "image/webp"), `moments/${EVENT}/a-b/${UUID}.webp`);
});

test("Supabase keeps the keys it always had", () => {
  assert.equal(supabaseFaceKey("basma_tawfik", "image/png"), "basma_tawfik.png");
  assert.equal(supabaseFaceKey("basma_tawfik", "image/jpeg"), "basma_tawfik.jpg");
  assert.equal(supabaseFaceKey("basma_tawfik", "image/webp"), "basma_tawfik.webp");
  assert.equal(supabaseMomentKey(EVENT, "show-keynote", UUID, "image/jpeg"), `${EVENT}/show-keynote/${UUID}.jpg`);
  // The old sanitiser: characters dropped (case kept), 40 at most, "moment" when nothing is left.
  assert.equal(supabaseMomentKey(EVENT, "Show_Key note!", UUID, "image/png"), `${EVENT}/ShowKeynote/${UUID}.png`);
  assert.equal(supabaseMomentKey(EVENT, undefined, UUID, "image/png"), `${EVENT}/moment/${UUID}.png`);
  assert.equal(supabaseMomentKey(EVENT, "%%%", UUID, "image/png"), `${EVENT}/moment/${UUID}.png`);
  assert.equal(supabaseMomentKey(EVENT, "x".repeat(60), UUID, "image/png"), `${EVENT}/${"x".repeat(40)}/${UUID}.png`);
});

/* ------------------------------------------------------------- the addresses */

test("a new file's address: the container's own, or the CDN's when one is set", () => {
  const name = `faces/${EVENT}/sara-0f0f0f0f0f.webp`;
  assert.equal(azurePublicUrl(AZURE, name), `https://cibfiles.blob.core.windows.net/cib-launchpad/${name}`);
  assert.equal(azurePublicUrl(AZURITE, name), `http://127.0.0.1:10000/devstoreaccount1/cib-launchpad/${name}`);
  assert.equal(azurePublicUrl(CDN, name), `https://files.example.com/cib-launchpad/${name}`);
  // A SAS connection string puts its token on the container's URL: it never reaches an address.
  assert.equal(azurePublicUrl({ ...AZURE, containerUrl: `${AZURE.containerUrl}?sv=2024&sig=SECRET` }, name), `https://cibfiles.blob.core.windows.net/cib-launchpad/${name}`);
});

test("the longest photo address fits people.photo_path's 300 characters", () => {
  const name = faceBlobName(EVENT, "x".repeat(80), "a1b2c3d4e5", "image/webp");
  const url = azurePublicUrl({ containerUrl: `https://${"a".repeat(24)}.blob.core.windows.net/${"c".repeat(63)}`, container: "c".repeat(63) }, name);
  assert.ok(url.length <= 260, `${url.length}`);
});

test("an address of ours is read back into its blob name", () => {
  const name = `moments/${EVENT}/show-keynote/${UUID}.png`;
  for (const t of [AZURE, AZURITE, CDN]) assert.equal(azureBlobName(azurePublicUrl(t, name), t), name);
  // The container's own address still counts when a CDN is set (a file kept before the CDN was).
  assert.equal(azureBlobName(`https://cibfiles.blob.core.windows.net/cib-launchpad/${name}`, CDN), name);
  // The host's case does not matter; percent-encoding is undone; a query is not part of the name.
  assert.equal(azureBlobName(`https://CIBFILES.blob.core.windows.net/cib-launchpad/${name}`, AZURE), name);
  assert.equal(azureBlobName("https://cibfiles.blob.core.windows.net/cib-launchpad/faces/a%20b.png", AZURE), "faces/a b.png");
  assert.equal(azureBlobName(`https://cibfiles.blob.core.windows.net/cib-launchpad/${name}?v=2`, AZURE), name);
});

test("an address that is not ours is never read as one of our blobs", () => {
  const notOurs = [
    "https://cibfiles.blob.core.windows.net/other-container/faces/x.png", // another container
    "https://cibfiles.blob.core.windows.net/cib-launchpad-old/faces/x.png", // a container that only starts the same
    "https://someoneelse.blob.core.windows.net/cib-launchpad/faces/x.png", // another account
    "http://cibfiles.blob.core.windows.net/cib-launchpad/faces/x.png", // another scheme
    "https://cibfiles.blob.core.windows.net/cib-launchpad/", // the container itself
    "https://cibfiles.blob.core.windows.net/cib-launchpad", // likewise
    "https://cibfiles.blob.core.windows.net/cib-launchpad/faces/../../x.png", // URL parsing resolves it out of the container
    `${SUPABASE}/storage/v1/object/public/faces/sara.png`, // Supabase
    "https://media.licdn.com/dms/image/sara.jpg", // a pasted link
    "sara.png", // a bare key
    "not a url",
    "",
  ];
  for (const url of notOurs) assert.equal(azureBlobName(url, AZURE), null, url);
  assert.equal(azureBlobName("https://files.example.com/elsewhere/x.png", CDN), null);
  assert.equal(azureBlobName("http://127.0.0.1:10000/devstoreaccount2/cib-launchpad/x.png", AZURITE), null);
  // Encoded tricks. An encoded ".." segment resolves as a browser resolves it: still inside the
  // container it names that blob, one step further it is not ours. Encoded slashes that would
  // decode into a ".." or an empty segment are refused.
  const root = "https://cibfiles.blob.core.windows.net/cib-launchpad";
  assert.equal(azureBlobName(`${root}/faces/%2E%2E/x.png`, AZURE), "x.png");
  assert.equal(azureBlobName(`${root}/faces/%2e%2E/../x.png`, AZURE), null);
  assert.equal(azureBlobName(`${root}/a%2F..%2Fb.png`, AZURE), null);
  assert.equal(azureBlobName(`${root}/faces%2F%2Fx.png`, AZURE), null);
});

test("a blob name a delete may act on", () => {
  assert.equal(validBlobName("faces/e/x.png"), true);
  for (const bad of ["", "/x", "x/", "a//b", "a/./b", "a/../b", "a\\b", "x".repeat(1025)]) assert.equal(validBlobName(bad), false, bad);
});

test("every address one of our blobs goes by", () => {
  const name = `faces/${EVENT}/sara-0f0f0f0f0f.webp`;
  assert.deepEqual(azureAliases(AZURE, name), [`${AZURE.containerUrl}/${name}`]);
  assert.deepEqual(azureAliases(CDN, name), [`https://files.example.com/cib-launchpad/${name}`, `${AZURE.containerUrl}/${name}`]);
});

test("a Supabase Storage address of this project is read back into its bucket and key", () => {
  assert.deepEqual(parseSupabasePublicUrl(`${SUPABASE}/storage/v1/object/public/faces/sara.png`, SUPABASE), { bucket: "faces", key: "sara.png" });
  assert.deepEqual(parseSupabasePublicUrl(`${SUPABASE}/storage/v1/object/public/moments/${EVENT}/show-x/${UUID}.png`, `${SUPABASE}/`), {
    bucket: "moments",
    key: `${EVENT}/show-x/${UUID}.png`,
  });
  // lib/photos.ts encodes the whole key; getPublicUrl keeps the slashes. Both read the same.
  assert.deepEqual(parseSupabasePublicUrl(`${SUPABASE}/storage/v1/object/public/faces/a%2Fb%20c.png`, SUPABASE), { bucket: "faces", key: "a/b c.png" });
  assert.deepEqual(parseSupabasePublicUrl("http://127.0.0.1:54321/storage/v1/object/public/faces/x.png", "http://127.0.0.1:54321"), { bucket: "faces", key: "x.png" });
  for (const url of [
    "https://otherproject.supabase.co/storage/v1/object/public/faces/sara.png",
    `${SUPABASE}/storage/v1/object/sign/faces/sara.png`,
    `${SUPABASE}/storage/v1/object/public/faces`,
    `${SUPABASE}/storage/v1/object/public/faces/`,
    "sara.png",
  ]) {
    assert.equal(parseSupabasePublicUrl(url, SUPABASE), null, url);
  }
});

test("a face's every spelling: the bare key and both encodings of its address", () => {
  assert.equal(supabasePublicUrl(SUPABASE, "faces", "sara.png"), `${SUPABASE}/storage/v1/object/public/faces/sara.png`);
  assert.deepEqual(supabaseAliases(SUPABASE, "faces", "sara.png"), ["sara.png", `${SUPABASE}/storage/v1/object/public/faces/sara.png`]);
  assert.deepEqual(supabaseAliases(SUPABASE, "faces", "a b.png"), [
    "a b.png",
    `${SUPABASE}/storage/v1/object/public/faces/a%20b.png`,
  ]);
  assert.deepEqual(supabaseAliases("", "faces", "sara.png"), ["sara.png"]);
});

test("absolute or bare", () => {
  assert.equal(isAbsoluteUrl("https://x.y/z"), true);
  assert.equal(isAbsoluteUrl(" HTTP://x.y/z"), true);
  assert.equal(isAbsoluteUrl("sara.png"), false);
  assert.equal(isAbsoluteUrl("ftp://x.y/z"), false);
});
