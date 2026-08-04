"use client";

import { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TimeOffRequest, Employee } from "@/lib/types";
import {
  fetchTimeOffRequests,
  addTimeOffRequest,
  deleteTimeOffRequest,
  fetchEmployees,
  addEmployee,
} from "@/lib/time-off-store";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Check,
  X,
  Calendar,
  Download,
  UserPlus,
  Filter,
  ShieldX,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";

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

interface NewEmployee {
  firstName: string;
  lastName: string;
  department: string;
}

const emptyEmployee: NewEmployee = { firstName: "", lastName: "", department: "" };

export default function TimeOffPage() {
  return (
    <Suspense>
      <TimeOffContent />
    </Suspense>
  );
}

function TimeOffContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromScheduler = searchParams.get("from") === "scheduler";
  const { role, loading: authLoading } = useAuth();
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<Employee[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const filterStartRef = useRef<HTMLInputElement>(null);
  const filterEndRef = useRef<HTMLInputElement>(null);

  // Add employee state
  const [showAddEmployee, setShowAddEmployee] = useState(false);
  const [newEmp, setNewEmp] = useState<NewEmployee>({ ...emptyEmployee });
  const [savingEmp, setSavingEmp] = useState(false);

  // Date filter state
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [reqData, empData] = await Promise.all([
      fetchTimeOffRequests(),
      fetchEmployees(),
    ]);
    setRequests(reqData);
    setEmployees(empData);
    setLoading(false);
  }

  const filteredRequests = useMemo(() => {
    if (!filterStart && !filterEnd) return requests;
    return requests.filter((r) => {
      const reqEnd = r.end_date || r.start_date;
      if (filterStart && reqEnd < filterStart) return false;
      if (filterEnd && r.start_date > filterEnd) return false;
      return true;
    });
  }, [requests, filterStart, filterEnd]);

  const hasActiveFilter = filterStart || filterEnd;

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

  async function handleAddEmployee() {
    if (!newEmp.firstName || !newEmp.lastName || !newEmp.department) return;
    setSavingEmp(true);
    const result = await addEmployee(newEmp);
    if (result) {
      setEmployees((prev) =>
        [...prev, result].sort((a, b) =>
          a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)
        )
      );
      setNewEmp({ ...emptyEmployee });
      setShowAddEmployee(false);
    }
    setSavingEmp(false);
  }

  function exportCsv() {
    const data = filteredRequests;
    if (data.length === 0) return;
    const header = "Employee,Department,Start Date,End Date";
    const rows = data.map((r) => {
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

  if (authLoading) {
    return (
      <div className="flex flex-col h-full bg-background items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (role !== "admin") {
    return (
      <div className="flex flex-col h-full bg-background items-center justify-center p-4">
        <div className="text-center space-y-3">
          <ShieldX className="w-12 h-12 text-muted mx-auto" />
          <p className="font-medium">Admin access required</p>
          <p className="text-sm text-muted">
            Your account doesn&apos;t have permission to manage time off.
          </p>
          <button
            onClick={() => fromScheduler ? window.close() : router.push("/")}
            className="mt-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="bg-background border-b border-border px-3 py-2.5 flex items-center gap-2 z-20">
        <button
          onClick={() => {
            if (fromScheduler) {
              window.close();
            } else {
              router.push("/");
            }
          }}
          className="p-1.5 rounded-full hover:bg-surface"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex-1">Time Off Requests</h1>
        {!loading && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowAddEmployee(true)}
              className="p-1.5 rounded-full hover:bg-surface text-muted"
              title="Add Employee"
            >
              <UserPlus className="w-4.5 h-4.5" />
            </button>
            {filteredRequests.length > 0 && (
              <button
                onClick={exportCsv}
                className="p-1.5 rounded-full hover:bg-surface text-muted"
                title="Export CSV"
              >
                <Download className="w-4.5 h-4.5" />
              </button>
            )}
            {!draft && (
              <button
                onClick={() => setDraft({ ...emptyDraft })}
                className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-rba-green text-white font-medium active:scale-[0.97] transition-all"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            )}
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
            {/* Add Employee modal */}
            {showAddEmployee && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-background rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold">Add Employee</h2>
                    <button
                      onClick={() => { setShowAddEmployee(false); setNewEmp({ ...emptyEmployee }); }}
                      className="p-1 rounded-full hover:bg-surface"
                    >
                      <X className="w-4 h-4 text-muted" />
                    </button>
                  </div>
                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">First Name</label>
                      <input
                        type="text"
                        value={newEmp.firstName}
                        onChange={(e) => setNewEmp((p) => ({ ...p, firstName: e.target.value }))}
                        autoFocus
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-rba-green"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">Last Name</label>
                      <input
                        type="text"
                        value={newEmp.lastName}
                        onChange={(e) => setNewEmp((p) => ({ ...p, lastName: e.target.value }))}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-rba-green"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">Department</label>
                      <input
                        type="text"
                        value={newEmp.department}
                        onChange={(e) => setNewEmp((p) => ({ ...p, department: e.target.value }))}
                        className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-rba-green"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleAddEmployee}
                    disabled={savingEmp || !newEmp.firstName || !newEmp.lastName || !newEmp.department}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-rba-green text-white font-medium text-sm disabled:opacity-40 active:scale-[0.98] transition-all"
                  >
                    {savingEmp ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Add Employee
                  </button>
                </div>
              </div>
            )}

            {/* Date filter bar */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-surface/50 border-b border-border">
              <Filter className="w-3.5 h-3.5 text-muted shrink-0" />
              <span className="text-xs text-muted shrink-0">Filter:</span>
              <div
                className="relative border border-border rounded-md bg-background cursor-pointer"
                onClick={() => filterStartRef.current?.showPicker?.()}
              >
                <input
                  ref={filterStartRef}
                  type="date"
                  value={filterStart}
                  onChange={(e) => setFilterStart(e.target.value)}
                  className="px-2 py-1 text-xs bg-transparent focus:outline-none cursor-pointer w-[130px]"
                  placeholder="From"
                />
              </div>
              <span className="text-xs text-muted">to</span>
              <div
                className="relative border border-border rounded-md bg-background cursor-pointer"
                onClick={() => filterEndRef.current?.showPicker?.()}
              >
                <input
                  ref={filterEndRef}
                  type="date"
                  value={filterEnd}
                  onChange={(e) => setFilterEnd(e.target.value)}
                  className="px-2 py-1 text-xs bg-transparent focus:outline-none cursor-pointer w-[130px]"
                  placeholder="To"
                />
              </div>
              {hasActiveFilter && (
                <button
                  onClick={() => { setFilterStart(""); setFilterEnd(""); }}
                  className="text-xs text-danger hover:underline shrink-0"
                >
                  Clear
                </button>
              )}
              {hasActiveFilter && (
                <span className="text-xs text-muted ml-auto">
                  {filteredRequests.length} result{filteredRequests.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Add time off form */}
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

                  {draft.department && (
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">Department</label>
                      <div className="border border-border rounded-lg px-3 py-2.5 text-sm bg-surface text-muted">
                        {draft.department}
                      </div>
                    </div>
                  )}

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

            {/* Desktop table header */}
            <div className="hidden sm:grid grid-cols-[1fr_140px_120px_120px_40px] bg-surface border-b border-border text-xs font-semibold text-muted px-4 py-2 sticky top-0 z-10">
              <span>Employee</span>
              <span>Department</span>
              <span>Start</span>
              <span>End</span>
              <span />
            </div>

            {/* Rows */}
            {filteredRequests.map((r) => (
              <div key={r.id} className="border-b border-border/50 hover:bg-surface/50">
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

            {filteredRequests.length === 0 && !draft && (
              <div className="text-center py-16 px-4">
                <Calendar className="w-10 h-10 text-muted/40 mx-auto mb-3" />
                {hasActiveFilter ? (
                  <>
                    <p className="text-muted text-sm">No requests in this date range.</p>
                    <button
                      onClick={() => { setFilterStart(""); setFilterEnd(""); }}
                      className="text-rba-green text-sm mt-2 hover:underline"
                    >
                      Clear filter
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-muted text-sm">No time off requests yet.</p>
                    <p className="text-muted/60 text-xs mt-1">Tap the Add button above to get started.</p>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
