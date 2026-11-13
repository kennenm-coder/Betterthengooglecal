"use client";

import { useState } from "react";
import {
  Calendar,
  Check,
  Clock,
  Download,
  ExternalLink,
  Link2,
  Loader2,
  Trophy,
  X,
} from "lucide-react";
import { format } from "date-fns";
import type { TimeOffRequest } from "@/lib/types";
import { formatTimeDisplay } from "@/lib/time-off-store";
import {
  ADJUSTMENT_TYPE_LABELS,
  HOURS_CATEGORY_LABELS,
  KIND_LABELS,
  RECOGNITION_CATEGORY_LABELS,
  type InboxItem,
  type InboxKind,
} from "@/lib/kiosk-inbox";

/** What a decision changed, so the parent can update its lists. */
export interface DecisionResult {
  status: "approved" | "denied";
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  /** Time off only: the updated row, for the Time Off log. */
  timeOffRequest?: TimeOffRequest;
}

/**
 * Send one decision to the right route.
 *
 * Time off keeps its own route (it also tells the kiosk to email the
 * employee); everything else goes through /api/kiosk-inbox/decide, which
 * checks the person against the row's approver roles.
 */
export async function decideInboxItem(
  item: InboxItem,
  status: "approved" | "denied",
  note: string
): Promise<DecisionResult> {
  if (item.decision_table === "time_off_requests") {
    const res = await fetch(`/api/time-off/${item.item_id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note: status === "denied" ? note : "" }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || "Could not save the decision");
    const r = json.request as TimeOffRequest;
    return {
      status,
      reviewed_by_name: r?.reviewed_by_name ?? null,
      reviewed_at: r?.reviewed_at ?? null,
      review_note: r?.review_note ?? null,
      timeOffRequest: r,
    };
  }

  const res = await fetch("/api/kiosk-inbox/decide", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      table: item.decision_table,
      id: item.item_id,
      status,
      note,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error || "Could not save the decision");
  return {
    status,
    reviewed_by_name: json.reviewed_by_name ?? null,
    reviewed_at: json.reviewed_at ?? null,
    review_note: json.review_note ?? null,
  };
}

export function pdfHref(item: InboxItem): string {
  return `/api/kiosk-inbox/pdf?table=${item.decision_table}&id=${item.item_id}`;
}

/** "2026-11-13" → "Nov 13, 2026" without timezone drift. */
export function dayLabel(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
    return format(new Date(y, m - 1, d), "MMM d, yyyy");
  } catch {
    return dateStr;
  }
}

export function stampLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return format(new Date(iso), "MMM d, h:mm a");
  } catch {
    return iso;
  }
}

const KIND_STYLES: Record<InboxKind, string> = {
  time_off: "bg-rba-green/15 text-rba-green",
  time_card: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  form: "bg-surface text-muted border border-border",
  recognition: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

export function KindChip({ kind }: { kind: InboxKind }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${KIND_STYLES[kind]}`}
    >
      {KIND_LABELS[kind]}
    </span>
  );
}

export function StatusPill({ status }: { status: InboxItem["status"] }) {
  const styles: Record<InboxItem["status"], string> = {
    pending: "bg-warning/20 text-warning",
    approved: "bg-rba-green/15 text-rba-green",
    denied: "bg-danger/15 text-danger",
    recorded: "bg-surface text-muted border border-border",
  };
  const labels: Record<InboxItem["status"], string> = {
    pending: "Waiting",
    approved: "Approved",
    denied: "Denied",
    recorded: "On record",
  };
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** "first_name" / "firstName" → "First name". */
function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function TimeOffDetail({ item }: { item: InboxItem }) {
  const t = item.time_off;
  if (!t) return null;
  return (
    <>
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        <Calendar className="w-3 h-3 text-muted shrink-0" />
        <span>{dayLabel(t.start_date)}</span>
        {t.end_date && t.end_date !== t.start_date && (
          <>
            <span className="text-muted">&rarr;</span>
            <span>{dayLabel(t.end_date)}</span>
          </>
        )}
      </div>
      {(t.start_time || t.end_time) && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <Clock className="w-3 h-3 shrink-0" />
          <span>
            {[
              t.start_time && `leaves ${formatTimeDisplay(t.start_time)}`,
              t.end_time && `back ${formatTimeDisplay(t.end_time)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
      )}
      {t.reason && (
        <p className="mt-1.5 text-xs text-muted italic">&ldquo;{t.reason}&rdquo;</p>
      )}
    </>
  );
}

function TimeCardDetail({ item }: { item: InboxItem }) {
  const c = item.time_card;
  if (!c) return null;
  const punches = [
    c.clock_in && `in ${formatTimeDisplay(c.clock_in)}`,
    c.clock_out && `out ${formatTimeDisplay(c.clock_out)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        <Calendar className="w-3 h-3 text-muted shrink-0" />
        <span>{dayLabel(c.work_date)}</span>
        <span className="text-muted">
          · {ADJUSTMENT_TYPE_LABELS[c.adjustment_type] ?? c.adjustment_type}
        </span>
      </div>
      <p className="mt-1 text-xs">
        <span className="text-muted">Card shows </span>
        {c.recorded_hours == null ? "nothing / not sure" : `${Number(c.recorded_hours)} h`}
        <span className="text-muted"> · worked </span>
        <span className="font-semibold">{Number(c.claimed_hours)} h</span>
        <span className="text-muted">
          {" "}
          · {HOURS_CATEGORY_LABELS[c.hours_category] ?? c.hours_category}
        </span>
      </p>
      {punches && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
          <Clock className="w-3 h-3 shrink-0" />
          <span>{punches}</span>
        </div>
      )}
      {c.reason && (
        <p className="mt-1.5 text-xs text-muted italic">&ldquo;{c.reason}&rdquo;</p>
      )}
    </>
  );
}

function RecognitionDetail({ item, kioskUrl }: { item: InboxItem; kioskUrl: string | null }) {
  const d = item.data;
  const nominee = str(d.nomineeName) || "Unnamed";
  const supervisor = str(d.supervisorName);
  const workArea = str(d.workArea);
  const category = str(d.category);
  const reason = str(d.reason);
  const beltWorthy = d.beltWorthy === true;
  return (
    <div
      className={`mt-2 rounded-lg border-2 bg-background p-3 ${
        beltWorthy ? "border-amber-400" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-bold">
            {nominee}
            {d.nomineeListed === false && (
              <span className="ml-2 rounded bg-warning/20 px-1.5 py-0.5 align-middle text-[10px] font-medium">
                not in the staff list
              </span>
            )}
          </p>
          <p className="text-xs text-muted">
            {[workArea, supervisor && `supervisor ${supervisor}`]
              .filter(Boolean)
              .join(" · ") || "No work area given"}
          </p>
        </div>
        {beltWorthy && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] font-bold text-amber-300">
            <Trophy className="w-3 h-3" /> Belt worthy
          </span>
        )}
      </div>
      {category && (
        <p className="mt-2 text-xs font-semibold text-rba-green">
          {RECOGNITION_CATEGORY_LABELS[category] ?? category}
        </p>
      )}
      {reason && (
        <blockquote className="mt-1 whitespace-pre-line border-l-4 border-border pl-2.5 text-sm">
          {reason}
        </blockquote>
      )}
      <p className="mt-2 text-xs text-muted">
        Nominated by {item.employee_name}
        {d.keepMyNameOff === true && " (asked to stay off the announcement)"}
      </p>
      {item.status === "approved" && beltWorthy && kioskUrl && (
        <a
          href={`${kioskUrl}/admin/recognition`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <Trophy className="w-3 h-3" /> Crown the champion in the kiosk
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}

function FormDetail({ item }: { item: InboxItem }) {
  const entries = Object.entries(item.data).filter(([, v]) => {
    if (typeof v === "boolean") return true;
    if (typeof v === "number") return true;
    // Long strings (a stray image data URL, say) belong in the PDF, not here.
    return typeof v === "string" && v.trim() !== "" && v.length < 2000 && !v.startsWith("data:");
  });
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1.5 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted truncate">{humanize(k)}</dt>
          <dd className="whitespace-pre-line break-words">
            {typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One kiosk submission: who, what, the detail that matters for its kind, the
 * signed PDF, and (when the viewer can decide it) Approve / Deny.
 */
export default function InboxItemCard({
  item,
  kioskUrl,
  compact = false,
  onDecided,
}: {
  item: InboxItem;
  kioskUrl: string | null;
  /** The header bell: no form fields, no long detail. */
  compact?: boolean;
  onDecided?: (item: InboxItem, result: DecisionResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [denying, setDenying] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isTimeOff = item.kind === "time_off";
  // Time off denials are emailed to the employee, so a reason is required.
  const noteRequired = isTimeOff;

  async function decide(status: "approved" | "denied") {
    setBusy(true);
    setError(null);
    try {
      const result = await decideInboxItem(item, status, status === "denied" ? note : "");
      setDenying(false);
      setNote("");
      onDecided?.(item, result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const decided = item.status === "approved" || item.status === "denied";

  return (
    <div>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <KindChip kind={item.kind} />
            {item.status !== "pending" && <StatusPill status={item.status} />}
            <span className="font-medium text-sm">
              {item.kind === "recognition" ? item.title : item.employee_name}
            </span>
            {item.kind !== "recognition" && item.department && (
              <span className="text-xs text-muted">{item.department}</span>
            )}
          </div>
          {item.kind !== "recognition" && (
            <p className="mt-0.5 text-xs text-muted">
              {item.kind === "time_off" && item.time_off?.request_type
                ? item.time_off.request_type
                : item.title}
            </p>
          )}

          {item.kind === "time_off" && <TimeOffDetail item={item} />}
          {item.kind === "time_card" && <TimeCardDetail item={item} />}
          {item.kind === "form" && !compact && <FormDetail item={item} />}
          {item.kind === "recognition" &&
            (compact ? (
              <p className="mt-0.5 text-xs text-muted">
                Nominated by {item.employee_name}
                {item.data.beltWorthy === true && " · belt worthy"}
              </p>
            ) : (
              <RecognitionDetail item={item} kioskUrl={kioskUrl} />
            ))}

          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
            <span>{stampLabel(item.submitted_at)}</span>
            {item.source === "link" && (
              <span className="inline-flex items-center gap-0.5">
                <Link2 className="w-3 h-3" /> via share link
              </span>
            )}
            {item.reference_code && <span className="font-mono">{item.reference_code}</span>}
          </p>

          {decided && item.reviewed_by_name && (
            <p className="mt-1 text-xs text-muted">
              <span className={item.status === "denied" ? "text-danger" : "text-rba-green"}>
                {item.status === "denied" ? "Denied" : "Approved"}
              </span>{" "}
              by {item.reviewed_by_name}
              {item.reviewed_at ? `, ${stampLabel(item.reviewed_at)}` : ""}
              {item.review_note ? ` — “${item.review_note}”` : ""}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {item.has_pdf && (
            <a
              href={pdfHref(item)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the signed PDF"
              className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-2 text-xs font-medium hover:bg-surface"
            >
              <Download className="w-3.5 h-3.5" /> PDF
            </a>
          )}
          {item.can_decide && !denying && (
            <>
              <button
                onClick={() => {
                  setDenying(true);
                  setNote("");
                }}
                disabled={busy}
                className="flex items-center gap-1 rounded-lg border border-danger/40 bg-background px-2.5 py-2 text-xs font-medium text-danger disabled:opacity-50 active:scale-[0.97]"
              >
                <X className="w-3.5 h-3.5" /> Deny
              </button>
              <button
                onClick={() => decide("approved")}
                disabled={busy}
                className="flex items-center gap-1 rounded-lg bg-rba-green px-3 py-2 text-xs font-semibold text-white disabled:opacity-50 active:scale-[0.97]"
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Approve
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      )}

      {denying && (
        <div className="mt-2.5">
          <label className="block text-xs font-medium text-muted mb-1">
            {noteRequired
              ? "Why is this denied? The employee is emailed this."
              : "Why is this denied? (optional, kept on the record)"}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            rows={2}
            autoFocus
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              onClick={() => {
                setDenying(false);
                setNote("");
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-muted"
            >
              Cancel
            </button>
            <button
              onClick={() => decide("denied")}
              disabled={busy || (noteRequired && note.trim().length < 3)}
              className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : noteRequired ? "Deny and tell them" : "Deny"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
