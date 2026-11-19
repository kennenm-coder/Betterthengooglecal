"use client";

import { useEffect, useState } from "react";
import { BellRing, Check, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { receivesNotifications } from "@/lib/roles";
import { isPushOn, pushBlocker, turnPushOn } from "@/lib/push-client";

/** Set once the person answers. Per device, because buzzes are per device:
 *  a new phone gets asked once too. */
const ANSWERED_KEY = "duckforce-push-invite-answered";

function answered(): boolean {
  try {
    return localStorage.getItem(ANSWERED_KEY) === "1";
  } catch {
    return false;
  }
}
function remember(): void {
  try {
    localStorage.setItem(ANSWERED_KEY, "1");
  } catch {
    /* private mode etc. — worst case they're asked again */
  }
}

/**
 * "Enable notifications?" — asked once per device on the calendar, Yes or No,
 * and never again after either answer (Kennen: offer it, don't nag).
 *
 * Not a pop-up, and the phone's own "Allow notifications?" box only appears
 * after they tap Yes. Settings → Phone Notifications is where to change their
 * mind later. Shown only to people who actually get notifications
 * (receivesNotifications), and only when this device can buzz and isn't
 * already on. An iPhone that isn't installed to the home screen can't buzz
 * yet, so it gets the one-line how-to with an OK instead.
 */
export default function PushInvite() {
  const { roles, loading } = useAuth();
  const eligible = !loading && receivesNotifications(roles);
  const [mode, setMode] = useState<"hidden" | "ask" | "ios" | "done">("hidden");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!eligible || answered()) return;
    const blocker = pushBlocker();
    if (blocker === "ios-not-installed") {
      setMode("ios");
      return;
    }
    // Server keys missing, browser can't, or they already blocked it: nothing to ask.
    if (blocker) return;
    let cancelled = false;
    isPushOn().then((on) => {
      if (!cancelled && !on) setMode("ask");
    });
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  if (mode === "hidden") return null;

  function no() {
    remember();
    setMode("hidden");
  }

  async function yes() {
    setBusy(true);
    setError("");
    const res = await turnPushOn();
    setBusy(false);
    remember();
    if (res.ok) {
      setMode("done");
      setTimeout(() => setMode("hidden"), 2500);
    } else {
      setError(
        res.error === "denied"
          ? "Blocked on this device. You can allow it later in your phone settings."
          : "Couldn't turn it on. You can try again in Settings."
      );
      setTimeout(() => setMode("hidden"), 4000);
    }
  }

  return (
    <div className="mx-3 mt-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 flex items-center gap-2.5 flex-wrap">
      <BellRing className="w-5 h-5 text-primary shrink-0" />
      {mode === "done" ? (
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Check className="w-4 h-4 text-green-600" /> Notifications enabled.
        </p>
      ) : mode === "ios" ? (
        <>
          <p className="text-sm flex-1 min-w-[12rem]">
            <span className="font-medium">Enable notifications:</span> first tap Share → Add to Home Screen, then open
            Duck Force from that icon.
          </p>
          <button onClick={no} className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border">
            OK
          </button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium flex-1">Enable notifications?</p>
          <div className="flex gap-2">
            <button
              onClick={yes}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Yes
            </button>
            <button
              onClick={no}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border disabled:opacity-60"
            >
              No
            </button>
          </div>
          {error && <p className="w-full text-xs text-danger">{error}</p>}
        </>
      )}
    </div>
  );
}
