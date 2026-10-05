"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { uploadSitePicture } from "./upload";

/**
 * THE HERO PHOTO — wide on a desktop, 4:3 on a phone, rounded, served at the size each screen
 * needs (next/image). In edit mode two buttons sit on it: Replace photo (from the computer or the
 * phone; made web-sized and kept in Supabase Storage, components/site/upload.ts) and, once it has
 * been replaced, Reset to the photo the page shipped with.
 */
export function EditImage({
  src,
  alt,
  editing,
  defaultSrc,
  onChange,
}: {
  src: string;
  alt: string;
  editing: boolean;
  defaultSrc: string;
  onChange: (src: string) => void;
}) {
  const file = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const frame = (
    <div className="st-frame">
      <Image src={src} alt={alt} fill priority sizes="(max-width: 1200px) 100vw, 1100px" />
    </div>
  );
  if (!editing) return frame;

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError("");
    try {
      const up = await uploadSitePicture(f, "hero");
      onChange(up.src);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That photo did not upload.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="st-imgedit">
      {frame}
      <div className="st-imgtools">
        <button type="button" className="st-chip dark" onClick={() => file.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : "Replace photo"}
        </button>
        {src !== defaultSrc && !busy ? (
          <button type="button" className="st-chip" onClick={() => onChange(defaultSrc)}>
            Reset
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="st-error" role="alert">
          {error}
        </p>
      ) : null}
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void pick(f);
        }}
      />
    </div>
  );
}
