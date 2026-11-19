"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, Check, Download, Loader2, Share } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { receivesNotifications } from "@/lib/roles";
import { isPushOn, pushBlocker, turnPushOn } from "@/lib/push-client";

// Each question is asked ONCE per device and never again after any answer
// (Kennen: offer it, don't nag). Per device, because buzzes and installs are
// per device. An iPhone's home-screen copy of Duck Force keeps its own storage,
// so once installed it gets its one "Enable notifications?" there — the copy
// that can actually buzz.
const PUSH_ANSWERED = "duckforce-push-invite-answered";
const INSTALL_ANSWERED = "duckforce-install-invite-answered";

function answered(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function remember(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* private mode etc. — worst case they're asked again */
  }
}

/** Chrome's "install this app" offer, caught early in layout.tsx. */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
function installPrompt(): InstallPrompt | null {
  return (window as Window & { __duckInstallPrompt?: InstallPrompt }).__duckInstallPrompt ?? null;
}

/** Chrome's offer can only be used once. */
function clearInstallPrompt(): void {
  (window as Window & { __duckInstallPrompt?: InstallPrompt | null }).__duckInstallPrompt = null;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

type Mode = "hidden" | "push" | "install" | "ios" | "done";

/**
 * The calendar's one-time questions, one at a time, never as a pop-up:
 *   - "Enable notifications?" Yes / No — the phone's own Allow box only
 *     appears after Yes.
 *   - Android / computer, not installed: "Install Duck Force?" Yes / No — one
 *     tap, then Chrome's own Install confirm. Asked only once the
 *     notifications question is settled, so there's never two at once.
 *   - iPhone in Safari: Apple allows no install button, so the three taps are
 *     spelled out, with Got it / No thanks. Push can't work there until it's
 *     installed, so this is the only question Safari gets.
 * Only for people who get notifications (receivesNotifications). Settings →
 * Phone Notifications is where to change their mind later.
 */
export default function PushInvite() {
  const { roles, loading } = useAuth();
  const eligible = !loading && receivesNotifications(roles);
  const [mode, setMode] = useState<Mode>("hidden");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneText, setDoneText] = useState("");
  // What's showing right now, readable from the install-offer listener below
  // so a late install offer never replaces a question that's on screen.
  const modeRef = useRef<Mode>("hidden");
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;

    const offerInstall = () => {
      if (cancelled || modeRef.current !== "hidden") return;
      if (!isStandalone() && !answered(INSTALL_ANSWERED) && installPrompt()) setMode("install");
    };

    const blocker = pushBlocker();
    if (blocker === "ios-not-installed") {
      // Either answer to the earlier one-line iPhone card counts too.
      if (!answered(INSTALL_ANSWERED) && !answered(PUSH_ANSWERED)) setMode("ios");
      return;
    }

    if (!blocker && !answered(PUSH_ANSWERED)) {
      isPushOn().then((on) => {
        if (cancelled) return;
        if (!on) return setMode("push");
        // Already on (turned on in Settings): nothing left to ask about it.
        remember(PUSH_ANSWERED);
        offerInstall();
      });
    } else {
      offerInstall();
    }

    // Chrome may hand over its install offer a moment after the page loads.
    // Only after the notifications question is settled, so never two at once.
    const onReady = () => {
      if (answered(PUSH_ANSWERED) || pushBlocker()) offerInstall();
    };
    window.addEventListener("duck-install-ready", onReady);
    return () => {
      cancelled = true;
      window.removeEventListener("duck-install-ready", onReady);
    };
  }, [eligible]);

  if (mode === "hidden") return null;

  function finish(text: string) {
    setDoneText(text);
    setMode("done");
    setTimeout(() => setMode("hidden"), 2500);
  }

  async function pushYes() {
    setBusy(true);
    setError("");
    const res = await turnPushOn();
    setBusy(false);
    remember(PUSH_ANSWERED);
    if (res.ok) return finish("Notifications enabled.");
    setError(
      res.error === "denied"
        ? "Blocked on this device. You can allow it later in your phone settings."
        : "Couldn't turn it on. You can try again in Settings."
    );
    setTimeout(() => setMode("hidden"), 4000);
  }

  async function installYes() {
    const evt = installPrompt();
    remember(INSTALL_ANSWERED);
    if (!evt) return setMode("hidden");
    setBusy(true);
    try {
      await evt.prompt();
      const choice = await evt.userChoice;
      clearInstallPrompt();
      setBusy(false);
      if (choice.outcome === "accepted") return finish("Duck Force is on your home screen.");
    } catch {
      setBusy(false);
    }
    setMode("hidden");
  }

  function no(key: string) {
    remember(key);
    setMode("hidden");
  }

  const yesNo = (onYes: () => void, key: string) => (
    <div className="flex gap-2">
      <button
        onClick={onYes}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-60"
      >
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        Yes
      </button>
      <button
        onClick={() => no(key)}
        disabled={busy}
        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border disabled:opacity-60"
      >
        No
      </button>
    </div>
  );

  return (
    <div className="mx-3 mt-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 flex items-center gap-2.5 flex-wrap">
      {mode === "install" || mode === "ios" ? (
        <Download className="w-5 h-5 text-primary shrink-0" />
      ) : (
        <BellRing className="w-5 h-5 text-primary shrink-0" />
      )}

      {mode === "done" && (
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Check className="w-4 h-4 text-green-600" /> {doneText}
        </p>
      )}

      {mode === "push" && (
        <>
          <p className="text-sm font-medium flex-1">Enable notifications?</p>
          {yesNo(pushYes, PUSH_ANSWERED)}
          {error && <p className="w-full text-xs text-danger">{error}</p>}
        </>
      )}

      {mode === "install" && (
        <>
          <p className="text-sm font-medium flex-1">Add Duck Force to your home screen?</p>
          {yesNo(installYes, INSTALL_ANSWERED)}
        </>
      )}

      {mode === "ios" && (
        <>
          <div className="flex-1 min-w-[13rem]">
            <p className="text-sm font-medium">Add Duck Force to your home screen?</p>
            <p className="text-xs text-muted mt-0.5 flex flex-wrap items-center gap-x-1">
              Tap <Share className="w-3.5 h-3.5 inline text-primary" aria-label="Share" /> Share at the bottom of
              Safari, then <span className="font-medium text-foreground">Add to Home Screen</span>, then
              <span className="font-medium text-foreground">Add</span>. Open it from that icon to turn on
              notifications.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => no(INSTALL_ANSWERED)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white"
            >
              Got it
            </button>
            <button
              onClick={() => no(INSTALL_ANSWERED)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border"
            >
              No thanks
            </button>
          </div>
        </>
      )}
    </div>
  );
}
