"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Link2, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useData } from "@/components/DataProvider";
import { isAdmin } from "@/lib/roles";
import BottomNav from "@/components/BottomNav";
import OrcaLinksView from "@/components/OrcaLinksView";
import {
  MatchCounts,
  OrcaLink,
  UnmatchedGroup,
  fetchLinks,
  fetchMatchCounts,
  fetchUnmatchedGroups,
  removeLink,
  saveLink,
  suggestOrders,
} from "@/lib/orca-links";

/**
 * Warehouse Links — tying Orca's factory job numbers to our order numbers.
 *
 * Orca's inventory rows carry the factory's 7-digit job order number; this app
 * keys on our 8-digit order number; most rows carry only the first. Until a
 * row can be tied to a job, it cannot appear on anyone's install paperwork,
 * and the install page says so rather than pretending the warehouse is empty.
 *
 * This is where the office closes that gap, one factory job at a time. Each
 * link places every row for that job at once, so the list shortens fast.
 *
 * Admin only, both here and in RLS (migration 039). Nothing on this screen
 * touches Orca — these are our own tables, and the mirror itself is read-only
 * from this side.
 */
export default function OrcaLinksPage() {
  const router = useRouter();
  const { role, roles } = useAuth();
  const { orders } = useData();
  const allowed = isAdmin(roles);

  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [counts, setCounts] = useState<MatchCounts | null>(null);
  const [groups, setGroups] = useState<UnmatchedGroup[]>([]);
  const [links, setLinks] = useState<OrcaLink[]>([]);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null
  );

  useEffect(() => {
    if (role && !allowed) router.replace("/settings");
  }, [role, allowed, router]);

  const load = useCallback(async () => {
    const result = await fetchUnmatchedGroups();
    if (result.kind === "unavailable") {
      setUnavailable(result.detail);
      setLoading(false);
      return;
    }
    setUnavailable(null);
    setGroups(result.groups);
    const [l, c] = await Promise.all([fetchLinks(), fetchMatchCounts()]);
    setLinks(l);
    setCounts(c);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  async function handleSave(jobOrderNumber: string, orderNumber: string) {
    setBusyJob(jobOrderNumber);
    setMessage(null);
    const res = await saveLink(jobOrderNumber, orderNumber);
    if (res.ok) {
      setMessage({
        kind: "ok",
        text: `Linked ${jobOrderNumber} to ${orderNumber} — that placed ${res.resolved} ${
          res.resolved === 1 ? "row" : "rows"
        }.`,
      });
      await load();
    } else {
      setMessage({ kind: "error", text: res.error });
    }
    setBusyJob(null);
  }

  async function handleRemove(jobOrderNumber: string) {
    setBusyJob(jobOrderNumber);
    setMessage(null);
    const res = await removeLink(jobOrderNumber);
    if (res.ok) {
      setMessage({
        kind: "ok",
        text: `Removed the link for ${jobOrderNumber} — ${res.cleared} ${
          res.cleared === 1 ? "row went" : "rows went"
        } back to unmatched.`,
      });
      await load();
    } else {
      setMessage({ kind: "error", text: res.error });
    }
    setBusyJob(null);
  }

  if (role && !allowed) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center text-muted text-sm">
          Redirecting…
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors mb-1"
        >
          <ChevronLeft className="w-4 h-4" />
          Settings
        </Link>
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-amber-600" />
          <h1 className="text-lg font-semibold">Warehouse Links</h1>
        </div>
        <p className="text-sm text-muted mt-0.5">
          Tie the factory&apos;s job numbers to our order numbers, so warehouse
          rows show up on the right job&apos;s paperwork
        </p>
      </header>

      {loading ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" />
          Reading the warehouse mirror…
        </div>
      ) : unavailable ? (
        // Before migration 039 is applied there is no mirror to read. Saying
        // that beats an empty list, which would read as "all done".
        <div className="flex-1 overflow-y-auto p-4">
          <div className="rounded-lg border border-border bg-surface px-3.5 py-3 text-xs text-muted leading-relaxed">
            The warehouse mirror isn&apos;t readable yet — most likely migration
            039 hasn&apos;t been applied.
            <span className="block mt-1 font-mono opacity-70">{unavailable}</span>
          </div>
        </div>
      ) : (
        <OrcaLinksView
          counts={counts}
          groups={groups}
          links={links}
          suggestFor={(g) => suggestOrders(g, orders)}
          busyJob={busyJob}
          message={message}
          onSave={handleSave}
          onRemove={handleRemove}
        />
      )}

      <BottomNav />
    </div>
  );
}
