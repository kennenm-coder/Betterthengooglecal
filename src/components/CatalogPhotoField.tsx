"use client";

// ─── CATALOG PHOTO FIELD ────────────────────────────────────────────────────
// The add / replace / remove control for the one optional picture a part or a
// bundle may carry, plus the thumbnail used on the catalog rows. Mirrors the
// material-list app's control so the two editors behave the same way.
//
// The photo is a catalog-screen aid only: it never appears on a write-up, a
// PDF, an email, an install doc, or anything the field or the customer sees.
//
// Uploading happens as soon as a file is picked, not on save, so the person can
// see what they chose before committing the rest of the form. That trades a
// possible orphaned file (picked a photo, then hit Cancel) against never showing
// a thumbnail that isn't really there — the better way round, since an orphan
// costs a few KB and a lie costs trust in the screen.

import { useRef, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { catalogPhotoUrl, deleteCatalogPhoto, replaceCatalogPhoto } from "@/lib/catalog-photo";

/** Just the picture — for the collapsed rows. Renders nothing without a photo. */
export function CatalogThumb({ path, alt }: { path: string | null; alt?: string }) {
  const url = catalogPhotoUrl(path);
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt || ""}
      loading="lazy"
      className="w-9 h-9 shrink-0 rounded-md object-cover border border-border bg-background"
    />
  );
}

export default function CatalogPhotoField({
  path,
  folder,
  onChange,
  hint,
}: {
  path: string | null;
  /** "parts" or "bundles" — keeps the shared bucket readable. */
  folder: "parts" | "bundles";
  onChange: (path: string | null) => void;
  hint?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const url = catalogPhotoUrl(path);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Cleared immediately, so picking the same file twice still fires onChange.
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    const res = await replaceCatalogPhoto(file, folder, path);
    setBusy(false);
    if (!res.ok) { setError(res.error || "Couldn't save that photo."); return; }
    onChange(res.path);
  }

  async function remove() {
    setBusy(true);
    setError("");
    const res = await deleteCatalogPhoto(path);
    setBusy(false);
    // Even when the file couldn't be removed from storage, drop the reference:
    // a row still pointing at a photo the person asked to delete is worse than
    // leaving the bytes behind.
    onChange(null);
    if (!res.ok) setError(res.error || "");
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" loading="lazy" className="w-20 h-20 shrink-0 rounded-lg object-cover border border-border bg-surface" />
        ) : (
          <div className="w-20 h-20 shrink-0 rounded-lg border border-dashed border-border bg-surface flex items-center justify-center text-muted">
            <ImageOff className="w-5 h-5" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-dashed border-amber-500/60 text-amber-600 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {busy ? "Working…" : url ? "Replace photo" : "Add photo"}
            </button>
            {url && !busy && (
              <button type="button" onClick={remove} className="px-3 py-1.5 rounded-lg border border-danger/40 text-danger text-xs font-semibold">
                Remove
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted mt-1.5 leading-snug">
            {hint || "Shown on this screen only — never on a write-up, a PDF or an email."}{" "}
            Shrunk before uploading, so a phone photo is fine.
          </p>
          {error && <p className="text-[11px] text-danger font-semibold mt-1.5">{error}</p>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={pick} className="hidden" />
    </div>
  );
}
