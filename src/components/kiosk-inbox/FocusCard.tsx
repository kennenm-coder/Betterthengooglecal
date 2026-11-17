"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { SECTION_TITLES, type InboxItem, type InboxKind } from "@/lib/kiosk-inbox";
import InboxItemCard, { type DecisionResult } from "./InboxItemCard";

interface FocusResponse {
  item: InboxItem | null;
  forbidden: boolean;
  kind: InboxKind | null;
  kioskUrl: string | null;
}

/**
 * The item a notification email pointed at, pinned to the top of the page.
 *
 * It is shown in any status, so a link still works after someone has decided
 * the request, and it carries the same Approve / Deny buttons as the list below
 * when the viewer may decide it. A person who is not one of that item's
 * approvers is told so plainly and shown nothing about it.
 */
export default function FocusCard({
  submissionId,
  onDecided,
}: {
  submissionId: string;
  /** Lets the page refresh its own lists (and the time-off log) after a decision. */
  onDecided: (item: InboxItem, result: DecisionResult) => void;
}) {
  const [data, setData] = useState<FocusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/kiosk-inbox?sub=${encodeURIComponent(submissionId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not open that request");
      setData(json as FocusResponse);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [submissionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data) cardRef.current?.scrollIntoView({ block: "start" });
  }, [data]);

  function decided(item: InboxItem, result: DecisionResult) {
    onDecided(item, result);
    // Show the outcome in place rather than making the card vanish.
    load();
  }

  return (
    <div ref={cardRef} className="border-t-2 border-primary/40 bg-primary-light/40 px-4 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-primary">
        <Mail className="h-3.5 w-3.5" /> From your email
      </p>

      {error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}
      {!data && !error && (
        <div className="flex justify-center py-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      )}
      {data?.forbidden && (
        <p className="rounded-lg bg-warning/15 px-3 py-2 text-sm">
          This account cannot open that {data.kind ? SECTION_TITLES[data.kind].toLowerCase() : "request"}.
          It is for a different role. If you should have access, ask an admin to change your role.
        </p>
      )}
      {data && !data.forbidden && !data.item && (
        <p className="rounded-lg bg-surface px-3 py-2 text-sm text-muted">
          That request could not be found. It may have been removed.
        </p>
      )}
      {data?.item && (
        <div className="rounded-lg border border-border bg-background p-3">
          <InboxItemCard item={data.item} kioskUrl={data.kioskUrl} onDecided={decided} />
        </div>
      )}
    </div>
  );
}
