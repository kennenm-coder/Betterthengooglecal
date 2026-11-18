"use client";

// "Job completions" on the Write-Ups page: what the install leads filed from
// their tiles (migration 058). Anything flagged waits here for the office to
// mark reviewed; clean "complete" reports just sit in the All list. Draws
// nothing at all until the first report exists, so the page is unchanged for
// everyone until install leads start using it.

import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useData } from "@/components/DataProvider";
import JobCompleteTag from "@/components/JobCompleteTag";
import { canReviewJobCompletions } from "@/lib/roles";
import { getSignedPhotoUrl } from "@/lib/work-order-store";
import {
  answerText,
  fetchCompletions,
  photosOf,
  setReviewed,
  type JobCompletion,
} from "@/lib/job-complete";

function when(iso: string): string {
  try {
    return format(parseISO(iso), "M/d/yy h:mm a");
  } catch {
    return "";
  }
}

export default function JobCompletionsPanel() {
  const { user, name, roles } = useAuth();
  const { refreshCompletions } = useData();
  const canReview = canReviewJobCompletions(roles);
  const [rows, setRows] = useState<JobCompletion[] | null>(null);
  const [view, setView] = useState<"review" | "all">("review");
  const [open, setOpen] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRows(await fetchCompletions());
    } catch {
      // Not set up yet, or not readable by this login: stay out of the way.
      setRows([]);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (rows === null || rows.length === 0) return null;

  const needs = rows.filter((r) => r.flagged && r.review_status === "new");
  const shown = view === "review" ? needs : rows;

  async function toggleReviewed(r: JobCompletion) {
    if (!user?.email) return;
    setBusy(r.id);
    setError("");
    try {
      await setReviewed(r.id, r.review_status !== "reviewed", user.email, name || user.email.split("@")[0]);
      await load();
      await refreshCompletions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-4 rounded-xl border border-border bg-surface/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          Job completions
        </span>
        <span className="text-xs text-muted">
          {needs.length > 0 ? (
            <span className="font-semibold text-amber-700 dark:text-amber-400">{needs.length} to review</span>
          ) : (
            "all reviewed"
          )}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          <div className="flex gap-1 mb-2">
            {(["review", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1 rounded-lg text-xs font-medium ${
                  view === v ? "bg-primary text-white" : "bg-surface text-muted"
                }`}
              >
                {v === "review" ? `Needs review ${needs.length}` : `All ${rows.length}`}
              </button>
            ))}
          </div>

          {shown.length === 0 && <p className="text-xs text-muted py-2">Nothing waiting on you.</p>}

          <ul className="space-y-2">
            {shown.map((r) => {
              const isOpen = openId === r.id;
              return (
                <li key={r.id} className="rounded-lg border border-border bg-background">
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : r.id)}
                    className="w-full text-left px-3 py-2 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.job_name || "Job"}</p>
                      <p className="text-xs text-muted truncate">
                        #{r.order_number}
                        {r.crew_name ? ` · ${r.crew_name}` : ""} · {when(r.submitted_at)}
                      </p>
                    </div>
                    <JobCompleteTag
                      compact
                      tag={{ id: r.id, outcome: r.outcome, flagged: r.flagged, review_status: r.review_status }}
                    />
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 border-t border-border space-y-3">
                      {r.address && <p className="text-xs text-muted pt-2">{r.address}</p>}
                      {r.template.map((q) => (
                        <div key={q.id}>
                          <p className="text-xs text-muted">{q.title}</p>
                          {q.type === "photo" ? (
                            <Photos photos={photosOf(r.answers[q.id])} />
                          ) : (
                            <p
                              className={`text-sm whitespace-pre-wrap ${
                                q.type === "yesno" && q.flagIf && r.answers[q.id] === q.flagIf ? "text-danger font-medium" : ""
                              }`}
                            >
                              {answerText(q, r.answers[q.id])}
                            </p>
                          )}
                        </div>
                      ))}
                      <p className="text-[11px] text-muted">
                        Filed by {r.created_by_name || r.created_by}
                        {r.submit_count > 1 ? ` · updated ${r.submit_count - 1}×` : ""}
                        {r.emailed_at ? " · office emailed" : r.email_error ? ` · email failed (${r.email_error})` : " · email not sent"}
                      </p>
                      {r.flagged && canReview && (
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => toggleReviewed(r)}
                          className={`w-full py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                            r.review_status === "reviewed"
                              ? "border border-border text-muted"
                              : "bg-green-600 text-white"
                          }`}
                        >
                          {busy === r.id && <Loader2 className="w-4 h-4 animate-spin" />}
                          {r.review_status === "reviewed"
                            ? `Reviewed${r.reviewed_by_name ? ` by ${r.reviewed_by_name}` : ""} — undo`
                            : "Mark reviewed"}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </section>
  );
}

function Photos({ photos }: { photos: { path: string; name: string }[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Keyed on the paths, not the array, so a fresh empty array each render
  // can't re-run this forever.
  const pathKey = photos.map((p) => p.path).join("|");
  useEffect(() => {
    if (!pathKey) return;
    let live = true;
    Promise.all(pathKey.split("|").map(async (path) => [path, await getSignedPhotoUrl(path)] as const)).then((pairs) => {
      if (!live) return;
      const next: Record<string, string> = {};
      for (const [path, url] of pairs) if (url) next[path] = url;
      setUrls(next);
    });
    return () => {
      live = false;
    };
  }, [pathKey]);
  if (photos.length === 0) return <p className="text-sm">—</p>;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {photos.map((p) =>
        urls[p.path] ? (
          <a key={p.path} href={urls[p.path]} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urls[p.path]} alt={p.name} className="w-16 h-16 object-cover rounded-md border border-border" />
          </a>
        ) : (
          <span key={p.path} className="w-16 h-16 rounded-md bg-surface border border-border" />
        )
      )}
    </div>
  );
}
