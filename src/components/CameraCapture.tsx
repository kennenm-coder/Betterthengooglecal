"use client";

import { useEffect, useRef, useState } from "react";
import { X, Check, Trash2, Camera, AlertCircle } from "lucide-react";

interface CapturedShot {
  id: string;
  url: string;
  file: File;
}

/**
 * Full-screen in-app burst camera. The stream stays open so the user can snap
 * several photos in a row, then tap Done to hand them all back at once — no
 * closing the camera between shots.
 *
 * Requests the device's max resolution (up to 4K) so small text (e.g. window
 * sticker numbers) stays as readable as the browser allows. The captured
 * resolution is shown so it can be verified on real phones.
 */
export default function CameraCapture({
  onDone,
  onClose,
}: {
  /** Called with every captured photo when the user finishes. */
  onDone: (files: File[]) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shotsRef = useRef<CapturedShot[]>([]);
  const [shots, setShots] = useState<CapturedShot[]>([]);
  const [error, setError] = useState("");
  const [res, setRes] = useState("");
  const [ready, setReady] = useState(false);

  // Keep a ref in sync so unmount cleanup can revoke object URLs without
  // capturing a stale (empty) shots array.
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
        const s = stream.getVideoTracks()[0]?.getSettings();
        if (s?.width && s?.height) setRes(`${s.width}×${s.height}`);
        setReady(true);
      } catch {
        setError(
          "Couldn't open the camera. Check that the app is allowed to use the camera, then try again."
        );
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    };
  }, []);

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = canvasRef.current || document.createElement("canvas");
    canvasRef.current = canvas;
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`;
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
        setShots((prev) => [...prev, { id, url: URL.createObjectURL(blob), file }]);
      },
      "image/jpeg",
      0.92
    );
  }

  function removeShot(id: string) {
    setShots((prev) => {
      const target = prev.find((s) => s.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((s) => s.id !== id);
    });
  }

  // Always hand back whatever was taken — a shot is never silently discarded.
  function finish() {
    onDone(shots.map((s) => s.file));
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black flex flex-col">
      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-3">
          <AlertCircle className="w-10 h-10 text-amber-500" />
          <p className="text-white font-medium">{error}</p>
          <button
            onClick={onClose}
            className="mt-2 px-5 py-3 rounded-xl bg-white text-black text-sm font-semibold"
          >
            Close
          </button>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />

          {/* Top bar: done/close + resolution readout */}
          <div className="relative z-10 flex items-center justify-between px-4 pt-4">
            <button
              onClick={finish}
              className="w-10 h-10 rounded-full bg-black/50 text-white flex items-center justify-center"
              aria-label={shots.length ? "Done" : "Close camera"}
            >
              <X className="w-6 h-6" />
            </button>
            {res && (
              <span className="text-[11px] font-medium text-white/80 bg-black/40 px-2 py-1 rounded-full">
                {res}
              </span>
            )}
          </div>

          <div className="flex-1" />

          {/* Thumbnail tray of shots taken so far */}
          {shots.length > 0 && (
            <div className="relative z-10 flex gap-2 overflow-x-auto px-4 pb-3">
              {shots.map((s) => (
                <div key={s.id} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.url}
                    alt=""
                    className="w-16 h-16 object-cover rounded-lg border border-white/30"
                  />
                  <button
                    onClick={() => removeShot(s.id)}
                    className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-black/70 text-white"
                    aria-label="Remove photo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Bottom controls: shutter + Done */}
          <div className="relative z-10 flex items-center justify-between px-6 pb-8">
            <div className="w-20 text-white/80 text-sm font-medium">
              {shots.length > 0 ? `${shots.length} taken` : ""}
            </div>
            <button
              onClick={shoot}
              disabled={!ready}
              className="w-18 h-18 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition-transform"
              style={{ width: 76, height: 76 }}
              aria-label="Take photo"
            >
              <span className="w-14 h-14 rounded-full bg-white" />
            </button>
            <div className="w-20 flex justify-end">
              {shots.length > 0 ? (
                <button
                  onClick={finish}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-amber-500 text-white text-sm font-semibold"
                >
                  <Check className="w-4 h-4" />
                  Done
                </button>
              ) : (
                <Camera className="w-6 h-6 text-white/50" />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
