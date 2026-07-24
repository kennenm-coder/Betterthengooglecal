"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { TimeOffRequest, Employee } from "@/lib/types";
import {
  fetchTimeOffRequests,
  addTimeOffRequest,
  deleteTimeOffRequest,
} from "@/lib/time-off-store";
import employeesData from "@/data/employees.json";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Check,
  Calendar,
} from "lucide-react";
import { format } from "date-fns";

const employees: Employee[] = employeesData as Employee[];

interface DraftRow {
  employee_name: string;
  department: string;
  start_date: string;
  end_date: string;
}

const emptyDraft: DraftRow = {
  employee_name: "",
  department: "",
  start_date: "",
  end_date: "",
};

export default function TimeOffPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<Employee[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const data = await fetchTimeOffRequests();
    setRequests(data);
    setLoading(false);
  }

  function handleNameChange(value: string) {
    setDraft((d) => d && { ...d, employee_name: value, department: "" });
    setHighlightIdx(-1);
    if (value.length >= 1) {
      const lower = value.toLowerCase();
      const matches = employees.filter((e) => {
        const full = `${e.firstName} ${e.lastName}`.toLowerCase();
        return full.includes(lower);
      });
      setSuggestions(matches.slice(0, 8));
      setShowSuggestions(matches.length > 0);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }

  function selectEmployee(emp: Employee) {
    setDraft((d) =>
      d && {
        ...d,
        employee_name: `${emp.firstName} ${emp.lastName}`,
        department: emp.department,
      }
    );
    setShowSuggestions(false);
    setSuggestions([]);
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightIdx >= 0) {
      e.preventDefault();
      selectEmployee(suggestions[highlightIdx]);
    }
  }

  async function handleSave() {
    if (!draft || !draft.employee_name || !draft.start_date) return;
    setSaving(true);
    const result = await addTimeOffRequest({
      employee_name: draft.employee_name,
      department: draft.department,
      start_date: draft.start_date,
      end_date: draft.end_date || null,
    });
    if (result) {
      setRequests((prev) =>
        [...prev, result].sort((a, b) => a.start_date.localeCompare(b.start_date))
      );
      setDraft(null);
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    const ok = await deleteTimeOffRequest(id);
    if (ok) setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  function formatDateDisplay(dateStr: string) {
    try {
      const [y, m, d] = dateStr.split("-").map(Number);
      return format(new Date(y, m - 1, d), "MMM d, yyyy");
    } catch {
      return dateStr;
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="bg-background border-b border-border px-3 py-2.5 flex items-center gap-3 z-20">
        <button
          onClick={() => router.push("/")}
          className="p-1.5 rounded-full hover:bg-surface"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex-1">Time Off Requests</h1>
      </header>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted" />
          </div>
        ) : (
          <div className="min-w-[600px]">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_140px_120px_120px_48px] bg-surface border-b border-border text-xs font-semibold text-muted px-3 py-2 sticky top-0 z-10">
              <span>Employee</span>
              <span>Department</span>
              <span>Start Date</span>
              <span>End Date</span>
              <span />
            </div>

            {/* Existing rows */}
            {requests.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[1fr_140px_120px_120px_48px] border-b border-border/50 px-3 py-2 text-sm items-center hover:bg-surface/50"
              >
                <span className="font-medium">{r.employee_name}</span>
                <span className="text-muted">{r.department}</span>
                <span>{formatDateDisplay(r.start_date)}</span>
                <span className="text-muted">
                  {r.end_date ? formatDateDisplay(r.end_date) : "—"}
                </span>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="p-1.5 rounded-full hover:bg-danger/10 text-muted hover:text-danger transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}

            {requests.length === 0 && !draft && (
              <div className="text-center py-12 text-muted text-sm">
                No time off requests yet. Tap the button below to add one.
              </div>
            )}

            {/* Draft row */}
            {draft && (
              <div className="grid grid-cols-[1fr_140px_120px_120px_48px] border-b-2 border-rba-green/30 bg-rba-green-light/30 px-3 py-2 text-sm items-center gap-1">
                <div className="relative">
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={draft.employee_name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    onKeyDown={handleNameKeyDown}
                    onFocus={() => {
                      if (suggestions.length > 0) setShowSuggestions(true);
                    }}
                    onBlur={() => {
                      setTimeout(() => setShowSuggestions(false), 200);
                    }}
                    placeholder="Employee name..."
                    autoFocus
                    className="w-full border border-border rounded px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-rba-green"
                  />
                  {showSuggestions && suggestions.length > 0 && (
                    <div
                      ref={suggestionsRef}
                      className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg z-30 max-h-48 overflow-y-auto"
                    >
                      {suggestions.map((emp, idx) => (
                        <button
                          key={`${emp.firstName}-${emp.lastName}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectEmployee(emp);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-surface flex justify-between ${
                            idx === highlightIdx ? "bg-surface" : ""
                          }`}
                        >
                          <span className="font-medium">
                            {emp.firstName} {emp.lastName}
                          </span>
                          <span className="text-xs text-muted">
                            {emp.department}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <input
                  type="text"
                  value={draft.department}
                  readOnly
                  placeholder="Auto-filled"
                  className="border border-border rounded px-2 py-1.5 text-sm bg-surface text-muted cursor-not-allowed"
                />

                <input
                  type="date"
                  value={draft.start_date}
                  onChange={(e) =>
                    setDraft((d) => d && { ...d, start_date: e.target.value })
                  }
                  className="border border-border rounded px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-rba-green"
                />

                <input
                  type="date"
                  value={draft.end_date}
                  onChange={(e) =>
                    setDraft((d) => d && { ...d, end_date: e.target.value })
                  }
                  className="border border-border rounded px-2 py-1.5 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-rba-green"
                />

                <button
                  onClick={handleSave}
                  disabled={
                    saving || !draft.employee_name || !draft.start_date
                  }
                  className="p-1.5 rounded-full bg-rba-green text-white disabled:opacity-40 active:scale-95 transition-all"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add row button */}
      {!draft && !loading && (
        <div className="border-t border-border px-3 py-3 safe-area-bottom">
          <button
            onClick={() => setDraft({ ...emptyDraft })}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-rba-green/40 text-rba-green font-medium text-sm hover:bg-rba-green-light/30 active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4" />
            Add Time Off Request
          </button>
        </div>
      )}
    </div>
  );
}
