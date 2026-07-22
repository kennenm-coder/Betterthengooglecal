"use client";

import { useState, useMemo, useEffect } from "react";
import { useData } from "@/components/DataProvider";
import JobCard from "@/components/JobCard";
import BottomNav from "@/components/BottomNav";
import { searchOrders, searchMaterialJobs } from "@/lib/search";
import { fetchAllMaterialJobs } from "@/lib/store";
import { lastFirst } from "@/lib/format-utils";
import { MaterialJobData } from "@/lib/types";
import { Search, Loader2, X, Database } from "lucide-react";

export default function SearchPage() {
  const { orders, loading } = useData();
  const [query, setQuery] = useState("");
  const [materialJobs, setMaterialJobs] = useState<MaterialJobData[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);

  useEffect(() => {
    fetchAllMaterialJobs()
      .then(setMaterialJobs)
      .finally(() => setJobsLoading(false));
  }, []);

  const scheduledPOs = useMemo(
    () => new Set(orders.filter((o) => o.scheduledStart).map((o) => o.orderNumber)),
    [orders]
  );

  const unscheduledJobs = useMemo(
    () => materialJobs.filter((j) => !scheduledPOs.has(j.job.poNumber)),
    [materialJobs, scheduledPOs]
  );

  const orderResults = useMemo(() => searchOrders(orders, query), [orders, query]);
  const jobResults = useMemo(
    () => searchMaterialJobs(unscheduledJobs, query),
    [unscheduledJobs, query]
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
        {query && (
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
        ) : !query ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted text-sm">
            <Search className="w-8 h-8 mb-2 opacity-40" />
            <p>Search for a customer, work order, or address</p>
          </div>
        ) : totalResults === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted text-sm">
            <p>No results found for &ldquo;{query}&rdquo;</p>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {orderResults.length > 0 && (
              <>
                {jobResults.length > 0 && (
                  <h3 className="text-xs font-semibold uppercase text-muted px-1">
                    Scheduled ({orderResults.length})
                  </h3>
                )}
                {orderResults.map((order) => (
                  <JobCard key={order.id} order={order} />
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
                  <MaterialJobTile key={job.id} job={job} />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}

function MaterialJobTile({ job }: { job: MaterialJobData }) {
  const unitCount = job.units.length;
  const unitSummary = job.units
    .slice(0, 3)
    .map((u) => u.type)
    .join(", ");

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="flex">
        <div className="w-1 bg-amber-600 shrink-0" />
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
            {job.submitted && (
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
    </div>
  );
}
