"use client";

import { useEffect, useState } from "react";

// What a phone shows when a screen crashes, instead of Next.js's bare
// "Application error: a client-side exception has occurred".
//
// The usual crash in the field is an out-of-date app: the phone is still
// running the version from before a deploy and asks the server for a code
// file that deploy removed. A fresh load fixes it, so that case reloads on its
// own. Anything else shows a button, so a real bug can't loop reloads.

const LAST_AUTO_RELOAD_KEY = "crash:lastAutoReload";
// Only one automatic reload per this window; a second crash this soon means
// the reload didn't help, so stop and show the button.
const AUTO_RELOAD_WINDOW_MS = 30_000;

/** True when the crash is a missing code file — i.e. the app is out of date. */
function isStaleVersionError(error: Error): boolean {
  const text = `${error?.name ?? ""} ${error?.message ?? ""}`;
  return /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed|Failed to load module script/i.test(
    text
  );
}

function reloadedRecently(): boolean {
  try {
    const last = Number(sessionStorage.getItem(LAST_AUTO_RELOAD_KEY) || 0);
    return Date.now() - last < AUTO_RELOAD_WINDOW_MS;
  } catch {
    // Can't remember whether we already tried, so don't risk a reload loop.
    return true;
  }
}

function markAutoReload() {
  try {
    sessionStorage.setItem(LAST_AUTO_RELOAD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export default function CrashScreen({ error, reset }: { error: Error; reset?: () => void }) {
  const stale = isStaleVersionError(error);
  const [autoReloading, setAutoReloading] = useState(false);

  useEffect(() => {
    console.error(error);
    if (stale && !reloadedRecently()) {
      markAutoReload();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- shows "Updating…" while the reload starts
      setAutoReloading(true);
      window.location.reload();
    }
  }, [error, stale]);

  return (
    <div className="flex-1 min-h-[60vh] flex flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-lg font-semibold">
        {autoReloading ? "Updating the app…" : stale ? "The app was updated" : "Something went wrong"}
      </p>
      {!autoReloading && (
        <>
          <p className="text-sm text-muted max-w-xs">
            {stale
              ? "Reload to get the newest version."
              : "Reload the app to get back to where you were. If this keeps happening, let Kennen know what you tapped."}
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-lg bg-primary text-white font-medium"
            >
              Reload
            </button>
            {reset && !stale && (
              <button
                type="button"
                onClick={reset}
                className="px-5 py-2.5 rounded-lg border border-border font-medium"
              >
                Try again
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
