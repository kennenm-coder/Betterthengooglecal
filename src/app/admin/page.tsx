"use client";

import { useState, useRef, useEffect } from "react";
import { useData } from "@/components/DataProvider";
import { parseXlsHtml } from "@/lib/parse-xls";
import { parseCsv } from "@/lib/parse-csv";
import { upsertWorkOrders, insertNewAccounts } from "@/lib/store";
import { parseAccountsCsv, isAccountsCsv } from "@/lib/parse-accounts-csv";
import {
  getActionTypes,
  setActionTypes,
  getActionPeople,
  setActionPeople,
  getActionLog,
} from "@/lib/action-settings";
import { ActionPerson, ActionLogEntry } from "@/lib/types";
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
  created_at: string;
}

function TeamTab() {
  const [emails, setEmails] = useState<AllowedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"member" | "admin">("member");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadEmails();
  }, []);

  async function loadEmails() {
    setLoading(true);
    const supabase = createAuthClient();
    const { data } = await supabase
      .from("allowed_emails")
      .select("*")
      .order("created_at", { ascending: true });
    setEmails(data || []);
    setLoading(false);
  }

  async function addEmail() {
    const trimmedEmail = newEmail.trim().toLowerCase();
    const trimmedName = newName.trim();
    if (!trimmedEmail) return;

    setAdding(true);
    setError("");

    const supabase = createAuthClient();
    const { error: insertError } = await supabase
      .from("allowed_emails")
      .insert({ email: trimmedEmail, name: trimmedName || null, role: newRole });

    if (insertError) {
      if (insertError.code === "23505") {
        setError("This email is already on the list.");
      } else {
        setError(insertError.message);
      }
    } else {
      setNewEmail("");
      setNewName("");
      setNewRole("member");
      await loadEmails();
    }
    setAdding(false);
  }

  async function toggleRole(id: string, currentRole: string) {
    const next = currentRole === "admin" ? "member" : "admin";
    const supabase = createAuthClient();
    await supabase.from("allowed_emails").update({ role: next }).eq("id", id);
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, role: next } : e))
    );
  }

  async function removeEmail(id: string) {
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
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-1">
          Allowed Emails
        </h2>
        <p className="text-xs text-muted mb-3">
          Only people on this list can sign in. Add their email, then they can
          open the app and request a magic link.
        </p>

        <div className="space-y-2">
          {emails.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-surface"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {entry.name && (
                    <span className="text-sm font-medium truncate">
                      {entry.name}
                    </span>
                  )}
                  <button
                    onClick={() => toggleRole(entry.id, entry.role)}
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                      entry.role === "admin"
                        ? "bg-primary/15 text-primary"
                        : "bg-surface border border-border text-muted"
                    }`}
                  >
                    {entry.role === "admin" ? "Admin" : "Member"}
                  </button>
                </div>
                <span className="text-xs text-muted block truncate">
                  {entry.email}
                </span>
              </div>
              <button
                onClick={() => removeEmail(entry.id)}
                className="p-1.5 rounded hover:bg-danger/10 text-muted hover:text-danger transition-colors shrink-0 ml-2"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}

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
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "member" | "admin")}
              className="rounded-lg border border-border bg-background px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
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
  const [people, setPeople] = useState<ActionPerson[]>([]);
  const [newType, setNewType] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    getActionTypes().then(setTypes);
    getActionPeople().then(setPeople);
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

  function addPerson() {
    if (!newName.trim() || !newEmail.trim()) return;
    const updated = [...people, { name: newName.trim(), email: newEmail.trim() }];
    setPeople(updated);
    setActionPeople(updated);
    setNewName("");
    setNewEmail("");
  }

  function removePerson(idx: number) {
    const updated = people.filter((_, i) => i !== idx);
    setPeople(updated);
    setActionPeople(updated);
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

      {/* People */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-3">
          People
        </h2>
        <div className="space-y-2">
          {people.map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-surface"
            >
              <div>
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-xs text-muted ml-2">{p.email}</span>
              </div>
              <button
                onClick={() => removePerson(i)}
                className="p-1 rounded hover:bg-danger/10 text-muted hover:text-danger transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <div className="space-y-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <div className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPerson()}
                placeholder="Email"
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={addPerson}
                className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ── Action Log Tab ── */
function LogTab() {
  const [log, setLog] = useState<ActionLogEntry[]>([]);

  useEffect(() => {
    setLog(getActionLog());
  }, []);

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
      const text = await file.text();
      let parsed = parseXlsHtml(text);
      if (parsed.length === 0) {
        parsed = parseCsv(text);
      }

      if (parsed.length === 0) {
        setResult({ success: false, message: "No orders found in file." });
        setUploading(false);
        return;
      }

      const supaOk = await upsertWorkOrders(parsed);

      if (supaOk) {
        await refresh();
        setResult({
          success: true,
          message: `Uploaded ${parsed.length} orders to cloud. Material data will link automatically.`,
        });
      } else {
        await refresh();
        setResult({
          success: false,
          message: `Cloud sync failed for ${parsed.length} orders. Calendar restored from cloud data.`,
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
      const text = await file.text();
      if (!isAccountsCsv(text)) {
        setAcctResult({ success: false, message: "Not an accounts CSV. Needs 'Account Name' column." });
        return;
      }
      const accounts = parseAccountsCsv(text);
      if (accounts.length === 0) {
        setAcctResult({ success: false, message: "No account names found in file." });
        return;
      }

      setAcctResult({ success: true, message: `Parsing ${accounts.length} accounts...` });

      const { inserted, total } = await insertNewAccounts(accounts, (done, all) => {
        setAcctResult({ success: true, message: `Processing ${done} / ${all} accounts...` });
      });

      setAcctResult({
        success: true,
        message: `Done — ${total} unique accounts processed, new ones added, existing skipped.`,
      });
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
