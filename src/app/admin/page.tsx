"use client";

import { useState, useRef, useEffect } from "react";
import { useData } from "@/components/DataProvider";
import {
  getActionTypes,
  setActionTypes,
  getActionLog,
} from "@/lib/action-settings";
import { ActionLogEntry } from "@/lib/types";
import BottomNav from "@/components/BottomNav";
import {
  Upload,
  CheckCircle,
  AlertCircle,
  FileSpreadsheet,
  Loader2,
  ShieldX,
  Plus,
  Trash2,
  ClipboardList,
  Settings,
  X,
  Users,
  LogOut,
  Check,
  UserPlus,
} from "lucide-react";
import { createAuthClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { format, parseISO } from "date-fns";

type DevTab = "settings" | "log" | "upload" | "team";

export default function AdminPage() {
  const { role, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
        <BottomNav />
      </div>
    );
  }

  if (role !== "admin") {
    return (
      <div className="flex flex-col h-full">
        <header className="bg-background border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Dev Settings</h1>
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-3">
            <ShieldX className="w-12 h-12 text-muted mx-auto" />
            <p className="font-medium">Admin access required</p>
            <p className="text-sm text-muted">
              Your account doesn&apos;t have permission to view this page.
            </p>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <UnlockedContent />
      <BottomNav />
    </div>
  );
}

function UnlockedContent() {
  const [tab, setTab] = useState<DevTab>("settings");

  return (
    <>
      <header className="bg-background border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Dev Settings</h1>
        <div className="flex gap-1 mt-2 overflow-x-auto">
          {([
            { id: "settings" as const, label: "Config", icon: Settings },
            { id: "team" as const, label: "Team", icon: Users },
            { id: "log" as const, label: "Action Log", icon: ClipboardList },
            { id: "upload" as const, label: "Upload", icon: Upload },
          ]).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === id
                  ? "bg-primary text-white"
                  : "bg-surface text-muted hover:text-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "settings" && <SettingsTab />}
        {tab === "team" && <TeamTab />}
        {tab === "log" && <LogTab />}
        {tab === "upload" && <UploadTab />}
      </div>
    </>
  );
}

/* ── Team Tab ── */
interface AllowedEmail {
  id: string;
  email: string;
  name: string | null;
  role: string;
  roles: string[] | null;
  auto_cc: string[] | null;
  created_at: string;
}

interface AccessRequest {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

const ROLE_OPTIONS = [
  { value: "member", label: "Member" },
  { value: "payroll-admin", label: "Payroll Admin" },
  { value: "scheduling", label: "Scheduling" },
  { value: "scheduling_manager", label: "Scheduling Manager" },
  { value: "admin", label: "Admin" },
] as const;

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-primary/15 text-primary",
  "payroll-admin": "bg-rba-green/15 text-rba-green",
  scheduling: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  scheduling_manager: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  member: "bg-surface border border-border text-muted",
};

// Calendar-app RLS keys off the single `role` column. When someone holds
// multiple roles we still store one primary `role` (highest calendar role
// present), and the full set in `roles`. Scheduling-only accounts fall back
// to "member" so they can still view the calendar app.
const CALENDAR_ROLE_PRIORITY = ["admin", "payroll-admin", "member"] as const;
function primaryRole(roles: string[]): string {
  for (const r of CALENDAR_ROLE_PRIORITY) if (roles.includes(r)) return r;
  return "member";
}
/** Normalize a row's roles into an array (handles legacy rows with only `role`). */
function rowRoles(entry: { role: string; roles: string[] | null }): string[] {
  if (Array.isArray(entry.roles) && entry.roles.length) return entry.roles;
  return entry.role ? [entry.role] : [];
}

/** Checkbox group for assigning multiple roles. */
function RoleCheckboxes({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((r) => r !== value)
        : [...selected, value]
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {ROLE_OPTIONS.map((r) => {
        const on = selected.includes(r.value);
        return (
          <button
            key={r.value}
            type="button"
            onClick={() => toggle(r.value)}
            className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
              on
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted hover:border-primary/40"
            }`}
          >
            {on && <Check className="w-3 h-3 inline -mt-0.5 mr-1" />}
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

function TeamTab() {
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRoles, setNewRoles] = useState<string[]>(["member"]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [editAutoCc, setEditAutoCc] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const supabase = createAuthClient();
    const [emailsRes, requestsRes] = await Promise.all([
      supabase
        .from("allowed_emails")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("access_requests")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);
    setEmails(emailsRes.data || []);
    setRequests(requestsRes.data || []);
    setLoading(false);
  }

  async function approveRequest(req: AccessRequest) {
    const supabase = createAuthClient();
    const { error: insertError } = await supabase
      .from("allowed_emails")
      .insert({ email: req.email, name: req.name, role: "member" });

    if (insertError && insertError.code !== "23505") return;

    await supabase.from("access_requests").delete().eq("id", req.id);
    setRequests((prev) => prev.filter((r) => r.id !== req.id));
    await loadData();
  }

  async function denyRequest(id: string) {
    const supabase = createAuthClient();
    await supabase.from("access_requests").delete().eq("id", id);
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  async function addEmail() {
    const trimmedEmail = newEmail.trim().toLowerCase();
    const trimmedName = newName.trim();
    if (!trimmedEmail) return;

    setAdding(true);
    setError("");

    const roles = newRoles.length ? newRoles : ["member"];
    const supabase = createAuthClient();
    const { error: insertError } = await supabase
      .from("allowed_emails")
      .insert({ email: trimmedEmail, name: trimmedName || null, role: primaryRole(roles), roles });

    if (insertError) {
      if (insertError.code === "23505") {
        setError("This email is already on the list.");
      } else {
        setError(insertError.message);
      }
    } else {
      setNewEmail("");
      setNewName("");
      setNewRoles(["member"]);
      await loadData();
    }
    setAdding(false);
  }

  function startEdit(entry: AllowedEmail) {
    setError("");
    setEditingId(entry.id);
    setEditName(entry.name || "");
    setEditEmail(entry.email);
    setEditRoles(rowRoles(entry));
    setEditAutoCc((entry.auto_cc || []).join(", "));
  }

  function cancelEdit() {
    setError("");
    setEditingId(null);
  }

  function isLastAdminEntry(entry: AllowedEmail): boolean {
    if (!rowRoles(entry).includes("admin")) return false;
    const adminCount = emails.filter((e) => rowRoles(e).includes("admin")).length;
    return adminCount <= 1;
  }

  async function saveEdit(id: string) {
    const trimmedEmail = editEmail.trim().toLowerCase();
    const trimmedName = editName.trim();
    if (!trimmedEmail) return;

    setError("");
    const roles = editRoles.length ? editRoles : ["member"];

    // Prevent demoting the last admin
    const original = emails.find((e) => e.id === id);
    if (original && rowRoles(original).includes("admin") && !roles.includes("admin")) {
      if (isLastAdminEntry(original)) {
        setError("Cannot demote the last admin. Promote another admin first.");
        return;
      }
    }

    const parsedAutoCc = editAutoCc
      .split(/[,;\n]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes("@"));

    const role = primaryRole(roles);
    const supabase = createAuthClient();
    const { data: updated, error: updateError } = await supabase
      .from("allowed_emails")
      .update({
        email: trimmedEmail,
        name: trimmedName || null,
        role,
        roles,
        auto_cc: parsedAutoCc,
      })
      .eq("id", id)
      .select();

    if (updateError) {
      console.error("saveEdit failed:", updateError);
      setError(updateError.message);
    } else if (!updated || updated.length === 0) {
      // Update succeeded with 0 rows changed — RLS blocked the write.
      setError(
        "Save was blocked by database permissions (no row changed). Your account may not have admin rights in the database."
      );
    } else {
      setEmails((prev) =>
        prev.map((e) =>
          e.id === id
            ? { ...e, email: trimmedEmail, name: trimmedName || null, role, roles, auto_cc: parsedAutoCc }
            : e
        )
      );
      setEditingId(null);
    }
  }

  async function removeEmail(id: string) {
    // Prevent removing the last admin
    const entry = emails.find((e) => e.id === id);
    if (entry && isLastAdminEntry(entry)) {
      setError("Cannot remove the last admin. Promote another admin first.");
      return;
    }

    const supabase = createAuthClient();
    await supabase.from("allowed_emails").delete().eq("id", id);
    setEmails((prev) => prev.filter((e) => e.id !== id));
  }

  async function handleSignOut() {
    const supabase = createAuthClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {requests.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-warning mb-1">
            Pending Requests
          </h2>
          <p className="text-xs text-muted mb-3">
            These people requested access. Approve to add them to the team.
          </p>
          <div className="space-y-2">
            {requests.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-warning/30 bg-warning/5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-warning shrink-0" />
                    {req.name && (
                      <span className="text-sm font-medium truncate">
                        {req.name}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-muted block truncate">
                    {req.email}
                  </span>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <button
                    onClick={() => approveRequest(req)}
                    className="p-1.5 rounded hover:bg-success/10 text-success transition-colors"
                    title="Approve"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => denyRequest(req.id)}
                    className="p-1.5 rounded hover:bg-danger/10 text-danger transition-colors"
                    title="Deny"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-1">
          Allowed Emails
        </h2>
        <p className="text-xs text-muted mb-3">
          Only people on this list can sign in. Add their email, then they can
          create an account.
        </p>

        <div className="space-y-2">
          {emails.map((entry) =>
            editingId === entry.id ? (
              <div
                key={entry.id}
                className="rounded-lg border border-primary bg-surface p-3 space-y-2"
              >
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Name"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <div>
                  <label className="text-[11px] font-medium text-muted mb-1 block">
                    Roles
                  </label>
                  <RoleCheckboxes selected={editRoles} onChange={setEditRoles} />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted mb-1 block">
                    Auto CC on Field Notes
                  </label>
                  <textarea
                    value={editAutoCc}
                    onChange={(e) => setEditAutoCc(e.target.value)}
                    placeholder="email1@company.com, email2@company.com"
                    rows={2}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <p className="text-[10px] text-muted mt-0.5">
                    Comma-separated. These emails auto-CC when this person sends field notes.
                  </p>
                </div>
                {error && (
                  <p className="text-xs text-danger flex items-center gap-1">
                    <AlertCircle className="w-3 h-3 shrink-0" />
                    {error}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => saveEdit(entry.id)}
                    className="flex-1 py-2 rounded-lg bg-primary text-white text-sm font-medium flex items-center justify-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Save
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex-1 py-2 rounded-lg border border-border text-sm font-medium flex items-center justify-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={entry.id}
                onClick={() => startEdit(entry)}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-surface cursor-pointer hover:border-primary/30 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {entry.name && (
                      <span className="text-sm font-medium truncate">
                        {entry.name}
                      </span>
                    )}
                    {rowRoles(entry).map((r) => (
                      <span
                        key={r}
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                          ROLE_STYLES[r] || ROLE_STYLES.member
                        }`}
                      >
                        {ROLE_OPTIONS.find((o) => o.value === r)?.label || r}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-muted block truncate">
                    {entry.email}
                  </span>
                  {entry.auto_cc && entry.auto_cc.length > 0 && (
                    <span className="text-[10px] text-muted mt-0.5 block truncate">
                      CC: {entry.auto_cc.join(", ")}
                    </span>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeEmail(entry.id);
                  }}
                  className="p-1.5 rounded hover:bg-danger/10 text-muted hover:text-danger transition-colors shrink-0 ml-2"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )
          )}

          {emails.length === 0 && (
            <div className="text-center py-6 text-muted">
              <Users className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">No emails added yet</p>
              <p className="text-xs mt-1">
                Add team member emails below to grant access
              </p>
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
          Add Team Member
        </h2>
        <div className="space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name (optional)"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <div className="flex gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setError("");
              }}
              onKeyDown={(e) => e.key === "Enter" && addEmail()}
              placeholder="email@company.com"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={addEmail}
              disabled={adding || !newEmail.trim()}
              className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50"
            >
              {adding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </button>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted mb-1 block">
              Roles
            </label>
            <RoleCheckboxes selected={newRoles} onChange={setNewRoles} />
          </div>
          {error && (
            <p className="text-xs text-danger flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {error}
            </p>
          )}
        </div>
      </section>

      <section className="pt-4 border-t border-border">
        <button
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-border text-danger text-sm font-medium hover:bg-danger/5 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign Out
        </button>
      </section>
    </div>
  );
}

/* ── Settings Tab ── */
function SettingsTab() {
  const [actionTypes, setTypes] = useState<string[]>([]);
  const [newType, setNewType] = useState("");

  useEffect(() => {
    getActionTypes().then(setTypes);
  }, []);

  function addType() {
    if (!newType.trim()) return;
    const updated = [...actionTypes, newType.trim()];
    setTypes(updated);
    setActionTypes(updated);
    setNewType("");
  }

  function removeType(idx: number) {
    const updated = actionTypes.filter((_, i) => i !== idx);
    setTypes(updated);
    setActionTypes(updated);
  }

  return (
    <div className="space-y-6">
      {/* Action Types */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
          Action Types
        </h2>
        <div className="space-y-2">
          {actionTypes.map((type, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-surface"
            >
              <span className="text-sm font-medium">{type}</span>
              <button
                onClick={() => removeType(i)}
                className="p-1 rounded hover:bg-danger/10 text-muted hover:text-danger transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              type="text"
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addType()}
              placeholder="New action type..."
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              onClick={addType}
              className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}

/* ── Action Log Tab ── */
function LogTab() {
  const [log] = useState<ActionLogEntry[]>(() => getActionLog());

  if (log.length === 0) {
    return (
      <div className="text-center py-12 text-muted">
        <ClipboardList className="w-10 h-10 mx-auto mb-2" />
        <p className="text-sm">No actions logged yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {log.map((entry) => (
        <div
          key={entry.id}
          className="rounded-lg border border-border p-3 bg-surface space-y-1"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary-light text-primary">
                {entry.actionType}
              </span>
              <span className="text-xs text-muted">
                {format(parseISO(entry.timestamp), "MMM d, yyyy h:mm a")}
              </span>
            </div>
          </div>
          <p className="text-sm font-medium">
            {entry.customerName} — #{entry.workOrderNumber}
          </p>
          <p className="text-xs text-muted">
            Logged by: {entry.person.name}
          </p>
          {entry.notes && (
            <p className="text-xs text-muted mt-1 line-clamp-2">{entry.notes}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Upload Tab ── */
function UploadTab() {
  const { orders, lastUpdated, refresh } = useData();

  // Full work order upload state
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Account name upload state
  const [acctUploading, setAcctUploading] = useState(false);
  const [acctResult, setAcctResult] = useState<{ success: boolean; message: string } | null>(null);
  const [acctDragOver, setAcctDragOver] = useState(false);
  const acctFileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();

      if (res.ok && json.success) {
        await refresh();
        setResult({
          success: true,
          message: `Uploaded ${json.parsed} orders to cloud. Material data will link automatically.`,
        });
      } else {
        await refresh();
        setResult({
          success: false,
          message: json.error || `Cloud sync failed. Calendar restored from cloud data.`,
        });
      }
    } catch {
      await refresh();
      setResult({ success: false, message: "Upload failed. Calendar restored from cloud data." });
    } finally {
      setUploading(false);
    }
  }

  async function handleAccountFile(file: File) {
    setAcctUploading(true);
    setAcctResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      setAcctResult({ success: true, message: "Uploading accounts..." });

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();

      if (res.ok && json.success) {
        setAcctResult({
          success: true,
          message: `Done — ${json.parsed} accounts processed, ${json.inserted || 0} new, ${json.updated || 0} updated.`,
        });
      } else {
        setAcctResult({
          success: false,
          message: json.error || "Account name upload failed.",
        });
      }
    } catch {
      setAcctResult({ success: false, message: "Account name upload failed." });
    } finally {
      setAcctUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="rounded-lg border border-border p-4 bg-surface">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="w-8 h-8 text-primary" />
          <div>
            <p className="font-medium">{orders.length} orders loaded</p>
            {lastUpdated && (
              <p className="text-sm text-muted">
                Last updated:{" "}
                {format(parseISO(lastUpdated), "MMM d, yyyy 'at' h:mm a")}
              </p>
            )}
            {!lastUpdated && (
              <p className="text-sm text-muted">No data uploaded yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Full Work Order Upload */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">
          Full Work Order Upload
        </h2>
        <p className="text-xs text-muted mb-3">
          Uploads or updates all work order fields. Used for the main Salesforce report.
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onClick={() => fileRef.current?.click()}
          className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-primary bg-primary-light"
              : "border-border hover:border-primary/50 hover:bg-surface"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xls,.xlsx,.html,.csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            className="hidden"
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted">Processing file...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-8 h-8 text-muted" />
              <p className="font-medium text-sm">Drag & drop work order file</p>
              <p className="text-xs text-muted">or tap to browse</p>
            </div>
          )}
        </div>
        {result && (
          <div className={`rounded-lg border p-3 flex items-start gap-3 mt-2 ${
            result.success ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"
          }`}>
            {result.success ? (
              <CheckCircle className="w-5 h-5 text-success shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
            )}
            <p className="text-sm">{result.message}</p>
          </div>
        )}
      </section>

      {/* Account Name Upload */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">
          Account Name Upload
        </h2>
        <p className="text-xs text-muted mb-3">
          Updates only the account name on existing work orders. Does not delete or overwrite other data.
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setAcctDragOver(true); }}
          onDragLeave={() => setAcctDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setAcctDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleAccountFile(f); }}
          onClick={() => acctFileRef.current?.click()}
          className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
            acctDragOver
              ? "border-rba-green bg-rba-green/10"
              : "border-border hover:border-rba-green/50 hover:bg-surface"
          }`}
        >
          <input
            ref={acctFileRef}
            type="file"
            accept=".xls,.xlsx,.html,.csv"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAccountFile(f); e.target.value = ""; }}
            className="hidden"
          />
          {acctUploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-8 h-8 text-rba-green animate-spin" />
              <p className="text-sm text-muted">Updating account names...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-8 h-8 text-rba-green" />
              <p className="font-medium text-sm">Drag & drop account name file</p>
              <p className="text-xs text-muted">or tap to browse</p>
            </div>
          )}
        </div>
        {acctResult && (
          <div className={`rounded-lg border p-3 flex items-start gap-3 mt-2 ${
            acctResult.success ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"
          }`}>
            {acctResult.success ? (
              <CheckCircle className="w-5 h-5 text-success shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
            )}
            <p className="text-sm">{acctResult.message}</p>
          </div>
        )}
      </section>
    </div>
  );
}
