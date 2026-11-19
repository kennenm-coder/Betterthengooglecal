// ─── The one notification channel (server only) ────────────────────────────
//
// Everything the calendar notifies anybody about goes through notify():
//   1. a row in `notifications` per person — the bell's history, which works
//      for everyone whether or not they turned phone buzzes on
//   2. a web push to every device that person subscribed (Settings → Phone
//      notifications), if the VAPID keys are configured
//
// What TRIGGERS a notification is the caller's business: an API route the
// moment something happens (a Write-Up Rep saving), or the daily cron
// (/api/cron/daily) for anything time-based like Job Alert. Either way it ends
// up here, so adding a new kind of notification is one notify() call.
//
// Delivery: Google / Apple / Mozilla push services, signed with this app's
// VAPID keys. No Vercel feature and no cost. Migration 063 holds the tables.

import webpush from "web-push";
import { getAdminClient } from "@/lib/auth";

const APP = "calendar";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "";

let vapidSet = false;
/** True once the keys are present and handed to web-push. Blank keys = the
 *  bell still fills, phones just don't buzz (same "dormant until set" pattern
 *  as the Gmail write-up sender). */
export function pushConfigured(): boolean {
  if (vapidSet) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_SUBJECT) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  vapidSet = true;
  return true;
}

/** Kinds of notification. Add one here when a new trigger is built. */
export type NotificationKind =
  | "test"
  | "writeup_rep_submitted"
  | "writeup_rep_edited";

export interface NotifyInput {
  /** Who it's for (login emails). Duplicates and blanks are dropped. */
  emails: string[];
  kind: NotificationKind;
  title: string;
  body: string;
  /** Where tapping it goes, e.g. "/work-orders". */
  url?: string;
  /** Phones replace an older notification with the same tag instead of
   *  stacking them — e.g. one per job, so five edits = one buzz on screen. */
  tag?: string;
}

export interface NotifyResult {
  /** People it was saved for (bell rows written). */
  saved: number;
  /** Devices that accepted the push. */
  pushed: number;
  /** Dead subscriptions (phone uninstalled, permission revoked) removed. */
  pruned: number;
  pushConfigured: boolean;
}

/** Login emails holding any of the given roles (roles[] or the legacy role). */
export async function emailsWithRole(roles: string[]): Promise<string[]> {
  const admin = getAdminClient();
  const { data, error } = await admin.from("allowed_emails").select("email, role, roles");
  if (error || !data) return [];
  return data
    .filter((r) => {
      const held: string[] = Array.isArray(r.roles) && r.roles.length ? r.roles : r.role ? [r.role] : [];
      return held.some((x) => roles.includes(x));
    })
    .map((r) => String(r.email || "").toLowerCase())
    .filter(Boolean);
}

export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const result: NotifyResult = { saved: 0, pushed: 0, pruned: 0, pushConfigured: pushConfigured() };
  if (emails.length === 0) return result;

  const admin = getAdminClient();

  // 1. The bell. Saved first: a push that fails still leaves the history.
  const { error: insertError } = await admin.from("notifications").insert(
    emails.map((email) => ({
      email,
      app: APP,
      kind: input.kind,
      title: input.title,
      body: input.body,
      url: input.url || null,
    }))
  );
  if (insertError) console.error("notify: saving to the bell failed:", insertError.message);
  else result.saved = emails.length;

  // 2. The buzz.
  if (!result.pushConfigured) return result;
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, email, endpoint, p256dh, auth")
    .eq("app", APP)
    .in("email", emails);
  if (!subs?.length) return result;

  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    url: input.url || "/",
    tag: input.tag || input.kind,
    kind: input.kind,
  });

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24 }
        );
        result.pushed += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404 / 410: the browser says this subscription is gone for good.
        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
          result.pruned += 1;
        } else {
          console.error("notify: push failed", status, (err as Error).message);
        }
      }
    })
  );
  return result;
}

/** Save (or take over) this device's subscription for the signed-in person. */
export async function saveSubscription(
  email: string,
  sub: { endpoint: string; p256dh: string; auth: string },
  deviceLabel: string
): Promise<string | null> {
  const admin = getAdminClient();
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      email: email.toLowerCase(),
      app: APP,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      device_label: deviceLabel.slice(0, 120) || null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" }
  );
  return error ? error.message : null;
}

/** Forget this device for this person (Turn off). */
export async function removeSubscription(email: string, endpoint: string): Promise<void> {
  const admin = getAdminClient();
  await admin
    .from("push_subscriptions")
    .delete()
    .eq("email", email.toLowerCase())
    .eq("endpoint", endpoint);
}

/** Housekeeping for the daily cron: the bell keeps 90 days. */
export async function purgeOldNotifications(days = 90): Promise<number> {
  const admin = getAdminClient();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("notifications")
    .delete({ count: "exact" })
    .eq("app", APP)
    .lt("created_at", cutoff);
  return count || 0;
}
