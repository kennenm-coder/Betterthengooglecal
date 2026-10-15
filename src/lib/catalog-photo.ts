// ─── CATALOG PHOTOS ─────────────────────────────────────────────────────────
// One optional picture per service part or parts bundle, shown ONLY on the
// Manage Catalogs screen. It never reaches a write-up, a PDF, an email, an
// install doc or the Job Auditor — it exists so somebody maintaining the
// catalog can tell at a glance which part a row means.
//
// Files live in the shared `catalog-photos` bucket (migration 031), which is
// public-read: these are pictures of window parts, and a public bucket means a
// plain <img src> works instead of every row needing a signed URL that expires
// while the modal is open. Writing is gated by the bucket policy — admin,
// field-manager, or configuring-editing.
//
// The same bucket and the same folders ("parts" / "bundles") are used by the
// NWO material-list app's copy of this editor, so a photo added in either app
// shows up in both.
//
// Everything is downscaled in the browser BEFORE upload. A phone photo is
// 3-6 MB and a catalog thumbnail needs none of that: 1000px on the long edge at
// JPEG 0.72 lands around 80-150 KB. That matters three times over — upload time
// on a job site, storage, and the egress every catalog view would otherwise pay.

import { getSupabase } from "./supabase";

const BUCKET = "catalog-photos";

/** Long edge, in pixels, after downscaling. Big enough to tell two parts apart. */
const MAX_EDGE = 1000;
const JPEG_QUALITY = 0.72;

/** Refuse obvious non-images early, with a sentence rather than a stack trace. */
const OK_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/i;

export type PhotoResult = { ok: boolean; path: string | null; error: string | null };

/**
 * createImageBitmap handles orientation and is far faster, but Safari only got
 * it recently and it rejects HEIC. Fall back to an <img> via object URL, which
 * works wherever the browser can decode the format at all.
 */
async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That file isn't an image this browser can read."));
      img.src = url;
    });
  } finally {
    // Revoked on the next tick, so the decode has definitely finished with it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Read a File, draw it to a canvas at no more than MAX_EDGE on its long edge,
 * and return a JPEG Blob. Images already smaller are still re-encoded — a 600px
 * PNG screenshot can easily be larger than the JPEG we want.
 */
async function downscale(file: File): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image.");
  // White underneath, so a transparent PNG doesn't become a black rectangle
  // once it is flattened into a JPEG.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("Couldn't process that image.");
  return blob;
}

function photoError(error: { message?: string } | null): string {
  const msg = error?.message || "";
  if (/row-level security|not authorized|permission/i.test(msg)) {
    return "This account can't change catalog photos.";
  }
  if (/bucket not found/i.test(msg)) {
    return "The catalog-photos bucket doesn't exist yet — migration 031 hasn't been run.";
  }
  return msg || "Couldn't save that photo.";
}

/**
 * Downscale and upload, returning { ok, path, error }. `folder` separates the
 * catalogs ("parts" / "bundles") so the bucket stays readable, and each upload
 * gets a fresh filename rather than overwriting — a stale cached image is a
 * worse bug than an orphaned file, and replaceCatalogPhoto() deletes the old
 * one once the new path is safely in hand.
 */
export async function uploadCatalogPhoto(file: File, folder: string): Promise<PhotoResult> {
  if (!file) return { ok: false, path: null, error: "No file chosen." };
  if (!OK_TYPES.test(file.type || "")) {
    return { ok: false, path: null, error: "That needs to be a photo — JPEG, PNG, WebP or HEIC." };
  }
  // 25 MB in, ~100 KB out. The cap is only here to stop a wrong file (a video,
  // a RAW) from being decoded into memory before we find out.
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, path: null, error: "That image is very large — try a normal phone photo." };
  }
  const supabase = getSupabase();
  if (!supabase) return { ok: false, path: null, error: "Not signed in." };

  let blob: Blob;
  try {
    blob = await downscale(file);
  } catch (e) {
    return { ok: false, path: null, error: (e as Error)?.message || "Couldn't process that image." };
  }
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  try {
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: "image/jpeg",
      cacheControl: "31536000", // immutable: the filename changes when the image does
      upsert: false,
    });
    if (error) return { ok: false, path: null, error: photoError(error) };
    return { ok: true, path, error: null };
  } catch (e) {
    return { ok: false, path: null, error: (e as Error)?.message || "Couldn't upload that photo." };
  }
}

/** Remove a photo. A failure here is cosmetic — the row already points elsewhere. */
export async function deleteCatalogPhoto(path: string | null): Promise<{ ok: boolean; error: string | null }> {
  if (!path) return { ok: true, error: null };
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Not signed in." };
  try {
    const { error } = await supabase.storage.from(BUCKET).remove([path]);
    if (error) return { ok: false, error: photoError(error) };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "Couldn't delete that photo." };
  }
}

/**
 * Upload the replacement first, then drop the old file — never the other way
 * round. If the upload fails, the record keeps the picture it had.
 */
export async function replaceCatalogPhoto(file: File, folder: string, oldPath: string | null): Promise<PhotoResult> {
  const res = await uploadCatalogPhoto(file, folder);
  if (!res.ok) return res;
  if (oldPath) await deleteCatalogPhoto(oldPath);
  return res;
}

/** Public URL for an <img src>. Returns null for a record with no photo. */
export function catalogPhotoUrl(path: string | null): string | null {
  if (!path) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl || null;
  } catch {
    return null;
  }
}
