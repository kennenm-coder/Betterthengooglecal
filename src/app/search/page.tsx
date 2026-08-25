"use client";

import { useState, useMemo } from "react";
import { useData } from "@/components/DataProvider";
import OrderSheet from "@/components/OrderSheet";
import BottomNav from "@/components/BottomNav";
import { searchOrders, searchMaterialJobs } from "@/lib/search";
import { lastFirst, extractCity, crewName } from "@/lib/format-utils";
import { typeColor, formatTime, formatDateShort } from "@/lib/calendar-utils";
import { MaterialJobData, WorkOrder } from "@/lib/types";
import { Search, Loader2, X, Database, MapPin, FileText, ClipboardList, Package } from "lucide-react";
import { useRouter } from "next/navigation";
import { isSameDay, parseISO } from "date-fns";

const MAX_RESULTS = 50;

export default function SearchPage() {
  // Use material jobs already loaded by DataProvider — no extra fetch.
  const { orders, materialJobs, loading, loadingBackground } = useData();
  const jobsLoading = loadingBackground && materialJobs.length === 0;
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<WorkOrder | null>(null);
  const [selectedJob, setSelectedJob] = useState<MaterialJobData | null>(null);

  const scheduledPOs = useMemo(
    () => new Set(orders.filter((o) => o.scheduledStart).map((o) => o.orderNumber)),
    [orders]
  );

  const unscheduledJobs = useMemo(
    () => materialJobs.filter((j) => !scheduledPOs.has(j.job.poNumber)),
    [materialJobs, scheduledPOs]
  );

  const trimmed = query.trim();

  const orderResults = useMemo(
    () => (trimmed.length >= 2 ? searchOrders(orders, trimmed).slice(0, MAX_RESULTS) : []),
    [orders, trimmed]
  );
  const jobResults = useMemo(
    () => (trimmed.length >= 2 ? searchMaterialJobs(unscheduledJobs, trimmed).slice(0, MAX_RESULTS) : []),
    [unscheduledJobs, trimmed]
  );

  const totalResults = orderResults.length + jobResults.length;

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-3 py-3 z-20">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, WO#, address, or order#..."
            className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-border bg-surface text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
            autoFocus
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-border"
            >
              <X className="w-4 h-4 text-muted" />
            </button>
          )}
        </div>
        {trimmed.length >= 2 && (
          <p className="text-xs text-muted mt-1.5 px-1">
            {totalResults} result{totalResults !== 1 ? "s" : ""}
            {jobResults.length > 0 && (
              <span>
                {" "}({orderResults.length} scheduled, {jobResults.length} unscheduled)
              </span>
            )}
          </p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading || jobsLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : trimmed.length < 2 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted text-sm">
            <Search className="w-8 h-8 mb-2 opacity-40" />
            <p>{trimmed.length === 0 ? "Search for a customer, work order, or address" : "Type at least 2 characters to search"}</p>
          </div>
        ) : totalResults === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted text-sm">
            <p>No results found for &ldquo;{trimmed}&rdquo;</p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            {orderResults.length > 0 && (
              <>
                {jobResults.length > 0 && (
                  <h3 className="text-xs font-semibold uppercase text-muted px-1">
                    Scheduled ({orderResults.length})
                  </h3>
                )}
                {orderResults.map((order) => (
                  <SearchOrderTile
                    key={order.id}
                    order={order}
                    onTap={() => setSelectedOrder(order)}
                  />
                ))}
              </>
            )}

            {jobResults.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-1 pt-2">
                  <Database className="w-3.5 h-3.5 text-amber-600" />
                  <h3 className="text-xs font-semibold uppercase text-muted">
                    Not Scheduled — Material List ({jobResults.length})
                  </h3>
                </div>
                {jobResults.map((job) => (
                  <MaterialJobTile
                    key={job.id}
                    job={job}
                    onTap={() => setSelectedJob(job)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {selectedOrder && (
        <OrderSheet
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}

      {selectedJob && (
        <MaterialJobSheet
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onOpenInstall={(id) => router.push(`/install/${id}`)}
        />
      )}

      <BottomNav />
    </div>
  );
}

/* ── Compact tile for scheduled work orders ── */

function SearchOrderTile({
  order,
  onTap,
}: {
  order: WorkOrder;
  onTap: () => void;
}) {
  const typeBg = typeColor(order.workOrderType);
  const city = extractCity(order.address);
  const crew = crewName(order);
  const multiDay =
    order.scheduledStart &&
    order.scheduledEnd &&
    !isSameDay(parseISO(order.scheduledStart), parseISO(order.scheduledEnd));

  return (
    <button
      onClick={onTap}
      className="w-full text-left rounded-lg border border-border bg-surface overflow-hidden active:scale-[0.99] transition-transform"
    >
      <div className="flex items-stretch">
        <div className={`w-1.5 ${typeBg} shrink-0`} />
        <div className="flex-1 px-3 py-2.5 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-sm truncate">
              {lastFirst(order.customerName)}
            </span>
            <span className="text-xs text-muted whitespace-nowrap">
              {formatDateShort(order.scheduledStart)}{" "}
              {formatTime(order.scheduledStart)}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-muted">{order.workOrderType}</span>
            <span className="text-xs text-muted">#{order.workOrderNumber}</span>
            {order.materialJob && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#6DB344]/15 text-[#6DB344] font-semibold">
                Linked
              </span>
            )}
            {!order.materialJob && order.legacyInstallUrl && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-semibold">
                Legacy Linked
              </span>
            )}
            {multiDay && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-light text-primary font-medium">
                Multi-day
              </span>
            )}
          </div>
          {city && (
            <div className="flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3 text-muted shrink-0" />
              <span className="text-xs text-muted truncate">{city}</span>
              {crew && (
                <span className="text-xs text-muted truncate ml-1">
                  · {crew}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function MaterialJobTile({ job, onTap }: { job: MaterialJobData; onTap: () => void }) {
  const unitCount = job.units.length;
  const unitSummary = job.units
    .slice(0, 3)
    .map((u) => u.type)
    .join(", ");

  return (
    <button onClick={onTap} className="w-full text-left rounded-lg border border-border bg-surface overflow-hidden active:scale-[0.99] transition-transform">
      <div className="flex">
        <div className="w-1.5 bg-amber-600 shrink-0" />
        <div className="flex-1 px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium text-sm truncate">
              {lastFirst(job.job.customerName)}
            </div>
            <span className="text-xs bg-amber-600/15 text-amber-700 px-1.5 py-0.5 rounded font-medium shrink-0">
              Not Scheduled
            </span>
          </div>
          <div className="text-xs text-muted mt-0.5">
            PO# {job.job.poNumber}
          </div>
          <div className="text-xs text-muted truncate mt-0.5">
            {job.job.address}
          </div>
          <div className="text-xs text-muted mt-1 flex items-center gap-2">
            <span>
              {unitCount} unit{unitCount !== 1 ? "s" : ""}
            </span>
            {unitSummary && (
              <span className="truncate">{unitSummary}</span>
            )}
            {job.submitted && job.status === "awaiting_trim" && (
              <span className="text-xs bg-amber-500/15 text-amber-700 px-1.5 py-0.5 rounded">
                Awaiting Trim
              </span>
            )}
            {job.submitted && (job.status === "trim_ordered" || job.status === "complete") && (
              <span className="text-xs bg-green-600/15 text-green-700 px-1.5 py-0.5 rounded">
                Submitted
              </span>
            )}
          </div>
          {job.job.installNotes && (
            <div className="text-xs text-muted mt-1 truncate italic">
              {job.job.installNotes}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

/* ── Bottom sheet for unscheduled material jobs ── */

function MaterialJobSheet({
  job,
  onClose,
  onOpenInstall,
}: {
  job: MaterialJobData;
  onClose: () => void;
  onOpenInstall: (id: string) => void;
}) {
  const unitCount = job.units.length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative mt-auto bg-background rounded-t-2xl max-h-[85vh] overflow-y-auto animate-slide-up">
        <div className="sticky top-0 bg-background z-10 flex items-center justify-between px-4 py-3 border-b border-border rounded-t-2xl">
          <div className="w-10 h-1 bg-border rounded-full absolute top-2 left-1/2 -translate-x-1/2" />
          <h2 className="font-semibold text-lg mt-2">Job Details</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-surface mt-2">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="flex items-stretch">
              <div className="w-2 bg-amber-600 shrink-0" />
              <div className="flex-1 p-3 min-w-0 space-y-3">
                {/* Header */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-lg truncate">
                      {lastFirst(job.job.customerName)}
                    </h3>
                    <span className="text-xs bg-amber-600/15 text-amber-700 px-2 py-0.5 rounded font-medium shrink-0">
                      Not Scheduled
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {job.submitted && job.status === "awaiting_trim" && (
                      <span className="text-xs bg-amber-500/15 text-amber-700 px-2 py-0.5 rounded font-medium">
                        Awaiting Trim
                      </span>
                    )}
                    {job.submitted && (job.status === "trim_ordered" || job.status === "complete") && (
                      <span className="text-xs bg-green-600/15 text-green-700 px-2 py-0.5 rounded font-medium">
                        Submitted
                      </span>
                    )}
                  </div>
                </div>

                {/* PO # */}
                <div className="flex items-center gap-2 text-[15px]">
                  <Package className="w-4 h-4 text-muted shrink-0" />
                  <span className="text-muted">PO#</span>
                  <span className="font-medium">{job.job.poNumber}</span>
                </div>

                {/* Address */}
                {job.job.address && (
                  <div className="flex items-start gap-2 text-[15px]">
                    <MapPin className="w-4 h-4 text-muted mt-0.5 shrink-0" />
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.job.address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary underline break-words"
                    >
                      {job.job.address}
                    </a>
                  </div>
                )}

                {/* Tech Measurer */}
                {job.job.techMeasurer && (
                  <div className="flex items-center gap-2 text-[15px]">
                    <ClipboardList className="w-4 h-4 text-muted shrink-0" />
                    <span className="text-muted">Measure Tech:</span>
                    <span>{job.job.techMeasurer}</span>
                  </div>
                )}

                {/* Units summary */}
                <div className="flex items-center gap-2 text-[15px]">
                  <Package className="w-4 h-4 text-muted shrink-0" />
                  <span>
                    {unitCount} unit{unitCount !== 1 ? "s" : ""}
                  </span>
                  <span className="text-muted truncate">
                    {job.units.slice(0, 4).map((u) => u.type || u.unitType).filter(Boolean).join(", ")}
                  </span>
                </div>

                {/* Install Notes */}
                {job.job.installNotes?.trim() && (
                  <div className="rounded-lg bg-surface p-3">
                    <div className="flex items-center gap-1.5 mb-1 text-muted">
                      <ClipboardList className="w-3.5 h-3.5" />
                      <span className="text-xs font-semibold uppercase tracking-wide">Install Notes</span>
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">
                      {job.job.installNotes}
                    </p>
                  </div>
                )}

                {/* Open Install Instructions */}
                <button
                  onClick={() => onOpenInstall(job.id)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-primary text-white text-sm font-medium active:scale-[0.98] transition-transform"
                >
                  <FileText className="w-4 h-4" />
                  Open Install Instructions
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
