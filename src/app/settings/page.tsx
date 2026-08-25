"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createAuthClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canDoFieldWork, canEditLegacyLink } from "@/lib/roles";
import BottomNav from "@/components/BottomNav";
import LoadingScheduleModal from "@/components/LoadingScheduleModal";
import {
  getStoredColors,
  saveColors,
  resetColors,
  DEFAULT_COLORS,
  type WorkOrderColors,
} from "@/components/ColorLoader";
import {
  Palette,
  RotateCcw,
  Trash2,
  Loader2,
  AlertTriangle,
  LogOut,
  Wrench,
  ChevronRight,
  Truck,
  Link2,
} from "lucide-react";

const COLOR_FIELDS: { key: keyof WorkOrderColors; label: string }[] = [
  { key: "install", label: "Install" },
  { key: "service", label: "Service" },
  { key: "jsv", label: "Job Site Visit" },
];

export default function SettingsPage() {
  const router = useRouter();
  const [colors, setColors] = useState<WorkOrderColors>(() => getStoredColors());
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [showLoadingSchedule, setShowLoadingSchedule] = useState(false);
  const { roles } = useAuth();
  const fieldManager = canDoFieldWork(roles);
  const canManageLegacyLinks = canEditLegacyLink(roles);

  useEffect(() => {
    const supabase = createAuthClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setUserEmail(user.email);
    });
  }, []);

  function handleColorChange(key: keyof WorkOrderColors, value: string) {
    const updated = { ...colors, [key]: value };
    setColors(updated);
    saveColors(updated);
  }

  function handleReset() {
    setColors({ ...DEFAULT_COLORS });
    resetColors();
  }

  async function handleDelete() {
    if (deleteConfirm !== "DELETE") return;

    setDeleting(true);
    setDeleteError("");

    try {
      const res = await fetch("/api/auth/delete-account", { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        setDeleteError(data.error || "Failed to delete account.");
        setDeleting(false);
        return;
      }

      const supabase = createAuthClient();
      await supabase.auth.signOut();
      router.push("/login");
    } catch {
      setDeleteError("Something went wrong. Try again.");
      setDeleting(false);
    }
  }

  async function handleSignOut() {
    const supabase = createAuthClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Settings</h1>
        {userEmail && (
          <p className="text-sm text-muted">{userEmail}</p>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Work Order Colors */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-muted" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Work Order Colors
              </h2>
            </div>
            <button
              onClick={handleReset}
              className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </div>

          <div className="space-y-3">
            {COLOR_FIELDS.map(({ key, label }) => (
              <div
                key={key}
                className="flex items-center justify-between px-3 py-3 rounded-lg border border-border bg-surface"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-lg border border-border shrink-0"
                    style={{ backgroundColor: colors[key] }}
                  />
                  <span className="text-sm font-medium">{label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted font-mono uppercase">
                    {colors[key]}
                  </span>
                  <input
                    type="color"
                    value={colors[key]}
                    onChange={(e) => handleColorChange(key, e.target.value)}
                    className="w-8 h-8 rounded border-0 cursor-pointer bg-transparent"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Loading Schedule — field managers */}
        {fieldManager && (
          <section>
            <button
              onClick={() => setShowLoadingSchedule(true)}
              className="w-full flex items-center justify-between px-3 py-3 rounded-lg border border-border bg-surface text-sm font-medium hover:bg-muted/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Truck className="w-4 h-4 text-amber-600" />
                <span>Generate Loading Schedule</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted" />
            </button>
          </section>
        )}

        {/* Legacy Links — scheduling roles + admin */}
        {canManageLegacyLinks && (
          <section>
            <Link
              href="/legacy-links"
              className="w-full flex items-center justify-between px-3 py-3 rounded-lg border border-border bg-surface text-sm font-medium hover:bg-muted/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Link2 className="w-4 h-4 text-amber-600" />
                <span>Legacy Links Needed</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted" />
            </Link>
          </section>
        )}

        {/* Dev Page — admin & payroll-admin */}
        {(roles.includes("admin") || roles.includes("payroll-admin")) && (
          <section>
            <Link
              href="/admin"
              className="w-full flex items-center justify-between px-3 py-3 rounded-lg border border-border bg-surface text-sm font-medium hover:bg-muted/10 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Wrench className="w-4 h-4 text-muted" />
                <span>Dev Panel</span>
              </div>
              <ChevronRight className="w-4 h-4 text-muted" />
            </Link>
          </section>
        )}

        {/* Sign Out */}
        <section>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-border text-foreground text-sm font-medium hover:bg-surface transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </section>

        {/* Delete Account */}
        <section className="pt-4 border-t border-border">
          {!showDelete ? (
            <button
              onClick={() => setShowDelete(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-danger/30 text-danger text-sm font-medium hover:bg-danger/5 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete Account
            </button>
          ) : (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">
                    This will permanently delete your account
                  </p>
                  <p className="text-xs text-muted mt-1">
                    Your login, settings, and access will be removed. This
                    cannot be undone.
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted mb-2">
                  Type <span className="font-bold text-foreground">DELETE</span>{" "}
                  to confirm
                </p>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => {
                    setDeleteConfirm(e.target.value);
                    setDeleteError("");
                  }}
                  placeholder="DELETE"
                  disabled={deleting}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-danger/50 disabled:opacity-60"
                />
              </div>

              {deleteError && (
                <p className="text-xs text-danger">{deleteError}</p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleteConfirm !== "DELETE" || deleting}
                  className="flex-1 py-2.5 rounded-lg bg-danger text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    "Delete My Account"
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowDelete(false);
                    setDeleteConfirm("");
                    setDeleteError("");
                  }}
                  disabled={deleting}
                  className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {showLoadingSchedule && (
        <LoadingScheduleModal onClose={() => setShowLoadingSchedule(false)} />
      )}

      <BottomNav />
    </div>
  );
}
