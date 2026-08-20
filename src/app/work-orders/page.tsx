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
  writeUpsToPlainText,
  deleteWriteUpPhotos,
  loadCachedWriteUps,
  writeUpsCacheFresh,
  invalidateWriteUpsCache,
} from "@/lib/work-order-store";
import { groupWriteUpSections, padSeq, type WriteUpSection, type NumberedWorkItem } from "@/lib/writeup-sections";
import WriteUpModal, { WriteUpTarget } from "@/components/WriteUpModal";
import WriteUpPicker from "@/components/WriteUpPicker";
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
} from "lucide-react";
import { format, parseISO } from "date-fns";

type Filter = "draft" | "in_review" | "open" | "closed" | "all";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "draft", label: "Drafts" },
  { id: "in_review", label: "In Review" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

export default function WorkOrdersPage() {
  const { role, user, loading: authLoading } = useAuth();
  const [writeUps, setWriteUps] = useState<FieldWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("in_review");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Soft rollout: only admin + field-manager can see write-ups for now.
  const canView = canSeeWriteUps(role);
  const canReview = canReviewWriteUps(role);
  const canCreate = canDoFieldWork(role);
  const canEdit = canDoFieldWork(role);

  const [showPicker, setShowPicker] = useState(false);
  const [pending, setPending] = useState<{ target: WriteUpTarget; units: MaterialUnit[] } | null>(null);
  // Editing a whole submission (all its unit rows) through the guided flow.
  const [editing, setEditing] = useState<FieldWorkOrder[] | null>(null);

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
      setWriteUps((prev) => prev.map((w) => (ids.includes(w.id) ? { ...w, status } : w)));
    }
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

  const visible = useMemo(
    () => (filter === "all" ? writeUps : writeUps.filter((w) => w.status === filter)),
    [writeUps, filter]
  );

  // Group by order number (one job may have several unit write-ups). Jobs with
  // any draft float to the top so unfinished write-ups are easy to find.
  const groups = useMemo(() => {
    const map = new Map<string, FieldWorkOrder[]>();
    for (const w of visible) {
      if (!map.has(w.orderNumber)) map.set(w.orderNumber, []);
      map.get(w.orderNumber)!.push(w);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      const ad = a[1].some((w) => w.status === "draft") ? 0 : 1;
      const bd = b[1].some((w) => w.status === "draft") ? 0 : 1;
      return ad - bd;
    });
    return entries;
  }, [visible]);

  // Tab counts = number of write-up SUBMISSIONS per status (not per-unit rows),
  // so the count matches the write-ups actually shown in the list.
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const sec of groupWriteUpSections(writeUps)) {
      counts[sec.status] = (counts[sec.status] || 0) + 1;
    }
    return counts;
  }, [writeUps]);

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
          <p className="text-sm text-muted">Field write-ups aren&apos;t available for your account.</p>
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
            <h1 className="text-lg font-semibold">Field Write-Ups</h1>
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
        <div className="flex gap-1 mt-2 overflow-x-auto">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
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
      </header>

      <main className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        ) : groups.length === 0 ? (
          <div className="text-center py-12 text-muted">
            <Wrench className="w-10 h-10 mx-auto mb-2" />
            <p className="text-sm">No {filter === "all" ? "" : filter.replace("_", " ")} write-ups</p>
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
                    {sections.map((sec) => (
                      <div key={sec.key} className="border-t-2 border-border">
                        <ReviewSection
                          section={sec}
                          total={sections.length}
                          canReview={canReview}
                          canEdit={canEdit}
                          onEdit={() => setEditing(sec.rows)}
                          onReviewItems={(itemsToReview, reviewed) => setItemsReviewed(sec, itemsToReview, reviewed)}
                          onStatus={(status) => setSectionStatus(sec, status)}
                        />
                        {sec.rows.map((w) => (
                          <WriteUpRow
                            key={w.id}
                            w={w}
                            canEdit={canEdit}
                            onDeletePhotos={() => deletePhotos(w)}
                          />
                        ))}
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

      {editing && editing.length > 0 && (
        <WriteUpModal
          order={{
            orderNumber: editing[0].orderNumber,
            workOrderNumber: editing[0].workOrderNumber,
            customerName: editing[0].customerName,
            address: editing[0].address,
            materialJob: null,
          }}
          units={[]}
          editBatch={editing}
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
};
const STATUS_LABEL: Record<WriteUpStatus, string> = {
  draft: "Draft",
  in_review: "In Review",
  open: "Open",
  closed: "Closed",
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
  canEdit,
  onEdit,
  onReviewItems,
  onStatus,
}: {
  section: WriteUpSection;
  total: number;
  canReview: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onReviewItems: (items: NumberedWorkItem[], reviewed: boolean) => void;
  onStatus: (status: WriteUpStatus) => void;
}) {
  const allWork = [...section.outstanding, ...section.completed].sort((a, b) => a.seq - b.seq);
  const reviewable = section.status === "in_review";
  const allReviewed = allWork.length > 0 && allWork.every((i) => i.reviewed);

  return (
    <div className="px-4 py-3 bg-background/40">
      <div className="flex items-center justify-between gap-2 mb-2">
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

      {allWork.length > 0 && (
        <ul className="space-y-1.5">
          {allWork.map((it) => {
            const canToggle = canReview && reviewable;
            return (
              <li key={it.seq} className="flex items-start gap-2 text-sm">
                <button
                  disabled={!canToggle}
                  onClick={() => onReviewItems([it], !it.reviewed)}
                  className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                    it.reviewed ? "bg-blue-500 border-blue-500 text-white" : "border-border text-transparent"
                  } ${canToggle ? "cursor-pointer" : "cursor-default"}`}
                  title={it.reviewed ? "Reviewed — tap to undo" : "Mark reviewed"}
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
                    {it.completed && <span className="text-[10px] text-green-600 font-medium">Installed ✓</span>}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap gap-2 mt-3 no-print">
        {section.status === "draft" && canEdit && (
          <button
            onClick={() => onStatus("in_review")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-600 border border-blue-500/30"
          >
            <Send className="w-3.5 h-3.5" />
            Submit for review
          </button>
        )}
        {section.status === "in_review" && canReview && (
          <button
            onClick={() => onReviewItems(allWork.filter((i) => !i.reviewed), true)}
            disabled={allReviewed || allWork.length === 0}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 text-blue-600 border border-blue-500/30 disabled:opacity-40"
          >
            <Eye className="w-3.5 h-3.5" />
            Mark all reviewed
          </button>
        )}
        {section.status === "open" && canReview && (
          <button
            onClick={() => onStatus("closed")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-green-600/10 text-green-700 border border-green-600/30"
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
      </div>
    </div>
  );
}

function WriteUpRow({
  w,
  canEdit,
  onDeletePhotos,
}: {
  w: FieldWorkOrder;
  canEdit: boolean;
  onDeletePhotos: () => Promise<boolean>;
}) {
  // Only surface "edited" when it actually differs from creation.
  const wasEdited = !!w.updatedBy && Math.abs(+parseISO(w.updatedAt) - +parseISO(w.createdAt)) > 60000;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingPhotos, setDeletingPhotos] = useState(false);
  const canDeletePhotos = canEdit && w.status === "closed" && w.photos.length > 0;
  return (
    <div className="px-4 py-3 border-t border-border">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{w.unitLabel || "Whole job"}</span>
          <StatusPill status={w.status} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted text-right">
            {w.createdByName || w.createdBy} · {format(parseISO(w.createdAt), "MMM d, h:mm a")}
            {wasEdited && (
              <span className="block text-[10px]">
                edited {format(parseISO(w.updatedAt), "MMM d, h:mm a")} by {w.updatedByName || w.updatedBy}
              </span>
            )}
          </span>
        </div>
      </div>

      {w.newProduct && (
        <div className="mb-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-0.5">
            Added product
          </p>
          <p className="text-sm font-semibold">
            {w.newProduct.type}
            {w.newProduct.size ? ` · ${w.newProduct.size}` : ""}
          </p>
          <p className="text-xs text-muted">
            {[w.newProduct.exteriorColor, w.newProduct.interiorColor, w.newProduct.intFinish, w.newProduct.frame]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}

      {w.lineItems.length > 0 && (
        <ul className="mb-2 space-y-1">
          {w.lineItems.map((li, i) => (
            <li key={i} className="text-sm flex items-start gap-2">
              {li.completed ? (
                <Check className="w-3.5 h-3.5 mt-0.5 text-green-600 shrink-0" />
              ) : (
                <span
                  className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                    li.kind === "preset" ? "bg-amber-500" : "bg-primary"
                  }`}
                />
              )}
              <span className={li.completed ? "line-through text-muted" : ""}>
                {li.label}
                {li.notes ? <span className="text-muted"> — {li.notes}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      {w.specChanges.length > 0 && (
        <div className="mb-2 rounded-lg bg-background border border-border px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted mb-1">Spec corrections</p>
          {w.specChanges.map((c, i) => (
            <p key={i} className="text-xs">
              <span className="text-muted">{c.field}:</span>{" "}
              <span className="line-through text-muted">{c.oldValue || "—"}</span>{" → "}
              <span className="font-semibold text-amber-600">{c.newValue}</span>
            </p>
          ))}
        </div>
      )}

      {w.materialItems.length > 0 && (
        <div className="mb-2 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-[#1a1a1a]">
                {["QTY", "Item", "Color", "Species", "Lengths", "Vendor"].map((h) => (
                  <th
                    key={h}
                    className="px-2 py-1 text-[9px] font-bold tracking-wider uppercase text-white"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {w.materialItems.map((m, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-surface"}>
                  <td className="px-2 py-1 text-xs border-b border-border font-bold whitespace-nowrap">
                    {m.qty} {m.unit}
                  </td>
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

      {w.notes && <p className="text-sm text-muted whitespace-pre-wrap mb-2">{w.notes}</p>}

      {/* Delete photos — closed write-ups only, while photos still exist */}
      {canDeletePhotos && (
        <div className="mt-2 no-print">
          {confirmingDelete ? (
            <div className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2">
              <p className="text-xs font-medium text-danger flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Delete {w.photos.length} photo{w.photos.length !== 1 ? "s" : ""}? This can&apos;t be undone.
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deletingPhotos}
                  className="flex-1 py-2 rounded-lg text-xs font-medium border border-border disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setDeletingPhotos(true);
                    const ok = await onDeletePhotos();
                    setDeletingPhotos(false);
                    if (ok) setConfirmingDelete(false);
                  }}
                  disabled={deletingPhotos}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-danger text-white flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {deletingPhotos ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                  {deletingPhotos ? "Deleting…" : "Delete photos"}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-danger border border-danger/30 hover:bg-danger/5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete photos ({w.photos.length})
            </button>
          )}
        </div>
      )}
    </div>
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
