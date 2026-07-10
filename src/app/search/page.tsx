"use client";

import { useState, useMemo } from "react";
import { useData } from "@/components/DataProvider";
import JobCard from "@/components/JobCard";
import BottomNav from "@/components/BottomNav";
import { searchOrders } from "@/lib/search";
import { Search, Loader2, X } from "lucide-react";

export default function SearchPage() {
  const { orders, loading } = useData();
  const [query, setQuery] = useState("");

  const results = useMemo(() => searchOrders(orders, query), [orders, query]);

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
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : !query ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted text-sm">
            <Search className="w-8 h-8 mb-2 opacity-40" />
            <p>Search for a customer, work order, or address</p>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted text-sm">
            <p>No results found for &ldquo;{query}&rdquo;</p>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {results.map((order) => (
              <JobCard key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
