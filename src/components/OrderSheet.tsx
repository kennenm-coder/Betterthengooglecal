"use client";

import { WorkOrder } from "@/lib/types";
import JobCard from "./JobCard";
import { X } from "lucide-react";

export default function OrderSheet({
  order,
  onClose,
}: {
  order: WorkOrder;
  onClose: () => void;
}) {
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
          <JobCard order={order} />
        </div>
      </div>
    </div>
  );
}
