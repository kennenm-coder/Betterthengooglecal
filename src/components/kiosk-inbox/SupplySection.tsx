"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { SECTION_TITLES, type SupplyLogItem } from "@/lib/kiosk-inbox";
import { stampLabel } from "./InboxItemCard";

const SHEET_LABELS: Record<SupplyLogItem["sheet_status"], string> = {
  pending: "Not on the sheet yet",
  synced: "On the sheet",
  failed: "Did not reach the sheet",
};

const SHEET_STYLES: Record<SupplyLogItem["sheet_status"], string> = {
  pending: "bg-warning/20 text-warning",
  synced: "bg-rba-green/15 text-rba-green",
  failed: "bg-danger/15 text-danger",
};

/**
 * Supply requests asked for at the kiosk. A log, not a queue: nobody approves
 * or denies these (the office orders from the supplies sheet), so each row only
 * says what was asked for and whether it reached the sheet.
 *
 * Built so a decision can be added later without reworking the page: it is its
 * own section, and each row is one self-contained card.
 *
 * `focusId` is the request an emailed link points at. It is marked and scrolled
 * to once the list is on screen.
 */
export default function SupplySection({ focusId }: { focusId: string | null }) {
  const [items, setItems] = useState<SupplyLogItem[] | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/kiosk-supplies");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Could not load the supply requests");
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

  // Open for an emailed request, and when something has not reached the sheet.
  const needsLook = (items ?? []).some((i) => i.sheet_status !== "synced");
  const open = userOpen ?? (Boolean(focusId) || needsLook);

  useEffect(() => {
    if (!items || !focusId) return;
    document.getElementById(`supply-${focusId}`)?.scrollIntoView({ block: "center" });
  }, [items, focusId, open]);

  return (
    <section id="section-supply" className="border-t border-border">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
        )}
        <h3 className="text-sm font-semibold">{SECTION_TITLES.supply}</h3>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">
          Record only
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          <p className="pb-2 text-xs text-muted">
            Nothing to approve here: the office orders from the supplies sheet. This is the
            log of what was asked for.
          </p>

          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
          )}
          {items === null && (
            <div className="flex justify-center py-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
            </div>
          )}
          {tableMissing && (
            <p className="text-xs text-muted">
              The kiosk&apos;s supply requests are not set up in the database yet.
            </p>
          )}
          {items && items.length === 0 && !tableMissing && !error && (
            <p className="text-xs text-muted">Nothing has been requested yet.</p>
          )}

          <ul className="space-y-2">
            {(items ?? []).map((r) => (
              <li
                key={r.id}
                id={`supply-${r.id}`}
                className={`rounded-lg border bg-background p-3 ${
                  r.id === focusId ? "border-primary ring-2 ring-primary" : "border-border"
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs font-semibold">K-{r.sheet_number}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SHEET_STYLES[r.sheet_status]}`}
                  >
                    {SHEET_LABELS[r.sheet_status]}
                  </span>
                  <span className="ml-auto text-[11px] text-muted">{stampLabel(r.submitted_at)}</span>
                </div>
                <p className="mt-1 text-sm font-medium">{r.item}</p>
                <p className="text-xs text-muted">
                  {r.quantity}
                  {r.quantity_unit ? ` ${r.quantity_unit}` : ""} · {r.employee_name} · {r.department}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {r.reason} · {r.timeline}
                </p>
                {r.item_url ? (
                  <a
                    href={r.item_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{r.item_url}</span>
                  </a>
                ) : (
                  <p className="mt-1 text-xs text-muted">No link: any brand will do.</p>
                )}
                {r.notes && (
                  <p className="mt-1.5 text-xs italic text-muted">&ldquo;{r.notes}&rdquo;</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
