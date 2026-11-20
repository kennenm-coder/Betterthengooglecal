"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useBackClose } from "@/hooks/useBackClose";

/**
 * A photo from a GroupMe chat, full screen INSIDE Duck Force -- tapping a photo
 * used to open it in a web browser tab. Tap anywhere, the X, Escape, or the
 * phone's Back button to close (Back closes the photo, not the app).
 */
export default function PhotoViewer({ url, onClose }: { url: string; onClose: () => void }) {
  useBackClose(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-label="Photo"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt="Shared photo"
        referrerPolicy="no-referrer"
        className="max-w-full max-h-full object-contain select-none"
      />
      <button
        onClick={onClose}
        aria-label="Close photo"
        className="absolute right-3 w-10 h-10 rounded-full bg-black/60 text-white flex items-center justify-center"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
