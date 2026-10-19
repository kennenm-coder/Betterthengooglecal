"use client";

import { useState } from "react";
import { Check, Loader2, Link2, Trash2, AlertTriangle, Package } from "lucide-react";
import type {
  MatchCounts,
  OrcaLink,
  Suggestion,
  UnmatchedGroup,
} from "@/lib/orca-links";

/**
 * The warehouse-link screen, with the data already in hand.
 *
 * Split out from the page so the /dev-orca-links harness can render it from
 * sample rows — before migration 039 is applied there is nothing to read, and
 * this is the screen you most want to look at before committing to it.
 */
export function OrcaLinksView({
  counts,
  groups,
  links,
  suggestFor,
  busyJob,
  message,
  onSave,
  onRemove,
}: {
  counts: MatchCounts | null;
  groups: UnmatchedGroup[];
  links: OrcaLink[];
  suggestFor: (group: UnmatchedGroup) => Suggestion[];
  busyJob: string | null;
  message: { kind: "ok" | "error"; text: string } | null;
  onSave: (jobOrderNumber: string, orderNumber: string) => void;
  onRemove: (jobOrderNumber: string) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});

  return (
    <div className="flex-1 overflow-y-auto">
      {/* The headline. How much of the warehouse this app can actually place
          is the number that says whether the install page is any use yet. */}
      {counts && (
        <div className="px-4 py-3 border-b border-border bg-surface">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-foreground">
              {counts.matched}
            </span>
            <span className="text-sm text-muted">
              of {counts.matched + counts.unmatched} warehouse rows are tied to a
              job
            </span>
          </div>
          {counts.unmatched > 0 && (
            <p className="text-xs text-muted mt-1">
              The other {counts.unmatched}{" "}
              belong to factory jobs we have no order number for. Each link
              below places all of that job&apos;s rows at once.
            </p>
          )}
        </div>
      )}

      {message && (
        <div
          className={`px-4 py-2.5 text-xs flex items-start gap-1.5 border-b border-border ${
            message.kind === "ok"
              ? "text-[#4a7d2c] bg-[#6DB344]/10"
              : "text-red-700 bg-red-50"
          }`}
        >
          {message.kind === "ok" ? (
            <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <div className="p-4 space-y-2.5">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center text-muted py-16 gap-2">
            <Check className="w-8 h-8 text-[#6DB344]" />
            <p className="text-sm">
              Every warehouse row is tied to a job. Nothing to link.
            </p>
          </div>
        ) : (
          groups.map((g) => {
            const suggestions = suggestFor(g);
            const value = inputs[g.jobOrderNumber] ?? "";
            const working = busyJob === g.jobOrderNumber;
            const valid = /^[0-9]{8}$/.test(value.trim());

            return (
              <div
                key={g.jobOrderNumber}
                className="rounded-lg border border-border bg-surface p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-sm">
                    {g.jobOrderNumber}
                  </span>
                  <span className="text-xs text-muted whitespace-nowrap flex items-center gap-1">
                    <Package className="w-3.5 h-3.5" />
                    {g.rowCount} {g.rowCount === 1 ? "row" : "rows"}
                  </span>
                </div>

                {g.names.length > 0 && (
                  <div className="text-xs text-muted mt-0.5 truncate">
                    {g.names.slice(0, 3).join(" · ")}
                  </div>
                )}
                {g.samples.length > 0 && (
                  <div className="text-[11px] text-muted mt-1 space-y-0.5">
                    {g.samples.map((sample) => (
                      <div key={sample} className="truncate">
                        {sample}
                      </div>
                    ))}
                  </div>
                )}

                {/* Suggestions are a shortcut, never an answer: a surname
                    match is not identification, and there are two Johnsons on
                    the board most months. Clicking one only fills the box. */}
                {suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {suggestions.map((s) => (
                      <button
                        key={s.orderNumber}
                        onClick={() =>
                          setInputs((m) => ({
                            ...m,
                            [g.jobOrderNumber]: s.orderNumber,
                          }))
                        }
                        title={s.because}
                        className="text-[11px] px-2 py-1 rounded-full border border-border hover:bg-muted/10 transition-colors"
                      >
                        <span className="font-mono">{s.orderNumber}</span>
                        <span className="text-muted"> · {s.customerName}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={value}
                    onChange={(e) =>
                      setInputs((m) => ({ ...m, [g.jobOrderNumber]: e.target.value }))
                    }
                    inputMode="numeric"
                    placeholder="8-digit order number"
                    aria-label={`Order number for factory job ${g.jobOrderNumber}`}
                    className="flex-1 min-w-0 px-2.5 py-2 rounded-lg border border-border bg-background text-sm font-mono"
                  />
                  <button
                    onClick={() => onSave(g.jobOrderNumber, value.trim())}
                    disabled={!valid || working}
                    className="shrink-0 px-3 py-2 rounded-lg bg-[#6DB344] text-white text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
                  >
                    {working ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Link2 className="w-4 h-4" />
                    )}
                    Link
                  </button>
                </div>
              </div>
            );
          })
        )}

        {/* Links already made. Kept on the same screen because correcting a
            wrong one matters as much as making the right one — a bad link
            puts another job's windows on an installer's list. */}
        {links.length > 0 && (
          <div className="pt-4">
            <div className="text-[10px] font-bold tracking-wider uppercase text-muted mb-1.5">
              Linked ({links.length})
            </div>
            <div className="rounded-lg border border-border divide-y divide-border">
              {links.map((l) => (
                <div
                  key={l.jobOrderNumber}
                  className="flex items-center gap-2 px-3 py-2 text-xs"
                >
                  <span className="font-mono">{l.jobOrderNumber}</span>
                  <span className="text-muted">→</span>
                  <span className="font-mono font-semibold">{l.orderNumber}</span>
                  <span className="text-muted">
                    {l.rowCount} {l.rowCount === 1 ? "row" : "rows"}
                  </span>
                  <span className="text-muted ml-auto">{l.source}</span>
                  <button
                    onClick={() => onRemove(l.jobOrderNumber)}
                    disabled={busyJob === l.jobOrderNumber}
                    title="Remove this link"
                    aria-label={`Remove the link for factory job ${l.jobOrderNumber}`}
                    className="p-1 rounded hover:bg-muted/10 disabled:opacity-40"
                  >
                    {busyJob === l.jobOrderNumber ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-muted" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5 text-muted" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default OrcaLinksView;
