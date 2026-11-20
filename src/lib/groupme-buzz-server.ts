// ─── Phone buzz for new GroupMe messages (server only) ──────────────────────
//
// Run once a minute by /api/cron/groupme. For every person who connected their
// GroupMe and left "Buzz my phone" on, it looks at the chats they ticked and,
// for each chat with new messages from someone else, sends ONE buzz:
//
//     Mike's crew
//     3 new messages · Mike: running 20 min late
//
// The tag is per chat, so a phone replaces that chat's older buzz rather than
// stacking a pile of them.
//
// What it keeps: only the id of the newest message each person was buzzed
// about (groupme_chat_picks.last_notified_message_id, migration 068), so the
// same messages never buzz twice. Message text is read from GroupMe to write
// the buzz and then dropped. It's push only, never saved to the bell's history,
// because the GroupMe licence (§4.5) says we must not keep their data.
//
// The first check after someone ticks a chat (or turns buzzing on) only takes
// a bookmark, so nobody gets buzzed about old messages.

import { getAdminClient } from "@/lib/auth";
import { decryptToken } from "@/lib/groupme-crypto";
import { getMessages, getMyGroupIndex, GroupMeError } from "@/lib/groupme";
import { notify } from "@/lib/notify-server";

interface TokenRow {
  user_id: string;
  email: string;
  access_token_encrypted: string;
  groupme_user_id: string | null;
}

interface PickRow {
  group_id: string;
  group_name: string | null;
  last_read_message_id: string | null;
  last_notified_message_id: string | null;
}

export interface BuzzResult {
  people: number;
  chatsChecked: number;
  buzzes: number;
  errors: number;
}

/** GroupMe message ids are increasing numbers. The newer of two (either may be missing). */
function newer(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  try {
    return BigInt(a) >= BigInt(b) ? a : b;
  } catch {
    return a;
  }
}

function clip(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

async function setNotified(userId: string, groupId: string, messageId: string) {
  await getAdminClient()
    .from("groupme_chat_picks")
    .update({ last_notified_message_id: messageId })
    .eq("user_id", userId)
    .eq("group_id", groupId);
}

export async function runGroupMeBuzz(): Promise<BuzzResult> {
  const admin = getAdminClient();
  const result: BuzzResult = { people: 0, chatsChecked: 0, buzzes: 0, errors: 0 };

  const { data: tokens, error } = await admin
    .from("groupme_tokens")
    .select("user_id, email, access_token_encrypted, groupme_user_id");
  if (error) throw new Error(`Could not read GroupMe connections: ${error.message}`);

  // Who switched message buzzes off (groupme_prefs, migration 074).
  const { data: off } = await admin.from("groupme_prefs").select("user_id").eq("notify_messages", false);
  const muted = new Set((off ?? []).map((r) => String(r.user_id)));

  for (const t of (tokens ?? []) as TokenRow[]) {
    if (muted.has(t.user_id)) continue;
    try {
      // Personal chats only. Office-account chats are shared with the Duck
      // Force Bot when an admin shares them, and the bot buzzes instantly.
      const { data: picks } = await admin
        .from("groupme_chat_picks")
        .select("group_id, group_name, last_read_message_id, last_notified_message_id")
        .eq("user_id", t.user_id)
        .eq("source", "personal");
      if (!picks?.length) continue;

      let token: string;
      try {
        token = decryptToken(t.access_token_encrypted);
      } catch {
        continue; // Wrong key or a bad row -- they show as not connected anyway.
      }
      result.people += 1;

      // One GroupMe call covers every chat's newest message id.
      const index = await getMyGroupIndex(t.user_id, token);

      for (const p of picks as PickRow[]) {
        const group = index.get(p.group_id);
        if (!group?.lastId) continue;
        result.chatsChecked += 1;

        // Everything up to here was already buzzed about or read in the app.
        const seen = newer(p.last_notified_message_id, p.last_read_message_id);
        if (!seen) {
          await setNotified(t.user_id, p.group_id, group.lastId); // first look: bookmark only
          continue;
        }
        if (newer(seen, group.lastId) === seen) continue; // nothing new

        const fresh = (
          await getMessages(token, p.group_id, { sinceId: seen, limit: 100 })
        ).filter((m) => !m.system && m.user_id !== t.groupme_user_id);

        if (fresh.length > 0) {
          // GroupMe answers newest first.
          const latest = fresh[0];
          const text = latest.text?.trim()
            ? clip(latest.text)
            : latest.attachments?.some((a) => a.type === "image")
              ? "sent a photo"
              : "sent a message";
          const line = `${latest.name}: ${text}`;
          await notify({
            emails: [t.email],
            kind: "groupme_message",
            title: group.name || p.group_name || "GroupMe",
            body: fresh.length === 1 ? line : `${fresh.length} new messages · ${line}`,
            url: "/chat",
            tag: `groupme-${p.group_id}`,
            pushOnly: true,
          });
          result.buzzes += 1;
        }
        await setNotified(t.user_id, p.group_id, group.lastId);
      }
    } catch (e) {
      // One person's GroupMe hiccup (or a revoked token) never stops the rest.
      result.errors += 1;
      if (!(e instanceof GroupMeError && e.status === 401)) {
        console.error("groupme buzz:", (e as Error).message);
      }
    }
  }

  return result;
}
