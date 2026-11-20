"use client";

import { useEffect, useState } from "react";
import { Footprints, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useBackClose } from "@/hooks/useBackClose";
import { localToday } from "@/lib/job-complete-core";
import { formatDateShort } from "@/lib/calendar-utils";
import { isAdmin } from "@/lib/roles";
import {
  deleteSiteVisit,
  saveSiteVisit,
  visitBy,
  watchSiteVisits,
  type SiteVisit,
  type SiteVisitJob,
} from "@/lib/site-visits";

/**
 * A job's Job Site Visits (migration 078): every visit already logged on the
 * job, newest first, with who logged it — plus "Log a visit" (date + notes).
 * Your own visits have Edit and Delete (admins can edit any). Measure techs and
 * admins only; the caller gates it.
 */
export function SiteVisitBox({ job, startNew = false }: { job: SiteVisitJob; startNew?: boolean }) {
  const { user, name, roles } = useAuth();
  const me = (user?.email || "").toLowerCase();
  const admin = isAdmin(roles);

  const [visits, setVisits] = useState<SiteVisit[] | null>(null);
  /** null = not editing, "new" = logging a new visit, otherwise the id being edited. */
  const [editing, setEditing] = useState<string | null>(startNew ? "new" : null);
  const [date, setDate] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => watchSiteVisits(job.order_number, setVisits), [job.order_number]);

  function startEdit(id: string, visitDate: string, text: string) {
    setDate(visitDate);
    setNotes(text);
    setError("");
    setConfirmDelete(null);
    setEditing(id);
  }

  async function save() {
    if (!notes.trim()) {
      setError("Type what you did or saw at the job first.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Pick the day of the visit.");
      return;
    }
    setBusy(true);
    setError("");
    const res = await saveSiteVisit({
      job,
      visitDate: date,
      notes,
      name: name || "",
      id: editing && editing !== "new" ? editing : undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error ? `Couldn't save: ${res.error}` : "Couldn't save. Try again.");
      return;
    }
    setEditing(null);
  }

  async function remove(id: string) {
    setBusy(true);
    const ok = await deleteSiteVisit(id, job.order_number);
    setBusy(false);
    setConfirmDelete(null);
    if (!ok) setError("Couldn't delete. Try again.");
  }

  const editor = (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-muted">
        Day of the visit
        <input
          type="date"
          value={date}
          max={localToday()}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground"
        />
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        autoFocus
        placeholder="What you did or found at the job: who you met, what you measured or checked, anything the office should know."
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-base resize-none focus:outline-none focus:ring-2 focus:ring-orange-400/50"
      />
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 text-white disabled:opacity-60"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          Save visit
        </button>
        <button
          onClick={() => setEditing(null)}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-orange-700 dark:text-orange-400">
        <Footprints className="w-3.5 h-3.5" />
        <span className="text-xs font-semibold uppercase tracking-wide flex-1">Job Site Visits</span>
      </div>

      {editing === "new" ? (
        <div>{editor}</div>
      ) : (
        <button
          onClick={() => startEdit("new", localToday(), "")}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-orange-500/50 px-3 py-2 text-sm font-medium text-orange-700 dark:text-orange-400"
        >
          <Plus className="w-4 h-4" /> Log a visit
        </button>
      )}

      {visits === null ? (
        <p className="text-xs text-muted flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </p>
      ) : visits.length === 0 ? (
        editing !== "new" && <p className="text-sm text-muted">No visits logged on this job yet.</p>
      ) : (
        visits.map((v) => {
          const mine = v.created_by.toLowerCase() === me;
          const canChange = mine || admin;
          return (
            <div key={v.id} className="border-t border-orange-500/20 pt-2">
              <p className="text-[11px] font-semibold text-muted">
                {formatDateShort(v.visit_date)} · {mine ? "You" : visitBy(v)}
              </p>
              {editing === v.id ? (
                editor
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap">{v.notes}</p>
                  {canChange && (
                    <div className="flex items-center gap-3 mt-1">
                      <button
                        onClick={() => startEdit(v.id, v.visit_date, v.notes)}
                        className="flex items-center gap-1 text-xs font-medium text-primary"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                      {confirmDelete === v.id ? (
                        <span className="flex items-center gap-2 text-xs">
                          <button onClick={() => remove(v.id)} disabled={busy} className="font-semibold text-danger">
                            Yes, delete
                          </button>
                          <button onClick={() => setConfirmDelete(null)} className="text-muted">
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(v.id)}
                          className="flex items-center gap-1 text-xs font-medium text-danger"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-[11px] text-muted">
        Every visit goes out in the monthly site-visit email on the 1st.
      </p>
    </div>
  );
}

/** The pop-up around SiteVisitBox, used by the job tile and the Submissions tab. */
export function SiteVisitPopup({
  job,
  onClose,
  startNew = false,
}: {
  job: SiteVisitJob;
  onClose: () => void;
  startNew?: boolean;
}) {
  // Android back closes the pop-up, not the app.
  useBackClose(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-md max-h-[85vh] overflow-y-auto bg-background rounded-t-2xl sm:rounded-2xl shadow-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold">Job Site Visit</h2>
            <p className="text-xs text-muted truncate">
              {job.job_name || job.order_number}
              {job.address ? ` · ${job.address}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted hover:text-foreground" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <SiteVisitBox job={job} startNew={startNew} />
      </div>
    </div>
  );
}
