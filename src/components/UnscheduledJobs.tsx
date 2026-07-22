"use client";

import { useEffect, useState } from "react";
import { MaterialJobData, WorkOrder } from "@/lib/types";
import { fetchAllMaterialJobs } from "@/lib/store";
import { lastFirst } from "@/lib/format-utils";
import { Loader2, Database, Package } from "lucide-react";

export default function UnscheduledJobs({
  orders,
  onSelectOrder,
}: {
  orders: WorkOrder[];
  onSelectOrder: (order: WorkOrder) => void;
}) {
  const [jobs, setJobs] = useState<MaterialJobData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllMaterialJobs()
      .then(setJobs)
      .finally(() => setLoading(false));
  }, []);

  const scheduledPOs = new Set(
    orders.filter((o) => o.scheduledStart).map((o) => o.orderNumber)
  );

  const unscheduledJobs = jobs.filter((j) => !scheduledPOs.has(j.job.poNumber));
  const scheduledJobs = jobs.filter((j) => scheduledPOs.has(j.job.poNumber));

  const handleTap = (job: MaterialJobData) => {
    const match = orders.find((o) => o.orderNumber === job.job.poNumber);
    if (match) {
      onSelectOrder(match);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain">
      <div className="sticky top-0 bg-background z-10 px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-primary" />
          <h2 className="text-lg font-semibold">Material List Jobs</h2>
        </div>
        <p className="text-sm text-muted">
          {jobs.length} total from database &middot; {unscheduledJobs.length} not
          scheduled &middot; {scheduledJobs.length} scheduled
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted gap-2">
          <Package className="w-10 h-10" />
          <p className="text-sm">No material list jobs found in database</p>
        </div>
      ) : (
        <div className="px-3 py-2 space-y-4">
          {unscheduledJobs.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase text-muted px-1 mb-2">
                Not Scheduled ({unscheduledJobs.length})
              </h3>
              <div className="space-y-1">
                {unscheduledJobs.map((job) => (
                  <JobTile key={job.id} job={job} matched={false} onTap={() => {}} />
                ))}
              </div>
            </section>
          )}

          {scheduledJobs.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase text-muted px-1 mb-2">
                Scheduled ({scheduledJobs.length})
              </h3>
              <div className="space-y-1">
                {scheduledJobs.map((job) => (
                  <JobTile
                    key={job.id}
                    job={job}
                    matched={true}
                    onTap={() => handleTap(job)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function JobTile({
  job,
  matched,
  onTap,
}: {
  job: MaterialJobData;
  matched: boolean;
  onTap: () => void;
}) {
  const unitCount = job.units.length;
  const unitSummary = job.units
    .slice(0, 3)
    .map((u) => u.type)
    .join(", ");

  return (
    <button
      onClick={onTap}
      disabled={!matched}
      className={`w-full text-left rounded-md px-2.5 py-1.5 text-white text-sm transition-all active:scale-[0.98] ${
        matched ? "bg-install" : "bg-amber-600"
      }`}
    >
      <div className="font-medium truncate">
        {lastFirst(job.job.customerName)} - {job.job.poNumber}
      </div>
      <div className="text-xs opacity-90 flex items-center gap-2">
        <span>
          {unitCount} unit{unitCount !== 1 ? "s" : ""}
        </span>
        {unitSummary && <span className="truncate">{unitSummary}</span>}
        {job.submitted && (
          <span className="bg-white/20 rounded px-1">Submitted</span>
        )}
      </div>
      <div className="text-xs opacity-75 truncate mt-0.5">
        {job.job.address}
      </div>
    </button>
  );
}
