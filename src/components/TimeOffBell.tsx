"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  Calendar,
  Check,
  Clock,
  Download,
  Loader2,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canApproveTimeOff } from "@/lib/roles";
import { formatTimeDisplay } from "@/lib/time-off-store";
import { format } from "date-fns";

interface PendingRequest {
  id: string;
  employee_name: string;
  department: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  request_type: string | null;
  reason: string | null;
  reference_code: string | null;
  signed_pdf_path: string | null;
  created_at: string;
}

/** How often the badge refreshes while the page is open. */
const POLL_MS = 120_000;

/**
 * The approval queue, in the header.
 *
 * Shown only to accounts that can actually decide a request. Opening it
 * clears the badge but not the list: requests stay until somebody decides
 * them, so glancing at the bell never silently dismisses anybody's time off.
 */
export default function TimeOffBell() {
  const { roles, loading } = useAuth();
  const canApprove = !loading && canApproveTimeOff(roles);

  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/time-off/pending");
      if (!res.ok) return;
      const json = await res.json();
      setRequests(json.requests ?? []);
      setUnseen(json.unseen ?? 0);
    } catch {
      // A badge that cannot refresh is not worth an error message.
    }
  }, []);

  useEffect(() => {
    if (!canApprove) return;
    let cancelled = false;
    const tick = () => {
      if (!cancelled) refresh();
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [canApprove, refresh]);

  // Close when clicking away, so the panel does not sit over the calendar.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!canApprove) return null;

  async function openPanel() {
    setOpen(true);
    setError(null);
    await refresh();
    // Clear the badge, not the queue.
    setUnseen(0);
    fetch("/api/time-off/pending", { method: "POST" }).catch(() => {});
  }

  async function decide(id: string, status: "approved" | "denied") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/time-off/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: status === "denied" ? note : "" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not save");

      setRequests((prev) => prev.filter((r) => r.id !== id));
      setDenyingId(null);
      setNote("");
      // Let the Time Off page refresh itself if it is open behind this.
      window.dispatchEvent(new CustomEvent("time-off-decided"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  function dayLabel(dateStr: string) {
    try {
      const [y, m, d] = dateStr.split("-").map(Number);
      return format(new Date(y, m - 1, d), "MMM d");
    } catch {
      return dateStr;
    }
  }

  return (
    <div className="relative shrink-0" ref={panelRef}>
      <button
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="relative p-1.5 rounded-md hover:bg-surface text-muted hover:text-foreground"
        title={
          requests.length
            ? `${requests.length} time off request${requests.length === 1 ? "" : "s"} waiting`
            : "Time off requests"
        }
      >
        <Bell className="w-5 h-5" />
        {unseen > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">
            {unseen > 99 ? "99+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[min(92vw,26rem)] max-h-[70vh] overflow-auto rounded-xl border border-border bg-background shadow-xl z-50">
          <div className="sticky top-0 bg-background border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold">
              {requests.length === 0
                ? "Nothing waiting"
                : `${requests.length} request${requests.length === 1 ? "" : "s"} to decide`}
            </p>
            {requests.length > 0 && (
              <p className="text-xs text-muted mt-0.5">
                Approving puts it on the calendar.
              </p>
            )}
          </div>

          {error && (
            <p className="mx-3 mt-3 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}

          {requests.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted">
              No time off is waiting on you.
            </p>
          )}

          <ul className="divide-y divide-border">
            {requests.map((r) => {
              const busy = busyId === r.id;
              const denying = denyingId === r.id;
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {r.employee_name}
                      </p>
                      <p className="text-xs text-muted">
                        {r.department}
                        {r.request_type ? ` · ${r.request_type}` : ""}
                      </p>
                    </div>
                    {r.signed_pdf_path && (
                      <a
                        href={`/api/time-off/${r.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 p-1.5 rounded hover:bg-surface text-muted"
                        title="Open the signed request"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>

                  <p className="mt-1 flex items-center gap-1.5 text-xs">
                    <Calendar className="w-3 h-3 text-muted shrink-0" />
                    {dayLabel(r.start_date)}
                    {r.end_date && r.end_date !== r.start_date && (
                      <> &rarr; {dayLabel(r.end_date)}</>
                    )}
                  </p>

                  {(r.start_time || r.end_time) && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <Clock className="w-3 h-3 shrink-0" />
                      {[
                        r.start_time && `leaves ${formatTimeDisplay(r.start_time)}`,
                        r.end_time && `back ${formatTimeDisplay(r.end_time)}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}

                  {r.reason && (
                    <p className="mt-1.5 text-xs italic text-muted">
                      &ldquo;{r.reason}&rdquo;
                    </p>
                  )}

                  {denying ? (
                    <div className="mt-2.5">
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value.slice(0, 1000))}
                        rows={2}
                        autoFocus
                        placeholder="Why? This is emailed to them."
                        className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
                      />
                      <div className="mt-1.5 flex justify-end gap-1.5">
                        <button
                          onClick={() => {
                            setDenyingId(null);
                            setNote("");
                          }}
                          className="rounded-lg px-3 py-1.5 text-xs text-muted"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => decide(r.id, "denied")}
                          disabled={busy || note.trim().length < 3}
                          className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {busy ? "Sending…" : "Deny and tell them"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2.5 flex justify-end gap-1.5">
                      <button
                        onClick={() => {
                          setDenyingId(r.id);
                          setNote("");
                        }}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-lg border border-danger/40 px-2.5 py-1.5 text-xs font-medium text-danger disabled:opacity-50"
                      >
                        <X className="w-3.5 h-3.5" /> Deny
                      </button>
                      <button
                        onClick={() => decide(r.id, "approved")}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-lg bg-rba-green px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {busy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        Approve
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
