"use client";

import { AlertTriangle, Clock, RefreshCw } from "lucide-react";

interface StaleTabTagProps {
  isStale: boolean;
  staleAfter: string;
  nextUpdate: string;
  onRefresh: () => void;
}

/**
 * Compact inline tag for the header row (desktop only).
 * Shows either a stale-data warning with refresh button,
 * or a "Next update at X:XX PM" informational tag.
 */
export default function StaleTabTag({
  isStale,
  staleAfter,
  nextUpdate,
  onRefresh,
}: StaleTabTagProps) {
  if (isStale) {
    return (
      <button
        onClick={onRefresh}
        className="hidden md:flex items-center gap-1 text-[11px] font-medium bg-amber-500 text-white rounded-full px-2 py-0.5 hover:bg-amber-600 transition-colors shrink-0 animate-pulse"
        title={`Data may be outdated — new data available since ${staleAfter}`}
      >
        <AlertTriangle className="w-3 h-3" />
        <span>Update available</span>
        <RefreshCw className="w-3 h-3" />
      </button>
    );
  }

  if (!nextUpdate) return null;

  return (
    <span
      className="hidden md:flex items-center gap-1 text-[11px] text-muted bg-surface rounded-full px-2 py-0.5 shrink-0"
      title={`Next data refresh at ${nextUpdate}`}
    >
      <Clock className="w-3 h-3" />
      <span>Next update {nextUpdate}</span>
    </span>
  );
}
