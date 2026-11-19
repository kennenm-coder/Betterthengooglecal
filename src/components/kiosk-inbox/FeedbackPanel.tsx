"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, MessageSquareText, RotateCcw } from "lucide-react";
import { FEEDBACK_CATEGORY_LABELS, type FeedbackItem } from "@/lib/kiosk-inbox";
import { stampLabel } from "./InboxItemCard";

type Filter = "new" | "handled" | "all";

const CATEGORY_STYLES: Record<string, string> = {
  idea: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  comment: "bg-surface text-muted border border-border",
  question: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  complaint: "bg-danger/15 text-danger",
};

/**
 * The kiosk's feedback: ideas, comments, questions and complaints, newest first.
 *
 * A record, not a queue: there is nothing to approve. Each one can be marked
 * handled (and reopened), and the person who did is recorded. Anything someone
 * asked to talk over is flagged, with how to reach them when they said.
 *
 * Only admins and the Feedback role reach this tab. Names are shown as given:
 * a row from somebody who chose "don't save my name" has none to show, and says
 * "Anonymous" instead.
 *
 * `focusId` is the item an emailed link points at: it is marked, scrolled to,
 * and shown whatever its status.
 */
export default function FeedbackPanel({ focusId }: { focusId: string | null }) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(focusId ? "all" : "new");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/kiosk-feedback");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Could not load the feedback");
        if (cancelled) return;
        setItems(json.items ?? []);
        setTableMissing(Boolean(json.tableMissing));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setItems([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!items || !focusId) return;
    document.getElementById(`feedback-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [items, focusId]);

  const counts = useMemo(() => {
    const list = items ?? [];
    return {
      new: list.filter((i) => i.status === "new").length,
      handled: list.filter((i) => i.status === "handled").length,
      all: list.length,
    };
  }, [items]);

  const shown = useMemo(
    () => (items ?? []).filter((i) => filter === "all" || i.status === filter),
    [items, filter]
  );

  async function mark(item: FeedbackItem, status: "handled" | "new") {
    setBusyId(item.id);
    setError(null);
    try {
      const res = await fetch("/api/kiosk-feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not save that");
      setItems((prev) => (prev ?? []).map((i) => (i.id === item.id ? (json.item as FeedbackItem) : i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="pb-6">
      <header className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
        <MessageSquareText className="h-4 w-4 shrink-0 text-muted" />
        <h2 className="text-sm font-semibold">Feedback from the kiosk</h2>
        <div className="ml-auto flex items-center gap-1 rounded-lg bg-surface p-0.5">
          {(
            [
              ["new", `New${items ? ` (${counts.new})` : ""}`],
              ["handled", `Handled${items ? ` (${counts.handled})` : ""}`],
              ["all", "All"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                filter === key ? "bg-background shadow-sm text-foreground" : "text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <p className="px-4 pb-2 text-xs text-muted">
        Nothing to approve here. Mark each one handled when it has been dealt with.
      </p>

      {error && (
        <p className="mx-4 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}
      {items === null && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      )}
      {tableMissing && (
        <p className="px-4 text-xs text-muted">
          The kiosk&apos;s feedback is not set up in the database yet.
        </p>
      )}
      {items && shown.length === 0 && !tableMissing && !error && (
        <p className="px-4 text-sm text-muted">
          {filter === "new" ? "Nothing new." : "Nothing here."}
        </p>
      )}

      <ul className="space-y-2 px-4">
        {shown.map((f) => (
          <li
            key={f.id}
            id={`feedback-${f.id}`}
            className={`rounded-lg border bg-background p-3 ${
              f.id === focusId ? "border-primary ring-2 ring-primary" : "border-border"
            }`}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  CATEGORY_STYLES[f.category] ?? CATEGORY_STYLES.comment
                }`}
              >
                {FEEDBACK_CATEGORY_LABELS[f.category] ?? f.category}
              </span>
              {f.wants_discussion && (
                <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  Wants to talk it over
                </span>
              )}
              {f.status === "handled" && (
                <span className="rounded-full bg-rba-green/15 px-2 py-0.5 text-[10px] font-semibold text-rba-green">
                  Handled
                </span>
              )}
              <span className="ml-auto font-mono text-[11px] text-muted">
                FB-{f.feedback_number}
              </span>
            </div>

            <p className="mt-2 whitespace-pre-line text-sm">{f.message}</p>

            <p className="mt-2 text-xs text-muted">
              {f.submitter_name || (f.anonymous ? "Anonymous" : "No name given")} ·{" "}
              {stampLabel(f.created_at)}
            </p>
            {f.contact && (
              <p className="mt-1 text-xs">
                <span className="text-muted">Reach them: </span>
                {f.contact.includes("@") ? (
                  <a href={`mailto:${f.contact}`} className="text-primary hover:underline">
                    {f.contact}
                  </a>
                ) : (
                  <span className="font-medium">{f.contact}</span>
                )}
              </p>
            )}

            <div className="mt-2.5 flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted">
                {f.status === "handled" && f.handled_by_name
                  ? `Handled by ${f.handled_by_name}${f.handled_at ? `, ${stampLabel(f.handled_at)}` : ""}`
                  : ""}
              </p>
              {f.status === "new" ? (
                <button
                  type="button"
                  onClick={() => mark(f, "handled")}
                  disabled={busyId === f.id}
                  className="flex items-center gap-1 rounded-lg bg-rba-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 active:scale-[0.97]"
                >
                  {busyId === f.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Mark handled
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => mark(f, "new")}
                  disabled={busyId === f.id}
                  className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted disabled:opacity-50 active:scale-[0.97]"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reopen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
