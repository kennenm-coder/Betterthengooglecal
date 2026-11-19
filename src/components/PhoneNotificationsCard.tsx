"use client";

import { useEffect, useState } from "react";
import { BellRing, Loader2, Check } from "lucide-react";
import { isPushOn, pushBlocker, sendTestPush, turnPushOff, turnPushOn, type PushBlocker } from "@/lib/push-client";

const BLOCKER_TEXT: Record<PushBlocker, string> = {
  "configured-off": "Phone notifications aren't switched on for Duck Force yet. Your bell still collects everything.",
  "ios-not-installed":
    "On iPhone, add Duck Force to your Home Screen first (Share → Add to Home Screen), then open it from that icon and come back here.",
  unsupported: "This browser can't do phone notifications. Your bell still collects everything.",
  denied:
    "Notifications are blocked for Duck Force on this device. Allow them in your browser or phone settings, then come back here.",
};

/**
 * Settings → Phone notifications. Turns buzzes on or off for THIS device —
 * each phone or computer is turned on separately. Whatever someone is sent
 * also lands in the bell at the top, on or off.
 */
export default function PhoneNotificationsCard() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [blocker, setBlocker] = useState<PushBlocker | null>(null);

  useEffect(() => {
    const b = pushBlocker();
    setBlocker(b);
    if (b) {
      setOn(false);
      return;
    }
    isPushOn().then(setOn);
  }, []);

  async function toggle() {
    setBusy(true);
    setMessage(null);
    if (on) {
      await turnPushOff();
      setOn(false);
    } else {
      const res = await turnPushOn();
      if (res.ok) {
        setOn(true);
        setMessage({ ok: true, text: "Turned on for this device." });
      } else if (res.error && res.error in BLOCKER_TEXT) {
        setBlocker(res.error as PushBlocker);
      } else {
        setMessage({ ok: false, text: res.error || "Couldn't turn it on." });
      }
    }
    setBusy(false);
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    const res = await sendTestPush();
    setMessage(res.ok ? { ok: true, text: "Sent. It should buzz in a few seconds." } : { ok: false, text: res.error || "Didn't send." });
    setBusy(false);
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <BellRing className="w-4 h-4 text-muted" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Phone Notifications</h2>
      </div>
      <div className="rounded-lg border border-border bg-surface px-3 py-3 space-y-3">
        {blocker ? (
          <p className="text-sm text-muted">{BLOCKER_TEXT[blocker]}</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              Get a buzz on this device when something needs you. Each phone or computer is turned on
              separately. Everything also shows in the bell at the top.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={toggle}
                disabled={busy || on === null}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${
                  on ? "border border-border text-foreground" : "bg-primary text-white"
                }`}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : on ? <Check className="w-4 h-4" /> : null}
                {on === null ? "Checking…" : on ? "On for this device — turn off" : "Turn on for this device"}
              </button>
              {on && (
                <button
                  onClick={test}
                  disabled={busy}
                  className="px-3 py-2 rounded-lg text-sm font-medium border border-border disabled:opacity-50"
                >
                  Send me a test
                </button>
              )}
            </div>
          </>
        )}
        {message && (
          <p className={`text-xs ${message.ok ? "text-green-700 dark:text-green-400" : "text-danger"}`}>{message.text}</p>
        )}
      </div>
    </section>
  );
}
