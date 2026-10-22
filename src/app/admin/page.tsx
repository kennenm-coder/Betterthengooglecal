"use client";

import { useState, useRef, useEffect } from "react";
import { useData } from "@/components/DataProvider";
import {
  getActionTypes,
  setActionTypes,
  getActionLog,
  getWriteUpEmails,
  setWriteUpEmails,
  getFieldNotesEmail,
  setFieldNotesEmail,
  DEFAULT_WRITEUP_EMAIL,
  DEFAULT_FIELDNOTES_EMAIL,
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
  Search,
  ShieldAlert,
} from "lucide-react";
import { createAuthClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ROLE_OPTIONS,
  ROLE_STYLES,
  ROLE_LABELS,
  isAdmin,
  installerRoleConflict,
} from "@/lib/roles";
import { getWriteUpPresets, setWriteUpPresets } from "@/lib/work-order-store";
import { format, parseISO } from "date-fns";

type DevTab = "settings" | "log" | "upload" | "team";

export default function AdminPage() {
  const { roles, loading } = useAuth();

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

  // Admins (holding admin among any of their roles) get the full page.
  // Checked before payroll so an admin+payroll account isn't limited to Team.
  const admin = isAdmin(roles);

  // Payroll admins (without admin) get access to the Team tab only.
  if (!admin && roles.includes("payroll-admin")) {
    return (
      <div className="flex flex-col h-full">
        <header className="bg-background border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Team Management</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-4">
          <TeamTab canDelete={false} isPayrollAdmin={true} />
        </main>
        <BottomNav />
      </div>
    );
  }

  if (!admin) {
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
        {tab === "team" && <TeamTab canDelete={true} />}
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
  /** Which RBANWO-Scheduling resource this login is. Installers only. */
  sched_crew_id: string | null;
  created_at: string;
}

/**
 * A resource from the scheduling app's roster (sched_crews), as far as this
 * page cares. `primary_crew_id` is the install lead a second rides with —
 * shown so an admin can confirm they picked the right person.
 */
interface SchedCrew {
  id: string;
  name: string;
  crew_type: string;
  is_active: boolean;
  primary_crew_id: string | null;
}

interface AccessRequest {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

/**
 * A removal waiting on its typed confirmation. Denying a request throws away
 * someone's ask for access — they have to go and request it all over again —
 * so it gets the same gate as deleting an account outright.
 */
type PendingRemoval =
  | { kind: "delete"; entry: AllowedEmail }
  | { kind: "deny"; request: AccessRequest };

function removalVerb(p: PendingRemoval): RemovalVerb {
  return p.kind === "delete" ? "delete" : "deny";
}

function removalPerson(p: PendingRemoval): { email: string; name: string | null } {
  return p.kind === "delete" ? p.entry : p.request;
}

// Calendar-app RLS keys off the single `role` column. When someone holds
// multiple roles we still store one primary `role` (highest calendar role
// present), and the full set in `roles`. Scheduling-only accounts fall back
// to "member" so they can still view the calendar app.
// `installer` sits last: it is exclusive, so it only ever wins when it is the
// only role held — but it must win then, so the stored `role` describes the
// account rather than reading as a plain member.
const CALENDAR_ROLE_PRIORITY = ["admin", "payroll-admin", "member", "installer"] as const;
function primaryRole(roles: string[]): string {
  for (const r of CALENDAR_ROLE_PRIORITY) if (roles.includes(r)) return r;
  return "member";
}
/** Normalize a row's roles into an array (handles legacy rows with only `role`). */
function rowRoles(entry: { role: string; roles: string[] | null }): string[] {
  if (Array.isArray(entry.roles) && entry.roles.length) return entry.roles;
  return entry.role ? [entry.role] : [];
}

/** What a row sorts and searches by — their name, or the email if unnamed. */
function displayName(entry: { email: string; name: string | null }): string {
  return entry.name?.trim() || entry.email;
}

/** The two things on this page that cannot be undone. */
type RemovalVerb = "delete" | "deny";

/**
 * The sentence an admin has to type out before a removal goes through.
 *
 * It names the person on purpose: a phrase you could type from muscle memory
 * ("DELETE") stops nothing, but one you can only produce by reading the row
 * in front of you makes removing the WRONG person very hard to do by accident.
 */
function confirmPhraseFor(
  verb: RemovalVerb,
  person: { email: string; name: string | null }
): string {
  return `please ${verb} ${displayName(person)}`;
}

/** Forgiving on case and stray spaces, strict on the actual words. */
function phraseMatches(
  typed: string,
  verb: RemovalVerb,
  person: { email: string; name: string | null }
): boolean {
  const norm = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(typed) === norm(confirmPhraseFor(verb, person));
}

/** Checkbox group for assigning multiple roles. */
function RoleCheckboxes({
  selected,
  onChange,
  options = ROLE_OPTIONS,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  options?: readonly { value: string; label: string }[];
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
      {options.map((r) => {
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

/**
 * Which scheduling resource an installer login is.
 *
 * The calendar knows an email; the scheduling app knows a name. Nothing joins
 * them, and matching on the name text is not an option — that is what
 * sched_crews.aliases exists to work around. So an admin picks explicitly, and
 * we store the id (not the name) so renaming a crew cannot orphan the login.
 *
 * Seconds are labelled with the lead they ride with, since that is whose jobs
 * they will see.
 */
function ResourcePicker({
  crews,
  value,
  onChange,
}: {
  crews: SchedCrew[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const nameById = new Map(crews.map((c) => [c.id, c.name]));
  return (
    <div>
      <label className="text-[11px] font-medium text-muted mb-1 block">
        Scheduling resource <span className="text-danger">*</span>
      </label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        <option value="">— pick who this is —</option>
        {crews.map((c) => {
          const lead = c.primary_crew_id ? nameById.get(c.primary_crew_id) : null;
          return (
            <option key={c.id} value={c.id}>
              {c.name}
              {lead ? ` — second to ${lead}` : ""}
            </option>
          );
        })}
      </select>
      <p className="text-[10px] text-muted mt-0.5">
        From the scheduling app&apos;s Resources screen. They will see this
        person&apos;s jobs — or their install lead&apos;s, if they are a second.
        Add them there first if they are not listed.
      </p>
    </div>
  );
}

function TeamTab({ canDelete = true, isPayrollAdmin = false }: { canDelete?: boolean; isPayrollAdmin?: boolean }) {
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
  const [crews, setCrews] = useState<SchedCrew[]>([]);
  const [newCrewId, setNewCrewId] = useState<string | null>(null);
  const [editCrewId, setEditCrewId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string[]>([]);
  // The removal that has been STARTED — an account delete, or a denied access
  // request. Neither happens until the sentence in the dialog is typed out in
  // full, so both share one piece of state and one dialog.
  const [pending, setPending] = useState<PendingRemoval | null>(null);
  const [typed, setTyped] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [removing, setRemoving] = useState(false);

  // Payroll admins can only assign member or payroll-admin roles — not admin,
  // and not installer: it is a restricted role whose setup also needs a
  // scheduling resource, so it stays with admins alongside every other role
  // change (migration 014).
  const availableRoles = isPayrollAdmin
    ? ROLE_OPTIONS.filter((r) => r.value !== "admin" && r.value !== "installer")
    : ROLE_OPTIONS;

  /**
   * Whose jobs an installer login actually sees — their lead's, when they are
   * a second. Spelling it out on the row is the only way an admin can tell a
   * mis-pick from a correct one at a glance.
   */
  function crewLabel(crewId: string): string {
    const crew = crews.find((c) => c.id === crewId);
    if (!crew) return "resource no longer in the scheduling app";
    const lead = crew.primary_crew_id
      ? crews.find((c) => c.id === crew.primary_crew_id)
      : null;
    return lead ? `${lead.name}'s jobs (${crew.name} is their second)` : `${crew.name}'s jobs`;
  }

  /**
   * Shared validation for both the add and edit forms.
   * Returns an error message, or null when the pair is valid.
   */
  function roleSetupError(roles: string[], crewId: string | null): string | null {
    if (installerRoleConflict(roles)) {
      return "Installer restricts access rather than granting it, so it cannot be combined with another role. Untick the others, or untick Installer.";
    }
    if (roles.includes("installer") && !crewId) {
      return "Pick which scheduling resource this installer is — without it they would see nothing at all.";
    }
    return null;
  }

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

    // The scheduling roster, for the installer picker. 019 limits sched_crews
    // to admin + the scheduling roles, so this comes back empty for a payroll
    // admin — who cannot assign the installer role anyway.
    const { data: crewRows } = await supabase
      .from("sched_crews")
      .select("id, name, crew_type, is_active, primary_crew_id")
      .eq("is_active", true)
      .order("name", { ascending: true });
    setCrews(crewRows || []);

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

  async function denyRequest(req: AccessRequest) {
    const supabase = createAuthClient();
    const { error: denyErr } = await supabase
      .from("access_requests")
      .delete()
      .eq("id", req.id);
    if (denyErr) throw new Error(denyErr.message);
    setRequests((prev) => prev.filter((r) => r.id !== req.id));
  }

  async function addEmail() {
    const trimmedEmail = newEmail.trim().toLowerCase();
    const trimmedName = newName.trim();
    if (!trimmedEmail) return;

    setAdding(true);
    setError("");

    const roles = newRoles.length ? newRoles : ["member"];
    const setupError = roleSetupError(roles, newCrewId);
    if (setupError) {
      setError(setupError);
      setAdding(false);
      return;
    }

    const supabase = createAuthClient();
    const { error: insertError } = await supabase
      .from("allowed_emails")
      .insert({
        email: trimmedEmail,
        name: trimmedName || null,
        role: primaryRole(roles),
        roles,
        sched_crew_id: roles.includes("installer") ? newCrewId : null,
      });

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
      setNewCrewId(null);
      await loadData();
    }
    setAdding(false);
  }

  function startEdit(entry: AllowedEmail) {
    // Payroll admins cannot edit admin users
    if (isPayrollAdmin && rowRoles(entry).includes("admin")) return;
    setError("");
    setEditingId(entry.id);
    setEditName(entry.name || "");
    setEditEmail(entry.email);
    setEditRoles(rowRoles(entry));
    setEditAutoCc((entry.auto_cc || []).join(", "));
    setEditCrewId(entry.sched_crew_id);
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

    const setupError = roleSetupError(roles, editCrewId);
    if (setupError) {
      setError(setupError);
      return;
    }

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
    // Dropping the installer role clears the resource too, so a later
    // re-tick cannot silently reuse a stale crew.
    const schedCrewId = roles.includes("installer") ? editCrewId : null;
    const supabase = createAuthClient();
    const { data: updated, error: updateError } = await supabase
      .from("allowed_emails")
      .update({
        email: trimmedEmail,
        name: trimmedName || null,
        role,
        roles,
        auto_cc: parsedAutoCc,
        sched_crew_id: schedCrewId,
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
            ? {
                ...e,
                email: trimmedEmail,
                name: trimmedName || null,
                role,
                roles,
                auto_cc: parsedAutoCc,
                sched_crew_id: schedCrewId,
              }
            : e
        )
      );
      setEditingId(null);
    }
  }

  function startRemoval(next: PendingRemoval) {
    setTyped("");
    setRemoveError("");
    setPending(next);
  }

  function cancelRemoval() {
    setPending(null);
    setTyped("");
    setRemoveError("");
  }

  async function deleteAccount(entry: AllowedEmail) {
    const supabase = createAuthClient();
    const { data: removed, error: deleteErr } = await supabase
      .from("allowed_emails")
      .delete()
      .eq("id", entry.id)
      .select();

    if (deleteErr) throw new Error(deleteErr.message);
    if (!removed || removed.length === 0) {
      // Delete ran but changed nothing — RLS turned it down.
      throw new Error(
        "That delete was blocked by database permissions (no row removed). Your account may not have admin rights in the database."
      );
    }
    setEmails((prev) => prev.filter((e) => e.id !== entry.id));
  }

  async function confirmRemoval() {
    if (!pending) return;
    const person = removalPerson(pending);
    // Belt and braces: the button is disabled until the sentence matches, but
    // a stray Enter key should not be able to get round that either.
    if (!phraseMatches(typed, removalVerb(pending), person)) return;
    if (pending.kind === "delete" && isLastAdminEntry(pending.entry)) return;

    setRemoving(true);
    setRemoveError("");

    try {
      if (pending.kind === "delete") {
        await deleteAccount(pending.entry);
      } else {
        await denyRequest(pending.request);
      }
    } catch (err) {
      setRemoveError(
        err instanceof Error ? err.message : "Something went wrong. Try again."
      );
      setRemoving(false);
      return;
    }

    setRemoving(false);
    cancelRemoval();
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

  // Only the roles somebody actually holds get a filter chip — the full
  // ROLE_OPTIONS list is far too long to sit above the roster.
  const roleCounts = new Map<string, number>();
  for (const entry of emails) {
    for (const r of rowRoles(entry)) {
      roleCounts.set(r, (roleCounts.get(r) || 0) + 1);
    }
  }
  const filterRoles = ROLE_OPTIONS.filter((r) => roleCounts.has(r.value));

  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const visible = emails
    .filter((entry) => {
      const roles = rowRoles(entry);
      // Several roles ticked reads as "any of these", which is what you want
      // when you are asking who can do a thing.
      if (roleFilter.length && !roleFilter.some((r) => roles.includes(r))) {
        return false;
      }
      if (!terms.length) return true;
      const haystack = [
        entry.name || "",
        entry.email,
        ...roles.map((r) => ROLE_LABELS[r] || r),
      ]
        .join(" ")
        .toLowerCase();
      return terms.every((t) => haystack.includes(t));
    })
    // Added-in order is useless for finding anyone; A–Z is not.
    .sort((a, b) =>
      displayName(a).localeCompare(displayName(b), undefined, {
        sensitivity: "base",
      })
    );

  const filtering = terms.length > 0 || roleFilter.length > 0;

  function toggleRoleFilter(value: string) {
    setRoleFilter((prev) =>
      prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]
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
                    onClick={() => startRemoval({ kind: "deny", request: req })}
                    className="p-1.5 rounded hover:bg-danger/10 text-danger transition-colors"
                    title={`Deny ${displayName(req)}`}
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

        {emails.length > 0 && (
          <div className="space-y-2 mb-3">
            <div className="relative">
              <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email or role"
                className="w-full rounded-lg border border-border bg-background pl-9 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted hover:text-foreground transition-colors"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {filterRoles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {filterRoles.map((r) => {
                  const on = roleFilter.includes(r.value);
                  return (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => toggleRoleFilter(r.value)}
                      className={`text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
                        on
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted hover:border-primary/40"
                      }`}
                    >
                      {r.label}
                      <span className="ml-1 opacity-60">
                        {roleCounts.get(r.value)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted">
                {filtering
                  ? `${visible.length} of ${emails.length} ${
                      emails.length === 1 ? "account" : "accounts"
                    }`
                  : `${emails.length} ${
                      emails.length === 1 ? "account" : "accounts"
                    }, A–Z`}
              </p>
              {filtering && (
                <button
                  onClick={() => {
                    setSearch("");
                    setRoleFilter([]);
                  }}
                  className="text-[11px] text-primary hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2">
          {visible.map((entry) =>
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
                  <RoleCheckboxes
                    selected={editRoles}
                    onChange={setEditRoles}
                    options={availableRoles}
                  />
                </div>
                {editRoles.includes("installer") && (
                  <ResourcePicker
                    crews={crews}
                    value={editCrewId}
                    onChange={setEditCrewId}
                  />
                )}
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
                onClick={isPayrollAdmin ? undefined : () => startEdit(entry)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-lg border border-border bg-surface transition-colors ${
                  isPayrollAdmin
                    ? ""
                    : "cursor-pointer hover:border-primary/30"
                }`}
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
                  {rowRoles(entry).includes("installer") && (
                    <span
                      className={`text-[10px] mt-0.5 block truncate ${
                        entry.sched_crew_id ? "text-muted" : "text-danger"
                      }`}
                    >
                      {entry.sched_crew_id
                        ? `Sees: ${crewLabel(entry.sched_crew_id)}`
                        : "No scheduling resource — this account sees nothing"}
                    </span>
                  )}
                </div>
                {canDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startRemoval({ kind: "delete", entry });
                    }}
                    title={`Delete ${displayName(entry)}`}
                    className="p-1.5 rounded hover:bg-danger/10 text-muted hover:text-danger transition-colors shrink-0 ml-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
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

          {emails.length > 0 && visible.length === 0 && (
            <div className="text-center py-6 text-muted">
              <Search className="w-8 h-8 mx-auto mb-2" />
              <p className="text-sm">No accounts match</p>
              <button
                onClick={() => {
                  setSearch("");
                  setRoleFilter([]);
                }}
                className="text-xs text-primary hover:underline mt-1"
              >
                Clear filters
              </button>
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
          {!isPayrollAdmin && (
            <div>
              <label className="text-[11px] font-medium text-muted mb-1 block">
                Roles
              </label>
              <RoleCheckboxes
                selected={newRoles}
                onChange={setNewRoles}
                options={availableRoles}
              />
            </div>
          )}
          {!isPayrollAdmin && newRoles.includes("installer") && (
            <ResourcePicker crews={crews} value={newCrewId} onChange={setNewCrewId} />
          )}
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

      {pending && (
        <ConfirmRemovalDialog
          pending={pending}
          blocked={
            pending.kind === "delete" && isLastAdminEntry(pending.entry)
              ? "This is the last admin account. Promote someone else to admin first, then it can be removed."
              : null
          }
          typed={typed}
          onTyped={(v) => {
            setTyped(v);
            setRemoveError("");
          }}
          error={removeError}
          busy={removing}
          onConfirm={confirmRemoval}
          onCancel={cancelRemoval}
        />
      )}
    </div>
  );
}

/**
 * The two actions on this page nothing undoes — deleting an account, and
 * denying an access request — are deliberately slow: a dialog you cannot click
 * past, and a sentence naming the person that has to be typed out before the
 * button turns on.
 */
function ConfirmRemovalDialog({
  pending,
  blocked,
  typed,
  onTyped,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  pending: PendingRemoval;
  blocked: string | null;
  typed: string;
  onTyped: (next: string) => void;
  error: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const verb = removalVerb(pending);
  const person = removalPerson(pending);
  const roles = pending.kind === "delete" ? rowRoles(pending.entry) : [];
  const phrase = confirmPhraseFor(verb, person);
  const ready = !blocked && phraseMatches(typed, verb, person);

  const heading =
    pending.kind === "delete" ? "Delete this account?" : "Deny this request?";
  const blurb =
    pending.kind === "delete"
      ? "They lose access to the app immediately, and this cannot be undone."
      : "Their request is thrown away and they are not added to the team. If this was a mistake they have to request access all over again.";
  const confirmLabel =
    pending.kind === "delete" ? "Delete account" : "Deny request";
  const busyLabel = pending.kind === "delete" ? "Deleting..." : "Denying...";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-danger/30 bg-background p-4 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{heading}</p>
            <p className="text-xs text-muted mt-1">{blurb}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium truncate">
              {displayName(person)}
            </span>
            {roles.map((r) => (
              <span
                key={r}
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                  ROLE_STYLES[r] || ROLE_STYLES.member
                }`}
              >
                {ROLE_LABELS[r] || r}
              </span>
            ))}
          </div>
          <span className="text-xs text-muted block truncate">
            {person.email}
          </span>
        </div>

        {blocked ? (
          <p className="text-xs text-danger flex items-start gap-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
            {blocked}
          </p>
        ) : (
          <div>
            <p className="text-xs text-muted mb-2">
              To confirm, type{" "}
              <span className="font-semibold text-foreground">{phrase}</span>{" "}
              below.
            </p>
            <input
              type="text"
              value={typed}
              onChange={(e) => onTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && ready && !busy) onConfirm();
                if (e.key === "Escape" && !busy) onCancel();
              }}
              placeholder={phrase}
              disabled={busy}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-danger/50 disabled:opacity-60"
            />
          </div>
        )}

        {error && (
          <p className="text-xs text-danger flex items-start gap-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
            {error}
          </p>
        )}

        <div className="flex gap-2">
          {!blocked && (
            <button
              onClick={onConfirm}
              disabled={!ready || busy}
              className="flex-1 py-2.5 rounded-lg bg-danger text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {busyLabel}
                </>
              ) : (
                <>
                  {pending.kind === "delete" ? (
                    <Trash2 className="w-4 h-4" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                  {confirmLabel}
                </>
              )}
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium disabled:opacity-60"
          >
            {blocked ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
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

      <EmailDefaultsSection />

      <WriteUpPresetsSection />
    </div>
  );
}

/* ── Email Defaults ── */
function EmailDefaultsSection() {
  const [writeUpEmails, setWriteUpEmailsState] = useState("");
  const [fieldNotesEmail, setFieldNotesEmailState] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([getWriteUpEmails(), getFieldNotesEmail()]).then(
      ([writeUps, fieldNotes]) => {
        setWriteUpEmailsState(writeUps.join(", "));
        setFieldNotesEmailState(fieldNotes);
        setLoading(false);
      }
    );
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    const writeUpList = writeUpEmails
      .split(/[,;\n]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.includes("@"));
    const fieldNotes = fieldNotesEmail.trim().toLowerCase();
    await Promise.all([
      setWriteUpEmails(writeUpList.length ? writeUpList : [DEFAULT_WRITEUP_EMAIL]),
      setFieldNotesEmail(fieldNotes.includes("@") ? fieldNotes : DEFAULT_FIELDNOTES_EMAIL),
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-1">
        Email Defaults
      </h2>
      <p className="text-xs text-muted mb-3">
        Default recipients used when field managers submit write-ups and field
        notes. Each user&apos;s own auto-CC list is still added on top.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-muted text-sm py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-muted mb-1 block">
              Write-Up “To” Email(s)
            </label>
            <input
              type="text"
              value={writeUpEmails}
              onChange={(e) => setWriteUpEmailsState(e.target.value)}
              placeholder="writeups@company.com, manager@company.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-[10px] text-muted mt-0.5">
              Comma-separated. All of these are put on the “To” line of a
              submitted write-up.
            </p>
          </div>
          <div>
            <label className="text-[11px] font-medium text-muted mb-1 block">
              Field Notes Email
            </label>
            <input
              type="email"
              value={fieldNotesEmail}
              onChange={(e) => setFieldNotesEmailState(e.target.value)}
              placeholder="fieldnotes@company.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-[10px] text-muted mt-0.5">
              The inbox field notes are sent to, alongside the sender&apos;s own
              email.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="w-full py-2 rounded-lg bg-primary text-white text-sm font-medium flex items-center justify-center gap-1 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : saved ? (
              <>
                <Check className="w-4 h-4" />
                Saved
              </>
            ) : (
              "Save Email Defaults"
            )}
          </button>
        </div>
      )}
    </section>
  );
}

/* ── Write-Up Presets ── */
function WriteUpPresetsSection() {
  const [presets, setPresets] = useState<string[]>([]);
  const [newPreset, setNewPreset] = useState("");

  useEffect(() => {
    getWriteUpPresets().then(setPresets);
  }, []);

  function persist(updated: string[]) {
    setPresets(updated);
    setWriteUpPresets(updated);
  }

  function add() {
    const v = newPreset.trim();
    if (!v || presets.includes(v)) return;
    persist([...presets, v]);
    setNewPreset("");
  }

  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted mb-1">
        Write-Up Presets
      </h2>
      <p className="text-xs text-muted mb-3">
        Quick-tap work items field managers choose from when writing up a unit.
      </p>
      <div className="space-y-2">
        {presets.map((p, i) => (
          <div
            key={i}
            className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-surface"
          >
            <span className="text-sm font-medium">{p}</span>
            <button
              onClick={() => persist(presets.filter((_, j) => j !== i))}
              className="p-1 rounded hover:bg-danger/10 text-muted hover:text-danger transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            type="text"
            value={newPreset}
            onChange={(e) => setNewPreset(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="New preset (e.g. Recaulk exterior)..."
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            onClick={add}
            className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-medium"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
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
