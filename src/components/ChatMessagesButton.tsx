"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canUseInstallerChat } from "@/lib/roles";
import { crewsForDate } from "@/lib/format-utils";
import { readChatCache, watchChatCache, type CachedChat } from "@/lib/chat-cache";
import type { WorkOrder } from "@/lib/types";

/**
 * The Messages button on a job card, next to the Job Alert alarm clock.
 *
 * Shows only when this job's installer has a GroupMe chat linked to them via
 * the Duck Force bot (migration 071) AND the signed-in person chose that chat
 * (so their own GroupMe account is in it). The red number is THEIR unread
 * count in that chat. Tapping opens the chat; Back returns here.
 *
 * Reads the chat list the bottom bar already keeps fresh (src/lib/chat-cache),
 * so it costs no extra requests.
 */
export default function ChatMessagesButton({ order }: { order: WorkOrder }) {
  const router = useRouter();
  const { user, roles } = useAuth();
  const allowed = canUseInstallerChat(roles);
  const [chats, setChats] = useState<CachedChat[] | null>(
    () => readChatCache(user?.id)?.chats ?? null
  );

  useEffect(() => {
    if (!user?.id) return;
    setChats(readChatCache(user.id)?.chats ?? null);
    return watchChatCache(() => setChats(readChatCache(user.id)?.chats ?? null));
  }, [user?.id]);

  if (!allowed || !chats?.length) return null;

  const names = new Set(
    [order.installer, ...crewsForDate(order)]
      .filter((n): n is string => !!n && !!n.trim())
      .map((n) => n.trim().toLowerCase())
  );
  const chat = chats.find((c) => c.installerName && names.has(c.installerName.trim().toLowerCase()));
  if (!chat) return null;

  const count = chat.unreadCount ?? 0;
  return (
    <button
      onClick={() => router.push(`/chat?open=${encodeURIComponent(chat.id)}`)}
      className="relative p-1.5 rounded-lg border border-primary/30 bg-primary/10 hover:bg-primary/20 transition-colors"
      title={count ? `Messages: ${count} unread in ${chat.name}` : `Messages: ${chat.name}`}
      aria-label="Messages"
    >
      <MessageCircle className="w-5 h-5 text-primary" />
      {count > 0 ? (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">
          {count > 99 ? "99+" : count}
        </span>
      ) : chat.unread ? (
        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-600" />
      ) : null}
    </button>
  );
}
