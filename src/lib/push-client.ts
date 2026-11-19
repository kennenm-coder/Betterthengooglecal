// Browser side of phone notifications: turn this device on / off and send a
// test. The server side (who gets what) is src/lib/notify-server.ts.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

/** Why push can't work on this device, in words for the Settings card. */
export type PushBlocker =
  | "configured-off" // server keys not set yet
  | "ios-not-installed" // iPhone/iPad in Safari, not opened from the home screen
  | "unsupported" // browser has no push at all
  | "denied"; // the person blocked notifications for this site

export function pushBlocker(): PushBlocker | null {
  if (typeof window === "undefined") return "unsupported";
  if (!VAPID_PUBLIC_KEY) return "configured-off";
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (iOS && !standalone) return "ios-not-installed";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return null;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Resolve `p`, or `null` after `ms` — a hidden permission prompt or a service
 *  worker that never gets ready would otherwise leave the button spinning. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (!existing) await navigator.serviceWorker.register("/sw.js");
    return await within(navigator.serviceWorker.ready, 10_000);
  } catch {
    return null;
  }
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows computer";
  if (/Mac/.test(ua)) return "Mac";
  return "Browser";
}

/** Is THIS device turned on? */
export async function isPushOn(): Promise<boolean> {
  if (pushBlocker()) return false;
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return !!sub;
}

export async function turnPushOn(): Promise<{ ok: boolean; error?: string }> {
  const blocker = pushBlocker();
  if (blocker) return { ok: false, error: blocker };

  const permission = await within(Notification.requestPermission(), 60_000);
  if (permission !== "granted") {
    return { ok: false, error: permission === "denied" ? "denied" : "You didn't allow notifications." };
  }
  const reg = await registration();
  if (!reg) return { ok: false, error: "The app's background worker didn't start. Reload and try again." };

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await within(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
        }),
        20_000
      );
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    if (!sub) return { ok: false, error: "The browser didn't answer. Try again." };
  }

  const json = sub.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint, keys: json.keys, deviceLabel: deviceLabel() }),
  }).catch(() => null);
  if (!res?.ok) {
    const msg = res ? ((await res.json().catch(() => null))?.error as string | undefined) : undefined;
    return { ok: false, error: msg || "Couldn't save this device. Try again." };
  }
  return { ok: true };
}

export async function turnPushOff(): Promise<void> {
  const reg = await registration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function sendTestPush(): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/push/test", { method: "POST" }).catch(() => null);
  if (!res) return { ok: false, error: "No connection." };
  const json = await res.json().catch(() => ({}));
  return res.ok ? { ok: true } : { ok: false, error: json.error || "The test didn't send." };
}

/** Fire-and-forget: a Write-Up Rep's save → field managers' bell + buzz. The
 *  server checks the role itself; for anyone else it does nothing. */
export function notifyWriteUpRepChange(event: "submitted" | "edited", orderNumber: string, customerName: string): void {
  fetch("/api/notify/writeup-rep", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, orderNumber, customerName }),
    keepalive: true,
  }).catch(() => {});
}
