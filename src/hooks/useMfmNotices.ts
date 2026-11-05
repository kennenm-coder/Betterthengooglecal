"use client";

// A lead's More for More notices: sheets payroll sent back (until the lead
// resubmits) and sheets payroll completed (until the lead dismisses them).
// Shared by the bottom-bar badge and the notice strip on the calendar, so one
// fetch serves both: results are cached for a minute per login, and any save
// calls refreshMfmNotices() to update every screen at once.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { canFillMoreForMore } from "@/lib/roles";
import { getSupabase } from "@/lib/supabase";
import { ackSheet, noticeKind, type MoreForMore } from "@/lib/more-for-more";

const TTL_MS = 60_000;
const EVENT = "mfm-notices-changed";

let cache: { email: string; at: number; sheets: MoreForMore[] } | null = null;
let inflight: Promise<MoreForMore[]> | null = null;

async function load(email: string, force = false): Promise<MoreForMore[]> {
  if (!force && cache && cache.email === email && Date.now() - cache.at < TTL_MS) return cache.sheets;
  if (inflight && !force) return inflight;
  const supabase = getSupabase();
  if (!supabase) return [];
  inflight = (async () => {
    const { data, error } = await supabase
      .from("more_for_more")
      .select("*")
      .eq("created_by", email)
      .in("status", ["rejected", "completed"])
      .order("updated_at", { ascending: false })
      .limit(50);
    // A failed check just shows no notices; it must never break a screen.
    const sheets = error ? [] : ((data || []) as MoreForMore[]).filter((s) => noticeKind(s));
    cache = { email, at: Date.now(), sheets };
    return sheets;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Re-check notices everywhere (after a save, a resubmit, a send-back). */
export function refreshMfmNotices() {
  cache = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

export function useMfmNotices() {
  const { roles, user } = useAuth();
  const email = user?.email?.toLowerCase() || "";
  const eligible = !!email && canFillMoreForMore(roles);
  const [sheets, setSheets] = useState<MoreForMore[]>(() =>
    cache && cache.email === email ? cache.sheets : []
  );

  useEffect(() => {
    if (!eligible) return;
    let live = true;
    const run = (force = false) =>
      load(email, force).then((s) => {
        if (live) setSheets(s);
      });
    run();
    const onChange = () => run(true);
    window.addEventListener(EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(EVENT, onChange);
    };
  }, [eligible, email]);

  const dismiss = useCallback(async (id: string) => {
    setSheets((prev) => prev.filter((s) => s.id !== id));
    if (cache) cache = { ...cache, sheets: cache.sheets.filter((s) => s.id !== id) };
    try {
      await ackSheet(id);
    } finally {
      refreshMfmNotices();
    }
  }, []);

  const list = eligible ? sheets : [];
  return {
    notices: list,
    /** Sheets sent back that the lead still has to fix — the tab's badge. */
    rejectedCount: list.filter((s) => s.status === "rejected").length,
    dismiss,
  };
}
