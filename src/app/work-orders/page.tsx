"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BottomNav from "@/components/BottomNav";
import { useAuth } from "@/hooks/useAuth";
import { canDoFieldWork, canReviewWriteUps, canSeeWriteUps } from "@/lib/roles";
import { FieldWorkOrder, WriteUpStatus, MaterialUnit } from "@/lib/types";
import {
  fetchWriteUps,
  updateWriteUpStatus,
  updateWriteUpLineItems,
  updateWriteUpSuggestedCrews,
  snoozeWriteUpNudge,
  writeUpsToPlainText,
  deleteWriteUpPhotos,
  loadCachedWriteUps,
  writeUpsCacheFresh,
  invalidateWriteUpsCache,
  buildWriteUpEmailContent,
  WRITEUP_EMAIL_TO,
  type WriteUpEntryInput,
} from "@/lib/work-order-store";
import { fetchMaterialJobs } from "@/lib/store";
import { getWriteUpEmails } from "@/lib/action-settings";
import { dedupeRecipients } from "@/lib/email-recipients";
import { groupWriteUpSections, padSeq, splitMaterialLines, type WriteUpSection, type NumberedWorkItem } from "@/lib/writeup-sections";
import { responsibilityLabel, defectCodeLabel } from "@/lib/writeup-responsibility";
import WriteUpModal, { WriteUpTarget } from "@/components/WriteUpModal";
import WriteUpPicker from "@/components/WriteUpPicker";
import { crewsToText, textToCrews } from "@/lib/writeup-crews";
import {
  nudgeFor,
  needsCrew,
  snoozeUntil,
  ARCHIVE_AFTER_MONTHS,
  CLOSE_AFTER_MONTHS,
  SNOOZE_MONTHS,
  type Nudge,
} from "@/lib/writeup-nudges";
import {
  Loader2,
  Wrench,
  Printer,
  ChevronDown,
  ChevronRight,
  Check,
  Eye,
  RotateCcw,
  FileText,
  Plus,
  Pencil,
  Copy,
  Trash2,
  AlertTriangle,
  Send,
  Camera,
  Archive,
  Search,
  X,
  Flag,
  Users,
} from "lucide-react";
import { format, parseISO } from "date-fns";

type Filter = "draft" | "in_review" | "open" | "closed" | "archived" | "all";
/** The pills at the top: write-ups asking to be archived, asking to be closed,
 *  or submitted with nobody picked to do the work. */
type Attention = "archive" | "close" | "nocrew";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "draft", label: "Drafts" },
  { id: "in_review", label: "In Review" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "archived", label: "Archived" },
  { id: "all", label: "All" },
];

/** Every bit of a write-up worth typing into the search box: the job it belongs
 *  to, who wrote it, the unit, and the text of the work itself. */
function writeUpSearchText(w: FieldWorkOrder): string {
  return [
    w.orderNumber,
    w.workOrderNumber,
    w.jobId ?? "",
    w.customerName,
    w.address,
    w.unitLabel ?? "",
    w.createdByName,
    w.updatedByName,
    w.notes,
    w.responsibility,
    w.defectCode,
    ...w.suggestedCrews,
    ...w.lineItems.flatMap((li) => [li.label, li.notes ?? ""]),
    ...w.specChanges.flatMap((sc) => [sc.field, sc.oldValue, sc.newValue]),
    ...w.materialItems.flatMap((m) => [m.item, m.color, m.species, m.vendor]),
    w.newProduct ? [w.newProduct.type, w.newProduct.size, w.newProduct.details].join(" ") : "",
  ]
    .join(" ")
    .toLowerCase();
}

export default function WorkOrdersPage() {
  const { roles, user, autoCc, loading: authLoading } = useAuth();
  const [writeUps, setWriteUps] = useState<FieldWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("in_review");
  // Free-text search, applied on top of whichever status tab is active.
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // One of the pills at the top is tapped: narrow the list to just those
  // write-ups. Cleared by tapping the pill again or switching tabs.
  const [attention, setAttention] = useState<Attention | null>(null);

  // View: admin + field-manager (full) and scheduling + scheduling-manager
  // (view-only). Edit/create/review capabilities below stay field-work-gated.
  const canView = canSeeWriteUps(roles);
  const canReview = canReviewWriteUps(roles);
  const canCreate = canDoFieldWork(roles);
  const canEdit = canDoFieldWork(roles);
  // Desktop resend-notification button: field managers + admin only.
  const canResendEmail = canDoFieldWork(roles);

  const [showPicker, setShowPicker] = useState(false);
  const [pending, setPending] = useState<{ target: WriteUpTarget; units: MaterialUnit[] } | null>(null);
  // Editing a whole submission (all its unit rows) through the guided flow.
  // The job's programmed units load in the background so the editor can show
  // the unit chips, read a unit's current spec, and know each unit's product
  // type — the write-up rows alone carry none of that.
  const [editing, setEditing] = useState<{ rows: FieldWorkOrder[]; units: MaterialUnit[] } | null>(null);
  function startEdit(rows: FieldWorkOrder[]) {
    setEditing({ rows, units: [] });
    const orderNumber = rows[0]?.orderNumber;
    if (!orderNumber) return;
    fetchMaterialJobs()
      .then((jobs) => {
        const mat = jobs.get(orderNumber);
        const units: MaterialUnit[] = Array.isArray(mat?.units) ? mat.units : [];
        if (!units.length) return;
        setEditing((prev) => (prev && prev.rows === rows ? { rows, units } : prev));
      })
      .catch(() => {
        /* no job on file — the editor works from the write-up rows alone */
      });
  }

  // Desktop-only resend: field managers reviewing on a computer can re-fire the
  // submission email if it didn't go through the first time. Mobile is hidden to
  // keep the tile clean (matches the pointer:fine check used by useStaleTab).
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsDesktop(window.matchMedia("(pointer: fine)").matches);
  }, []);
  /** Rebuild the notification email (recipients + subject + body) for one order
   *  from its saved write-up rows, for the local mail-app resend. */
  async function buildOrderEmail(orderNumber: string, items: FieldWorkOrder[]) {
    const first = items[0];
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const docLink = `${origin}/work-orders/${encodeURIComponent(orderNumber)}`;
    const ctx = {
      orderNumber,
      workOrderNumber: first.workOrderNumber,
      jobId: first.jobId,
      customerName: first.customerName,
      address: first.address,
      createdBy: first.createdBy,
      createdByName: first.createdByName,
      status: first.status,
    };
    // Only photo counts are used in the body, so mapping path/name is enough.
    const entries: WriteUpEntryInput[] = items.map((w) => ({
      unitLabel: w.unitLabel,
      lineItems: w.lineItems,
      specChanges: w.specChanges,
      materialItems: w.materialItems,
      newProduct: w.newProduct,
      notes: w.notes,
      photos: w.photos.map((p) => ({ path: p.path, name: p.name })),
    }));
    const { subject, body } = buildWriteUpEmailContent(ctx, entries, docLink);
    const toEmails = await getWriteUpEmails();
    const { to, cc } = dedupeRecipients(
      toEmails.length ? toEmails : [WRITEUP_EMAIL_TO],
      autoCc
    );
    return { to, cc, subject, body };
  }

  /** Resend the write-up notification by opening the user's own mail app with
   *  the message pre-filled. Intentionally mailto: (not the Gmail route) — this
   *  button is admin/field-manager-only and low-volume, so it doesn't need to
   *  spend the shared Gmail daily quota. */
  async function resendViaLocalMail(orderNumber: string, items: FieldWorkOrder[]) {
    if (items.length === 0) return;
    const { to, cc, subject, body } = await buildOrderEmail(orderNumber, items);
    const ccPart = cc.length ? `&cc=${encodeURIComponent(cc.join(","))}` : "";
    const mailto = `mailto:${to.join(",")}?subject=${encodeURIComponent(subject)}${ccPart}&body=${encodeURIComponent(
      body
    )}`;
    if (typeof window !== "undefined") window.location.href = mailto;
  }

  useEffect(() => {
    if (!canView) return;
    // Paint instantly from cache, then refetch only if it's gone stale. This
    // makes the tab feel instant and avoids re-pulling the whole list (egress)
    // on every visit when nothing has changed.
    const cached = loadCachedWriteUps();
    if (cached) {
      setWriteUps(cached);
      setLoading(false);
    }
    if (!writeUpsCacheFresh()) load(!cached);
  }, [canView]);

  async function load(showSpinner = true) {
    if (showSpinner) setLoading(true);
    const data = await fetchWriteUps();
    setWriteUps(data);
    setLoading(false);
  }

  const reviewer = {
    by: user?.email || "",
    byName: user?.email?.split("@")[0] || "",
  };

  /** Move every row of a write-up submission to a new status together. */
  async function setSectionStatus(section: WriteUpSection, status: WriteUpStatus) {
    const ids = section.rows.map((r) => r.id);
    const results = await Promise.all(ids.map((id) => updateWriteUpStatus(id, status)));
    if (results.every(Boolean)) {
      // Mirror what updateWriteUpStatus stamps server-side so the nudges
      // recompute without a refetch.
      const now = new Date().toISOString();
      setWriteUps((prev) =>
        prev.map((w) =>
          ids.includes(w.id)
            ? {
                ...w,
                status,
                nudgeSnoozedUntil: null,
                closedAt: status === "closed" ? now : status === "archived" ? w.closedAt : null,
              }
            : w
        )
      );
    }
  }

  /** "Not yet" to an archive/close nudge: hush it for a few months. */
  async function snoozeSection(section: WriteUpSection): Promise<void> {
    const until = snoozeUntil();
    const ids = section.rows.map((r) => r.id);
    const results = await Promise.all(ids.map((id) => snoozeWriteUpNudge(id, until)));
    if (results.every(Boolean)) {
      setWriteUps((prev) => prev.map((w) => (ids.includes(w.id) ? { ...w, nudgeSnoozedUntil: until } : w)));
    }
  }

  /** Save the crews that could do a submission's work. They live on the
   *  whole-job row; a submission with only unit rows keeps them on its first
   *  row, and whichever row held them before is cleared so there is one list. */
  async function setSectionCrews(section: WriteUpSection, text: string): Promise<boolean> {
    const target =
      section.rows.find((r) => r.unitLabel === null) ||
      section.rows.find((r) => r.suggestedCrews.length) ||
      section.rows[0];
    if (!target) return false;
    const crews = textToCrews(text);
    const stale = section.rows.filter((r) => r.id !== target.id && r.suggestedCrews.length);
    const results = await Promise.all([
      updateWriteUpSuggestedCrews(target.id, crews, false),
      ...stale.map((r) => updateWriteUpSuggestedCrews(r.id, [], false)),
    ]);
    if (!results.every(Boolean)) return false;
    const cleared = new Set(stale.map((r) => r.id));
    setWriteUps((prev) =>
      prev.map((w) =>
        w.id === target.id
          ? { ...w, suggestedCrews: crews, suggestedCrewsAll: false }
          : cleared.has(w.id)
            ? { ...w, suggestedCrews: [], suggestedCrewsAll: false }
            : w
      )
    );
    return true;
  }

  /** Mark the given numbered work items reviewed/unreviewed across the rows they
   *  span, stamping who + when. When the whole submission is reviewed, it
   *  automatically advances In Review → Open. */
  async function setItemsReviewed(section: WriteUpSection, items: WriteUpSection["outstanding"], reviewed: boolean) {
    const now = new Date().toISOString();
    // Build updated line-item arrays for every row this touches.
    const byRow = new Map<string, FieldWorkOrder>();
    for (const r of section.rows) byRow.set(r.id, r);
    const nextItemsByRow = new Map<string, FieldWorkOrder["lineItems"]>();
    for (const r of section.rows) nextItemsByRow.set(r.id, r.lineItems.map((li) => ({ ...li })));
    const touched = new Set<string>();
    for (const it of items) {
      for (const src of it.sources) {
        const arr = nextItemsByRow.get(src.rowId);
        if (!arr || !arr[src.index]) continue;
        const li = arr[src.index];
        if (reviewed) {
          li.reviewed = true;
          li.reviewedBy = reviewer.by;
          li.reviewedByName = reviewer.byName;
          li.reviewedAt = now;
        } else {
          li.reviewed = false;
          li.reviewedBy = undefined;
          li.reviewedByName = undefined;
          li.reviewedAt = undefined;
        }
        touched.add(src.rowId);
      }
    }
    const results = await Promise.all(
      [...touched].map((rowId) => updateWriteUpLineItems(rowId, nextItemsByRow.get(rowId)!))
    );
    if (!results.every(Boolean)) {
      alert("Couldn't save the review — try again.");
      return;
    }
    // Reflect locally.
    setWriteUps((prev) =>
      prev.map((w) => (touched.has(w.id) ? { ...w, lineItems: nextItemsByRow.get(w.id)! } : w))
    );
    // Auto-advance In Review → Open once every item is reviewed.
    const allReviewed = section.rows.every((r) =>
      (nextItemsByRow.get(r.id) || r.lineItems).every((li) => li.reviewed)
    );
    if (allReviewed && section.status === "in_review") {
      await setSectionStatus(section, "open");
    }
  }

  /** Mark the given numbered work items completed/not-completed across the rows
   *  they span. Purely a field-progress toggle: no reviewer stamp and no status
   *  change — a reviewer still approves the write-up separately. */
  async function setItemsCompleted(section: WriteUpSection, items: WriteUpSection["outstanding"], completed: boolean) {
    const nextItemsByRow = new Map<string, FieldWorkOrder["lineItems"]>();
    for (const r of section.rows) nextItemsByRow.set(r.id, r.lineItems.map((li) => ({ ...li })));
    const touched = new Set<string>();
    for (const it of items) {
      for (const src of it.sources) {
        const arr = nextItemsByRow.get(src.rowId);
        if (!arr || !arr[src.index]) continue;
        arr[src.index].completed = completed;
        touched.add(src.rowId);
      }
    }
    const results = await Promise.all(
      [...touched].map((rowId) => updateWriteUpLineItems(rowId, nextItemsByRow.get(rowId)!))
    );
    if (!results.every(Boolean)) {
      alert("Couldn't save — try again.");
      return;
    }
    setWriteUps((prev) =>
      prev.map((w) => (touched.has(w.id) ? { ...w, lineItems: nextItemsByRow.get(w.id)! } : w))
    );
  }

  async function deletePhotos(w: FieldWorkOrder): Promise<boolean> {
    const res = await deleteWriteUpPhotos(
      w.id,
      w.photos.map((p) => p.path)
    );
    if (res.ok) {
      setWriteUps((prev) =>
        prev.map((x) => (x.id === w.id ? { ...x, photos: [], photoCount: 0, photosUploaded: false } : x))
      );
      invalidateWriteUpsCache();
      return true;
    }
    alert(res.error ? `Couldn't delete photos: ${res.error}` : "Couldn't delete photos — try again.");
    return false;
  }

  // Which rows belong to a write-up that needs attention, worked out once over
  // everything loaded: the pills at the top count these, tapping a pill
  // narrows the list to them, and flagged jobs sort to the top of their tab.
  const flagged = useMemo(() => {
    const archive = new Set<string>();
    const close = new Set<string>();
    const nocrew = new Set<string>();
    const counts = { archive: 0, close: 0, nocrew: 0 };
    for (const sec of groupWriteUpSections(writeUps)) {
      const n = nudgeFor(sec);
      if (n === "archive") {
        counts.archive++;
        for (const r of sec.rows) archive.add(r.id);
      } else if (n === "close") {
        counts.close++;
        for (const r of sec.rows) close.add(r.id);
      }
      if (needsCrew(sec)) {
        counts.nocrew++;
        for (const r of sec.rows) nocrew.add(r.id);
      }
    }
    return { archive, close, nocrew, counts };
  }, [writeUps]);

  const visible = useMemo(() => {
    // "All" shows everything except archived; archived lives behind its own
    // filter so superseded/test write-ups stay out of the way.
    const byStatus =
      filter === "all"
        ? writeUps.filter((w) => w.status !== "archived")
        : writeUps.filter((w) => w.status === filter);
    // A tapped pill narrows further to just the write-ups it counted.
    const byAttention = attention ? byStatus.filter((w) => flagged[attention].has(w.id)) : byStatus;
    // Search runs inside the active tab, so it works on every filter. All terms
    // must match somewhere in the write-up (order doesn't matter).
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return byAttention;
    return byAttention.filter((w) => {
      const hay = writeUpSearchText(w);
      return terms.every((t) => hay.includes(t));
    });
  }, [writeUps, filter, query, attention, flagged]);

  // Group by order number (one job may have several unit write-ups). Jobs with
  // any draft float to the top so unfinished write-ups are easy to find, then
  // jobs with a write-up that is asking a question (archive? still open?).
  const groups = useMemo(() => {
    const map = new Map<string, FieldWorkOrder[]>();
    for (const w of visible) {
      if (!map.has(w.orderNumber)) map.set(w.orderNumber, []);
      map.get(w.orderNumber)!.push(w);
    }
    const rank = (rows: FieldWorkOrder[]) =>
      rows.some((w) => w.status === "draft")
        ? 0
        : rows.some((w) => flagged.archive.has(w.id) || flagged.close.has(w.id))
          ? 1
          : 2;
    const entries = Array.from(map.entries());
    entries.sort((a, b) => rank(a[1]) - rank(b[1]));
    return entries;
  }, [visible, flagged]);

  /** Tap a pill: jump to the tab it lives in and narrow to its write-ups. */
  function toggleAttention(kind: Attention) {
    if (attention === kind) {
      setAttention(null);
      return;
    }
    setAttention(kind);
    setFilter(kind === "archive" ? "closed" : kind === "close" ? "open" : "all");
  }

  // Tab counts = number of write-up SUBMISSIONS per status (not per-unit rows),
  // so the count matches the write-ups actually shown in the list. While a
  // search is active the counts narrow to matches, so you can see which tab
  // holds the job you're looking for without checking each one.
  const statusCounts = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const pool = terms.length
      ? writeUps.filter((w) => {
          const hay = writeUpSearchText(w);
          return terms.every((t) => hay.includes(t));
        })
      : writeUps;
    const counts: Record<string, number> = {};
    for (const sec of groupWriteUpSections(pool)) {
      counts[sec.status] = (counts[sec.status] || 0) + 1;
    }
    return counts;
  }, [writeUps, query]);

  if (authLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
        <BottomNav />
      </div>
    );
  }

  // Direct-URL guard: block members even if they somehow reach the route.
  if (!canView) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <Wrench className="w-8 h-8 text-muted" />
          <p className="text-sm text-muted">Write-ups aren&apos;t available for your account.</p>
          <Link href="/" className="text-sm text-primary underline">
            Back to calendar
          </Link>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .print-open { display: block !important; }
        }
      `}</style>

      <header className="bg-background border-b border-border px-4 py-3 no-print">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-600" />
            <h1 className="text-lg font-semibold">Write-Ups</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="hidden md:flex items-center gap-1.5 text-sm text-primary hover:text-foreground"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
            {canCreate && (
              <button
                onClick={() => setShowPicker(true)}
                className="flex items-center gap-1 text-sm px-2.5 py-1.5 rounded-md bg-amber-500 text-white font-medium active:scale-[0.97] transition-all"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">New write-up</span>
              </button>
            )}
          </div>
        </div>
        {(flagged.counts.archive > 0 || flagged.counts.close > 0 || flagged.counts.nocrew > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {flagged.counts.archive > 0 && (
              <AttentionPill
                active={attention === "archive"}
                onClick={() => toggleAttention("archive")}
                tone="red"
                icon={<Flag className="w-3.5 h-3.5" />}
                label={`${flagged.counts.archive} closed ${ARCHIVE_AFTER_MONTHS}+ months — archive?`}
              />
            )}
            {flagged.counts.close > 0 && (
              <AttentionPill
                active={attention === "close"}
                onClick={() => toggleAttention("close")}
                tone="amber"
                icon={<Flag className="w-3.5 h-3.5" />}
                label={`${flagged.counts.close} open ${CLOSE_AFTER_MONTHS}+ months — still open?`}
              />
            )}
            {flagged.counts.nocrew > 0 && (
              <AttentionPill
                active={attention === "nocrew"}
                onClick={() => toggleAttention("nocrew")}
                tone="gray"
                icon={<Users className="w-3.5 h-3.5" />}
                label={`${flagged.counts.nocrew} with no crew picked`}
              />
            )}
          </div>
        )}
        <div className="flex gap-1 mt-2 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setFilter(f.id);
                setAttention(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                filter === f.id ? "bg-primary text-white" : "bg-surface text-muted"
              }`}
            >
              {f.label}
              {f.id !== "all" && (
                <span className="ml-1.5 text-xs opacity-70">{statusCounts[f.id] || 0}</span>
              )}
            </button>
          ))}
        </div>
        <div className="relative mt-2">
          <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, order #, address, unit, work item…"
            className="w-full rounded-lg border border-border bg-surface pl-9 pr-9 py-2 text-sm outline-none focus:border-primary"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 text-muted">
            <Wrench className="w-10 h-10 mx-auto mb-2" />
            <p className="text-sm">
              No {filter === "all" ? "" : filter.replace("_", " ")} write-ups
              {query.trim() ? ` matching “${query.trim()}”` : ""}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map(([orderNumber, items]) => {
              const first = items[0];
              const isOpen = expanded.has(orderNumber);
              const sections = groupWriteUpSections(items);
              const allItems = items.flatMap((w) => w.lineItems);
              const doneItems = allItems.filter((li) => li.completed).length;
              return (
                <div key={orderNumber} className="rounded-xl border border-border bg-surface overflow-hidden">
                  <div className="flex items-stretch no-print">
                    <button
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(orderNumber)) next.delete(orderNumber);
                          else next.add(orderNumber);
                          return next;
                        })
                      }
                      className="flex-1 flex items-center justify-between px-4 py-3 text-left min-w-0"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{first.customerName || "—"}</p>
                        <p className="text-xs text-muted truncate">
                          #{orderNumber} · {sections.length} write-up{sections.length !== 1 ? "s" : ""}
                          {allItems.length > 0 && (
                            <span className={doneItems === allItems.length ? "text-green-600 font-medium" : ""}>
                              {" · "}
                              {doneItems}/{allItems.length} installed
                            </span>
                          )}
                          {first.address ? ` · ${first.address}` : ""}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {sections.map((s) => (
                            <StatusPill key={s.key} status={s.status} />
                          ))}
                          {sections.map((s) => {
                            const n = nudgeFor(s);
                            if (n === "archive")
                              return <FlagBadge key={`n-${s.key}`} tone="red" label="Archive?" />;
                            if (n === "close")
                              return <FlagBadge key={`n-${s.key}`} tone="amber" label="Still open?" />;
                            if (needsCrew(s)) return <FlagBadge key={`n-${s.key}`} tone="gray" label="No crew" />;
                            return null;
                          })}
                        </div>
                      </div>
                      {isOpen ? (
                        <ChevronDown className="w-5 h-5 text-muted shrink-0" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-muted shrink-0" />
                      )}
                    </button>
                    <CopyWriteUpButton text={writeUpsToPlainText(items)} />
                    <Link
                      href={`/work-orders/${encodeURIComponent(orderNumber)}`}
                      className="flex items-center gap-1.5 px-3 border-l border-border text-amber-600 shrink-0"
                      title="Open work order doc"
                    >
                      <FileText className="w-4 h-4" />
                      <span className="text-xs font-semibold hidden sm:inline">Doc</span>
                    </Link>
                  </div>

                  <div className={isOpen ? "block" : "hidden print-open"}>
                    {isDesktop && canResendEmail && (
                      <div className="border-t-2 border-border px-4 py-2.5 flex flex-wrap items-center gap-2 no-print">
                        <button
                          onClick={() => resendViaLocalMail(orderNumber, items)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-border"
                        >
                          <Send className="w-3.5 h-3.5" /> Resend notification
                        </button>
                        <span className="text-[11px] text-muted">Opens your mail app</span>
                      </div>
                    )}
                    {sections.map((sec) => (
                      <div key={sec.key} className="border-t-2 border-border">
                        <ReviewSection
                          section={sec}
                          total={sections.length}
                          canReview={canReview}
                          canComplete={canEdit}
                          canEdit={canEdit}
                          onEdit={() => startEdit(sec.rows)}
                          onReviewItems={(itemsToReview, reviewed) => setItemsReviewed(sec, itemsToReview, reviewed)}
                          onToggleCompleted={(itemsToToggle, completed) => setItemsCompleted(sec, itemsToToggle, completed)}
                          onStatus={(status) => setSectionStatus(sec, status)}
                          onSaveCrews={(crews) => setSectionCrews(sec, crews)}
                          nudge={nudgeFor(sec)}
                          onSnooze={() => snoozeSection(sec)}
                          onDeletePhotos={async () => {
                            for (const w of sec.rows) if (w.photos.length) await deletePhotos(w);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {showPicker && (
        <WriteUpPicker
          onPick={(target, units) => {
            setShowPicker(false);
            setPending({ target, units });
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {pending && (
        <WriteUpModal
          order={pending.target}
          units={pending.units}
          onClose={() => setPending(null)}
          onSaved={() => {
            setPending(null);
            load();
          }}
        />
      )}

      {editing && editing.rows.length > 0 && (
        <WriteUpModal
          order={{
            orderNumber: editing.rows[0].orderNumber,
            workOrderNumber: editing.rows[0].workOrderNumber,
            customerName: editing.rows[0].customerName,
            address: editing.rows[0].address,
            materialJob: null,
          }}
          units={editing.units}
          editBatch={editing.rows}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <BottomNav />
    </div>
  );
}

const STATUS_STYLE: Record<WriteUpStatus, string> = {
  draft: "bg-surface border border-border text-muted",
  in_review: "bg-blue-500/15 text-blue-600",
  open: "bg-amber-500/15 text-amber-600",
  closed: "bg-green-600/15 text-green-700",
  archived: "bg-surface border border-border text-muted",
};
const STATUS_LABEL: Record<WriteUpStatus, string> = {
  draft: "Draft",
  in_review: "In Review",
  open: "Open",
  closed: "Closed",
  archived: "Archived",
};

function StatusPill({ status }: { status: WriteUpStatus }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Batch-level review panel: the numbered work-to-complete checklist with per-item
 * "reviewed" toggles + attribution, plus the lifecycle buttons that move the whole
 * submission Draft → In Review → Open → Closed.
 */
function ReviewSection({
  section,
  total,
  canReview,
  canComplete,
  canEdit,
  onEdit,
  onReviewItems,
  onToggleCompleted,
  onStatus,
  onSaveCrews,
  nudge,
  onSnooze,
  onDeletePhotos,
}: {
  section: WriteUpSection;
  total: number;
  canReview: boolean;
  canComplete: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onReviewItems: (items: NumberedWorkItem[], reviewed: boolean) => void;
  onToggleCompleted: (items: NumberedWorkItem[], completed: boolean) => void;
  onStatus: (status: WriteUpStatus) => void | Promise<void>;
  onSaveCrews: (text: string) => Promise<boolean>;
  /** The question this write-up is asking right now, if any. */
  nudge: Nudge | null;
  /** "Not yet" — hush the question for a while. */
  onSnooze: () => Promise<void>;
  onDeletePhotos: () => Promise<void>;
}) {
  const [snoozing, setSnoozing] = useState(false);
  const [closingFromNudge, setClosingFromNudge] = useState(false);
  const allWork = [...section.outstanding, ...section.completed].sort((a, b) => a.seq - b.seq);
  // Crews that could do this work — tile only, never the PDF. Editable in
  // place so the office can tag crews after the fact without reopening the
  // whole write-up.
  const crewRow = section.rows.find((r) => r.suggestedCrews.length);
  const crewText = crewsToText(crewRow?.suggestedCrews, crewRow?.suggestedCrewsAll);
  const [editingCrews, setEditingCrews] = useState(false);
  const [crewDraft, setCrewDraft] = useState("");
  const [savingCrews, setSavingCrews] = useState(false);
  const [crewError, setCrewError] = useState(false);
  function startCrewEdit() {
    setCrewDraft(crewText);
    setCrewError(false);
    setEditingCrews(true);
  }
  async function saveCrews() {
    setSavingCrews(true);
    setCrewError(false);
    const ok = await onSaveCrews(crewDraft);
    setSavingCrews(false);
    if (ok) setEditingCrews(false);
    else setCrewError(true);
  }
  const allReviewed = allWork.length > 0 && allWork.every((i) => i.reviewed);
  // Trim and parts are two different orders to two different suppliers, so they
  // get a table each instead of one blended list the office has to sort by eye.
  const { trim: sectionTrim, parts: sectionParts } = splitMaterialLines(section.materials);
  const trimPcs = sectionTrim.reduce((sum, m) => sum + (m.qty || 0), 0);
  const partsPcs = sectionParts.reduce((sum, m) => sum + (m.qty || 0), 0);
  // The job can only be closed once every work item is checked off installed.
  const allCompleted = allWork.length > 0 && allWork.every((i) => i.completed);
  const [confirmPhotos, setConfirmPhotos] = useState(false);
  const [deletingPhotos, setDeletingPhotos] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Whole-job note → what's wrong / financing / paint (matches the create screen).
  let background = "", financing = "", paint = "";
  const unitNotes: { unitLabel: string | null; text: string }[] = [];
  for (const n of section.notes) {
    if (n.unitLabel) {
      unitNotes.push(n);
      continue;
    }
    const rest: string[] = [];
    for (const seg of n.text.split("\n\n")) {
      if (seg.startsWith("Financing notes: ")) financing = seg.slice("Financing notes: ".length);
      else if (seg.startsWith("Paint & stain notes: ")) paint = seg.slice("Paint & stain notes: ".length);
      else rest.push(seg);
    }
    const bg = rest.join("\n\n").trim();
    if (bg) background = background ? `${background}\n\n${bg}` : bg;
  }
  // Responsibility matrix (whole-job row) — Write-Ups tile only, not the PDF.
  const respRow = section.rows.find((r) => r.responsibility);
  const responsibility = respRow?.responsibility || "";
  const defectCode = responsibility === "retail" ? respRow?.defectCode || "" : "";
  const unitRows = section.rows.filter((r) => r.unitLabel);
  const canDeletePhotos =
    canEdit && (section.status === "closed" || section.status === "archived") && section.photos.length > 0;

  return (
    <div className="px-4 py-3 bg-background/40 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">
            Write-up {section.index}
            {total > 1 ? ` of ${total}` : ""}
          </span>
          <StatusPill status={section.status} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-muted text-right truncate">
            Wrote: {section.createdByName || "—"} · {format(parseISO(section.createdAt), "MMM d")}
            {section.updatedByName ? ` · edited by ${section.updatedByName}` : ""}
          </span>
          {canEdit && (
            <button
              onClick={onEdit}
              className="p-1.5 rounded-lg text-muted hover:text-amber-600 no-print shrink-0"
              title="Edit write-up"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Lifecycle nudge: the question this write-up is asking, with a plain
          yes / not-yet answer. Only people who can change status see it. */}
      {nudge === "archive" && canReview && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2.5 no-print">
          <p className="text-sm font-semibold text-danger flex items-center gap-1.5">
            <Flag className="w-4 h-4 shrink-0" />
            Closed for {ARCHIVE_AFTER_MONTHS}+ months. Should this be archived?
          </p>
          <p className="text-xs text-muted mt-1">
            {section.photos.length > 0
              ? `Archiving deletes its ${section.photos.length} photo${section.photos.length !== 1 ? "s" : ""} for good and hides it from the doc.`
              : "Archiving hides it from the doc."}{" "}
            &ldquo;Not yet&rdquo; asks again in {SNOOZE_MONTHS} months.
          </p>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => setConfirmArchive(true)}
              disabled={snoozing}
              className="flex-1 py-2 rounded-lg text-xs font-semibold bg-danger text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Archive className="w-3.5 h-3.5" />
              Yes, archive it
            </button>
            <button
              type="button"
              onClick={async () => {
                setSnoozing(true);
                await onSnooze();
                setSnoozing(false);
              }}
              disabled={snoozing}
              className="flex-1 py-2 rounded-lg text-xs font-medium border border-border flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {snoozing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Not yet, keep it
            </button>
          </div>
        </div>
      )}
      {nudge === "close" && canReview && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 no-print">
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <Flag className="w-4 h-4 shrink-0" />
            Open for {CLOSE_AFTER_MONTHS}+ months. Does this still need to be open?
          </p>
          <p className="text-xs text-muted mt-1">
            {allCompleted
              ? "Every work item is checked off, so it can be closed."
              : "Check off every work item first if you want to close it."}{" "}
            &ldquo;Still open&rdquo; asks again in {SNOOZE_MONTHS} months.
          </p>
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={async () => {
                setClosingFromNudge(true);
                await onStatus("closed");
                setClosingFromNudge(false);
              }}
              disabled={!allCompleted || closingFromNudge || snoozing}
              title={allCompleted ? "Close this write-up" : "Check off every work item first"}
              className="flex-1 py-2 rounded-lg text-xs font-semibold bg-green-600 text-white flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {closingFromNudge ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Yes, close it
            </button>
            <button
              type="button"
              onClick={async () => {
                setSnoozing(true);
                await onSnooze();
                setSnoozing(false);
              }}
              disabled={snoozing || closingFromNudge}
              className="flex-1 py-2 rounded-lg text-xs font-medium border border-border flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {snoozing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Still open
            </button>
          </div>
        </div>
      )}

      {/* Responsibility matrix */}
      {responsibility && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Responsibility</span>
          <span className="inline-flex items-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2.5 py-0.5 text-xs font-semibold">
            {responsibilityLabel(responsibility)}
          </span>
          {defectCode && (
            <span className="inline-flex items-center rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted">
              {defectCodeLabel(defectCode)}
            </span>
          )}
        </div>
      )}

      {/* Crews who could do the work — never printed */}
      {(crewText.length > 0 || canEdit) && (
        <div className="no-print">
          {editingCrews ? (
            <div className="space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted">Who could do this work?</span>
              <textarea
                value={crewDraft}
                onChange={(e) => setCrewDraft(e.target.value)}
                rows={2}
                autoFocus
                placeholder="e.g. Tim or Jose — any day after the 20th"
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-base resize-none focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveCrews}
                  disabled={savingCrews}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500 text-white disabled:opacity-60"
                >
                  {savingCrews ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCrews(false)}
                  disabled={savingCrews}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border text-muted"
                >
                  Cancel
                </button>
                {crewError && <span className="text-xs text-red-600">Couldn&apos;t save — try again.</span>}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-start gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted pt-0.5">Who could do this</span>
              {crewText ? (
                <span className="text-sm whitespace-pre-wrap text-amber-700 dark:text-amber-400 font-medium">{crewText}</span>
              ) : (
                <span className="text-xs text-muted">Nothing written yet</span>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={startCrewEdit}
                  className="p-1 rounded-lg text-muted hover:text-amber-600"
                  title={crewText ? "Change" : "Add"}
                  aria-label={crewText ? "Change who could do this" : "Add who could do this"}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* 1. What's wrong + financing/paint + any unit notes */}
      {(background || financing || paint || unitNotes.length > 0) && (
        <div className="space-y-2">
          {background && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">What&apos;s wrong</div>
              <p className="text-sm whitespace-pre-wrap">{background}</p>
            </div>
          )}
          {financing && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Financing notes</div>
              <p className="text-sm">{financing}</p>
            </div>
          )}
          {paint && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Paint &amp; stain notes</div>
              <p className="text-sm">{paint}</p>
            </div>
          )}
          {unitNotes.map((n, i) => (
            <div key={i}>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">{n.unitLabel} note</div>
              <p className="text-sm whitespace-pre-wrap">{n.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* 2. Units affected (with added products + spec changes) */}
      {unitRows.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Units affected</div>
          <div className="space-y-1.5">
            {unitRows.map((r) => {
              const specs = section.specChanges.filter((c) => c.unitLabel === r.unitLabel);
              return (
                <div key={r.id} className="text-sm">
                  <span className="font-semibold">{r.unitLabel}</span>
                  {r.newProduct && (
                    <span className="text-muted">
                      {" "}
                      · Added: {r.newProduct.type}
                      {r.newProduct.size ? ` ${r.newProduct.size}` : ""}
                    </span>
                  )}
                  {specs.map((c, i) => (
                    <div key={i} className="text-xs ml-4">
                      <span className="text-muted">{c.field}:</span>{" "}
                      <span className="line-through text-muted">{c.oldValue || "—"}</span>
                      {" → "}
                      <span className="font-semibold text-amber-600">{c.newValue}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Work to complete */}
      {allWork.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Work to complete</div>
          <ul className="space-y-1.5">
            {allWork.map((it) => {
              const canToggle = canComplete;
              return (
                <li key={it.seq} className="flex items-start gap-2 text-sm">
                  <button
                    disabled={!canToggle}
                    onClick={() => onToggleCompleted([it], !it.completed)}
                    className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      it.completed ? "bg-green-600 border-green-600 text-white" : "border-border text-transparent"
                    } ${canToggle ? "cursor-pointer" : "cursor-default"}`}
                    title={it.completed ? "Completed — tap to undo" : "Mark completed"}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <span className="font-mono text-xs font-bold text-muted mt-0.5 shrink-0">{padSeq(it.seq)}</span>
                  <span className="flex-1 min-w-0">
                    <span>{it.label}</span>
                    {it.units.length > 0 && <span className="text-muted"> — {it.units.join(", ")}</span>}
                    <span className="flex flex-wrap gap-x-2">
                      {it.reviewed && it.reviewedByName && (
                        <span className="text-[10px] text-blue-600">
                          Reviewed by {it.reviewedByName}
                          {it.reviewedAt ? ` · ${format(parseISO(it.reviewedAt), "MMM d")}` : ""}
                        </span>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* 4a. Trim / material — ordered from a lumber vendor by the piece. */}
      {sectionTrim.length > 0 && (
        <div className="overflow-x-auto">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Trim / material</div>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-[#1a1a1a]">
                {[`QTY: ${trimPcs}`, "Unit", "Item", "Color", "Species", "Lengths", "Vendor"].map((h) => (
                  <th key={h} className="px-2 py-1 text-[9px] font-bold tracking-wider uppercase text-white">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sectionTrim.map((m, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-surface"}>
                  <td className="px-2 py-1 text-xs border-b border-border font-bold whitespace-nowrap">
                    {m.qty} {m.unit}
                  </td>
                  <td className="px-2 py-1 text-xs border-b border-border text-muted">{m.unitLabel || "—"}</td>
                  <td className="px-2 py-1 text-xs border-b border-border font-semibold">{m.item}</td>
                  <td className="px-2 py-1 text-xs border-b border-border text-muted">{m.color || "—"}</td>
                  <td className="px-2 py-1 text-xs border-b border-border text-muted">{m.species || "—"}</td>
                  <td className="px-2 py-1 text-xs border-b border-border text-muted font-mono">{m.lengths || "—"}</td>
                  <td className="px-2 py-1 text-xs border-b border-border font-bold text-[#6DB344]">{m.vendor || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 4b. Parts — ordered from Andersen by part number. A separate table
             because it's a different order to a different supplier, and its
             useful columns (part number) aren't the trim ones. */}
      {sectionParts.length > 0 && (
        <div className="overflow-x-auto">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Parts</div>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-[#1a1a1a]">
                {[`QTY: ${partsPcs}`, "Unit", "Part", "Color", "Size", "Part #"].map((h) => (
                  <th key={h} className="px-2 py-1 text-[9px] font-bold tracking-wider uppercase text-white">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sectionParts.map((m, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-surface"}>
                  <td className="px-2 py-1 text-xs border-b border-border font-bold whitespace-nowrap">
                    {m.qty} {m.unit}
                  </td>
                  <td className="px-2 py-1 text-xs border-b border-border text-muted">{m.unitLabel || "—"}</td>
                  <td className="px-2 py-1 text-xs border-b border-border font-semibold">{m.item}</td>
                  <td className="px-2 py-1 text-xs border-b border-border text-muted">{m.color || "—"}</td>
                  <td className="px-2 py-1 text-xs border-b border-border text-muted">{m.size || "—"}</td>
                  <td className="px-2 py-1 text-xs border-b border-border font-mono font-bold">{m.partNumber || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 5. Photos (count — open the Doc to view) */}
      {section.photos.length > 0 && (
        <div className="text-xs text-muted flex items-center gap-1.5">
          <Camera className="w-3.5 h-3.5" />
          {section.photos.length} photo{section.photos.length !== 1 ? "s" : ""} — open the Doc to view
        </div>
      )}

      {/* Delete photos — closed or archived write-ups, admins/field managers */}
      {canDeletePhotos && (
        <div className="no-print">
          {confirmPhotos ? (
            <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2">
              <p className="text-xs font-medium text-danger flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Delete all {section.photos.length} photo{section.photos.length !== 1 ? "s" : ""}? This can&apos;t be undone.
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setConfirmPhotos(false)}
                  disabled={deletingPhotos}
                  className="flex-1 py-2 rounded-lg text-xs font-medium border border-border disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setDeletingPhotos(true);
                    await onDeletePhotos();
                    setDeletingPhotos(false);
                    setConfirmPhotos(false);
                  }}
                  disabled={deletingPhotos}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-danger text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {deletingPhotos ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Delete photos
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmPhotos(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-danger border border-danger/30"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete photos
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 no-print">
        {section.status === "draft" && canEdit && (
          <button
            onClick={() => onStatus("in_review")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-600 border border-blue-500/30"
          >
            <Send className="w-3.5 h-3.5" />
            Submit for review
          </button>
        )}
        {/* In Review always offers a way forward. Normally that's reviewing the
            items (which auto-advances to Open); when there's nothing left to
            review — no numbered work items, or every item already stamped from
            an earlier pass — it's a straight approve instead, so an edited
            write-up can't get stranded in In Review. */}
        {section.status === "in_review" && canReview && (
          allWork.length === 0 || allReviewed ? (
            <button
              onClick={() => onStatus("open")}
              title="Approve this write-up and open it for the field"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-600 border border-blue-500/30"
            >
              <Eye className="w-3.5 h-3.5" />
              Approve &amp; open
            </button>
          ) : (
            <button
              onClick={() => onReviewItems(allWork.filter((i) => !i.reviewed), true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-600 border border-blue-500/30"
            >
              <Eye className="w-3.5 h-3.5" />
              Mark all reviewed
            </button>
          )
        )}
        {section.status === "open" && canComplete && (
          <button
            onClick={() => onStatus("closed")}
            disabled={!allCompleted}
            title={allCompleted ? "Close this job" : "Check off every work item first"}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-green-600/10 text-green-700 border border-green-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="w-3.5 h-3.5" />
            Mark closed
          </button>
        )}
        {section.status === "closed" && canReview && (
          <button
            onClick={() => onStatus("open")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface text-muted border border-border"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reopen
          </button>
        )}
        {section.status === "closed" && canReview && (
          confirmArchive ? (
            <div className="w-full rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 no-print">
              <p className="text-xs font-medium text-danger flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Archiving hides this write-up from the joined PDF
                {section.photos.length > 0
                  ? ` and permanently deletes all ${section.photos.length} photo${section.photos.length !== 1 ? "s" : ""}.`
                  : "."}{" "}
                This can&apos;t be undone.
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setConfirmArchive(false)}
                  disabled={archiving}
                  className="flex-1 py-2 rounded-lg text-xs font-medium border border-border disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setArchiving(true);
                    if (section.photos.length > 0) await onDeletePhotos();
                    await onStatus("archived");
                    setArchiving(false);
                    setConfirmArchive(false);
                  }}
                  disabled={archiving}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-danger text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {archiving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                  Archive
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmArchive(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface text-muted border border-border"
              title="Hide this write-up from the joined PDF / doc and delete its photos"
            >
              <Archive className="w-3.5 h-3.5" />
              Archive
            </button>
          )
        )}
        {section.status === "archived" && canReview && (
          <button
            onClick={() => onStatus("closed")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface text-muted border border-border"
            title="Restore this write-up (back to Closed)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Unarchive
          </button>
        )}
      </div>
    </div>
  );
}

const PILL_TONE = {
  red: {
    idle: "border-danger/40 text-danger bg-danger/5",
    active: "bg-danger text-white border-danger",
  },
  amber: {
    idle: "border-amber-500/50 text-amber-700 dark:text-amber-400 bg-amber-500/10",
    active: "bg-amber-500 text-white border-amber-500",
  },
  gray: {
    idle: "border-border text-muted bg-surface",
    active: "bg-primary text-white border-primary",
  },
} as const;

/** A tappable count at the top of the page. Tapping narrows the list to it. */
function AttentionPill({
  active,
  onClick,
  tone,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  tone: keyof typeof PILL_TONE;
  icon: React.ReactNode;
  label: string;
}) {
  const t = PILL_TONE[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? t.active : t.idle
      }`}
    >
      {icon}
      {label}
      {active && <X className="w-3.5 h-3.5 ml-0.5" />}
    </button>
  );
}

/** A small flag on a collapsed job row, so the question shows before opening it. */
function FlagBadge({ tone, label }: { tone: keyof typeof PILL_TONE; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${PILL_TONE[tone].idle}`}>
      {tone === "gray" ? <Users className="w-3 h-3" /> : <Flag className="w-3 h-3" />}
      {label}
    </span>
  );
}

/** Copies the plain-text write-up to the clipboard, for the internal system. */
function CopyWriteUpButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older/insecure contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        /* give up silently */
      }
      document.body.removeChild(ta);
    }
  }
  return (
    <button
      onClick={copy}
      className={`flex items-center gap-1.5 px-3 border-l border-border shrink-0 ${copied ? "text-green-600" : "text-muted hover:text-foreground"}`}
      title="Copy write-up text for the internal system"
    >
      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      <span className="text-xs font-semibold hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
