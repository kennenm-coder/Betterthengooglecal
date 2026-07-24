"use client";

import { useState, useEffect, useRef } from "react";
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
  X,
  Calendar,
  Download,
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
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);

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

  function exportCsv() {
    if (requests.length === 0) return;
    const header = "Employee,Department,Start Date,End Date";
    const rows = requests.map((r) => {
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [
        esc(r.employee_name),
        esc(r.department),
        r.start_date,
        r.end_date || "",
      ].join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `time-off-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
        {!draft && !loading && (
          <div className="flex items-center gap-2">
            {requests.length > 0 && (
              <button
                onClick={exportCsv}
                className="p-1.5 rounded-full hover:bg-surface text-muted"
                title="Export CSV"
              >
                <Download className="w-4.5 h-4.5" />
              </button>
            )}
            <button
              onClick={() => setDraft({ ...emptyDraft })}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-rba-green text-white font-medium active:scale-[0.97] transition-all"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted" />
          </div>
        ) : (
          <div className="max-w-3xl mx-auto w-full">
            {/* Add form */}
            {draft && (
              <div className="border-b-2 border-rba-green/30 bg-rba-green-light/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-rba-green">New Time Off Request</h2>
                  <button
                    onClick={() => { setDraft(null); setShowSuggestions(false); }}
                    className="p-1 rounded-full hover:bg-surface"
                  >
                    <X className="w-4 h-4 text-muted" />
                  </button>
                </div>

                <div className="space-y-2.5">
                  {/* Employee name */}
                  <div className="relative">
                    <label className="block text-xs font-medium text-muted mb-1">Employee</label>
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
                      placeholder="Start typing a name..."
                      autoFocus
                      className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-rba-green"
                    />
                    {showSuggestions && suggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-border rounded-lg shadow-lg z-30 max-h-48 overflow-y-auto">
                        {suggestions.map((emp, idx) => (
                          <button
                            key={`${emp.firstName}-${emp.lastName}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectEmployee(emp);
                            }}
                            className={`w-full text-left px-3 py-2.5 text-sm hover:bg-surface flex justify-between ${
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

                  {/* Department (auto-filled) */}
                  {draft.department && (
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">Department</label>
                      <div className="border border-border rounded-lg px-3 py-2.5 text-sm bg-surface text-muted">
                        {draft.department}
                      </div>
                    </div>
                  )}

                  {/* Dates side by side */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">
                        Start Date <span className="text-danger">*</span>
                      </label>
                      <div
                        className="relative border border-border rounded-lg bg-background focus-within:ring-2 focus-within:ring-rba-green cursor-pointer"
                        onClick={() => startDateRef.current?.showPicker?.()}
                      >
                        <input
                          ref={startDateRef}
                          type="date"
                          value={draft.start_date}
                          onChange={(e) =>
                            setDraft((d) => d && { ...d, start_date: e.target.value })
                          }
                          className="w-full px-3 py-2.5 text-sm bg-transparent focus:outline-none cursor-pointer"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">
                        End Date <span className="text-xs font-normal">(optional)</span>
                      </label>
                      <div
                        className="relative border border-border rounded-lg bg-background focus-within:ring-2 focus-within:ring-rba-green cursor-pointer"
                        onClick={() => endDateRef.current?.showPicker?.()}
                      >
                        <input
                          ref={endDateRef}
                          type="date"
                          value={draft.end_date}
                          onChange={(e) =>
                            setDraft((d) => d && { ...d, end_date: e.target.value })
                          }
                          className="w-full px-3 py-2.5 text-sm bg-transparent focus:outline-none cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Save button */}
                <button
                  onClick={handleSave}
                  disabled={saving || !draft.employee_name || !draft.start_date}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-rba-green text-white font-medium text-sm disabled:opacity-40 active:scale-[0.98] transition-all"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Save Request
                </button>
              </div>
            )}

            {/* Desktop table header - hidden on mobile */}
            <div className="hidden sm:grid grid-cols-[1fr_140px_120px_120px_40px] bg-surface border-b border-border text-xs font-semibold text-muted px-4 py-2 sticky top-0 z-10">
              <span>Employee</span>
              <span>Department</span>
              <span>Start</span>
              <span>End</span>
              <span />
            </div>

            {/* Rows */}
            {requests.map((r) => (
              <div key={r.id} className="border-b border-border/50 hover:bg-surface/50">
                {/* Desktop row */}
                <div className="hidden sm:grid grid-cols-[1fr_140px_120px_120px_40px] px-4 py-2.5 text-sm items-center">
                  <span className="font-medium">{r.employee_name}</span>
                  <span className="text-muted">{r.department}</span>
                  <span>{formatDateDisplay(r.start_date)}</span>
                  <span className="text-muted">
                    {r.end_date ? formatDateDisplay(r.end_date) : "—"}
                  </span>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="p-1 rounded-full hover:bg-danger/10 text-muted hover:text-danger transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Mobile row */}
                <div className="sm:hidden px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{r.employee_name}</div>
                    <div className="text-xs text-muted mt-0.5">{r.department}</div>
                    <div className="flex items-center gap-1.5 mt-1 text-xs">
                      <Calendar className="w-3 h-3 text-muted" />
                      <span>{formatDateDisplay(r.start_date)}</span>
                      {r.end_date && (
                        <>
                          <span className="text-muted">→</span>
                          <span>{formatDateDisplay(r.end_date)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="p-2 rounded-full hover:bg-danger/10 text-muted hover:text-danger transition-colors shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}

            {requests.length === 0 && !draft && (
              <div className="text-center py-16 px-4">
                <Calendar className="w-10 h-10 text-muted/40 mx-auto mb-3" />
                <p className="text-muted text-sm">No time off requests yet.</p>
                <p className="text-muted/60 text-xs mt-1">Tap the Add button above to get started.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
