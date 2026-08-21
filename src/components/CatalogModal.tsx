"use client";

// Settings → Manage Catalogs. Two editable catalogs that feed the write-up flow:
//  • Parts — name, category, product type, optional color/size options, and a
//    per-variant (color+size) part-number matrix.
//  • Work to complete — the "what needs done" list, with an optional
//    time-to-complete per unit.
// Custom entries typed on a write-up land here as "unverified" for review.

import { useEffect, useState } from "react";
import {
  PartsCatalogItem,
  WorkCatalogItem,
  PartVariant,
  fetchAllParts,
  upsertPart,
  deletePart,
  fetchAllWork,
  upsertWork,
  deleteWork,
} from "@/lib/work-order-store";
import { X, Plus, Trash2, Loader2, Check, Package, Wrench, Pencil } from "lucide-react";

export default function CatalogModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"parts" | "work">("parts");
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl h-[94vh] sm:h-auto sm:max-h-[90vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">Manage Catalogs</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-1 px-4 pt-3 shrink-0">
          {(["parts", "work"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${
                tab === t ? "bg-primary text-white" : "bg-surface text-muted"
              }`}
            >
              {t === "parts" ? <Package className="w-4 h-4" /> : <Wrench className="w-4 h-4" />}
              {t === "parts" ? "Parts" : "Work to complete"}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">{tab === "parts" ? <PartsEditor /> : <WorkEditor />}</div>
      </div>
    </div>
  );
}

const label = "text-[11px] font-bold uppercase tracking-wide text-muted mb-1";
const field = "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/50";

function UnverifiedBadge() {
  return <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600">Review</span>;
}

/* ───────────────────────── Parts ───────────────────────── */

function PartsEditor() {
  const [parts, setParts] = useState<PartsCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PartsCatalogItem | "new" | null>(null);
  const [query, setQuery] = useState("");

  async function reload() {
    setParts(await fetchAllParts());
  }
  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  if (editing) {
    return (
      <PartForm
        part={editing === "new" ? null : editing}
        productTypes={[...new Set(parts.map((p) => p.productType).filter(Boolean))]}
        categories={[...new Set(parts.map((p) => p.category).filter(Boolean))]}
        onDone={async () => {
          setEditing(null);
          await reload();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  const q = query.trim().toLowerCase();
  const shown = q
    ? parts.filter((p) => `${p.partName} ${p.category} ${p.productType} ${p.position || ""}`.toLowerCase().includes(q))
    : parts;
  const byType = new Map<string, PartsCatalogItem[]>();
  for (const p of shown) {
    const arr = byType.get(p.productType) || [];
    arr.push(p);
    byType.set(p.productType, arr);
  }

  return (
    <div>
      <div className="flex gap-2 mb-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search parts…" className={field} />
        <button
          onClick={() => setEditing("new")}
          className="shrink-0 flex items-center gap-1 px-3 rounded-lg bg-amber-500 text-white text-sm font-semibold"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-8 text-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted text-center py-6">No parts.</p>
      ) : (
        [...byType.entries()].map(([type, items]) => (
          <div key={type} className="mb-4">
            <div className="text-[11px] font-bold uppercase tracking-wide text-muted mb-1">{type}</div>
            <div className="space-y-1">
              {items.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setEditing(p)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-border bg-surface flex items-center gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate flex items-center gap-2">
                      {p.partName}
                      {!p.verified && <UnverifiedBadge />}
                    </div>
                    <div className="text-[11px] text-muted truncate">
                      {[p.category, p.position, p.colors.length ? `${p.colors.length} colors` : "", p.sizes.length ? `${p.sizes.length} sizes` : "", p.variants.length ? `${p.variants.length} part #s` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <Pencil className="w-4 h-4 text-muted shrink-0" />
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ChipList({ items, onChange, placeholder }: { items: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  function add() {
    const v = draft.trim();
    if (v && !items.some((i) => i.toLowerCase() === v.toLowerCase())) onChange([...items, v]);
    setDraft("");
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {items.map((it) => (
          <span key={it} className="inline-flex items-center gap-1 text-xs bg-surface border border-border rounded-full px-2 py-1">
            {it}
            <button onClick={() => onChange(items.filter((x) => x !== it))} className="text-muted hover:text-danger">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className={field}
        />
        <button onClick={add} className="shrink-0 px-3 rounded-lg border border-border text-sm">Add</button>
      </div>
    </div>
  );
}

function PartForm({
  part,
  productTypes,
  categories,
  onDone,
  onCancel,
}: {
  part: PartsCatalogItem | null;
  productTypes: string[];
  categories: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [productType, setProductType] = useState(part?.productType || "");
  const [category, setCategory] = useState(part?.category || "");
  const [partName, setPartName] = useState(part?.partName || "");
  const [position, setPosition] = useState(part?.position || "");
  const [colors, setColors] = useState<string[]>(part?.colors || []);
  const [sizes, setSizes] = useState<string[]>(part?.sizes || []);
  const [variants, setVariants] = useState<PartVariant[]>(part?.variants || []);
  const [verified, setVerified] = useState(part?.verified ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const colorOpts = colors.length ? colors : [""];
  const sizeOpts = sizes.length ? sizes : [""];
  const partNumberFor = (c: string, s: string) => variants.find((v) => v.color === c && v.size === s)?.partNumber || "";
  function setPartNumber(c: string, s: string, num: string) {
    setVariants((prev) => {
      const rest = prev.filter((v) => !(v.color === c && v.size === s));
      return num.trim() ? [...rest, { color: c, size: s, partNumber: num }] : rest;
    });
  }

  async function save() {
    if (!partName.trim()) { setError("A part name is required."); return; }
    setSaving(true);
    setError("");
    const res = await upsertPart({
      id: part?.id,
      productType: productType || "Custom",
      category: category || "Custom",
      partName,
      position: position || null,
      colors,
      sizes,
      variants: variants.filter((v) => v.partNumber.trim()),
      verified,
    });
    setSaving(false);
    if (!res.ok) { setError(res.error || "Couldn't save."); return; }
    onDone();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onCancel} className="text-sm text-primary">← Back</button>
        {part && (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-danger">Delete?</span>
              <button onClick={async () => { await deletePart(part.id); onDone(); }} className="text-xs font-semibold text-danger">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1 text-xs text-danger">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={label}>Product type</div>
          <input list="pt-list" value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="Double Hung…" className={field} />
          <datalist id="pt-list">{productTypes.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        <div>
          <div className={label}>Category</div>
          <input list="cat-list" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Sash, Lock…" className={field} />
          <datalist id="cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      </div>
      <div>
        <div className={label}>Part name</div>
        <input value={partName} onChange={(e) => setPartName(e.target.value)} placeholder="Sash lock" className={field} />
      </div>
      <div>
        <div className={label}>Position (optional)</div>
        <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="S1 (top)…" className={field} />
      </div>

      <div>
        <div className={label}>Color options (optional)</div>
        <ChipList items={colors} onChange={setColors} placeholder="Add a color…" />
      </div>
      <div>
        <div className={label}>Size options (optional)</div>
        <ChipList items={sizes} onChange={setSizes} placeholder="Add a size…" />
      </div>

      <div>
        <div className={label}>Part number{colorOpts.length * sizeOpts.length > 1 ? "s — per color / size" : ""}</div>
        <div className="space-y-1.5">
          {colorOpts.map((c) =>
            sizeOpts.map((s) => (
              <div key={`${c}|${s}`} className="flex items-center gap-2">
                {(c || s) && (
                  <span className="text-xs text-muted shrink-0 w-28 truncate">
                    {[c, s].filter(Boolean).join(" · ") || "Any"}
                  </span>
                )}
                <input
                  value={partNumberFor(c, s)}
                  onChange={(e) => setPartNumber(c, s, e.target.value)}
                  placeholder="Part #"
                  className={field}
                />
              </div>
            ))
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="w-4 h-4 accent-amber-500" />
        Verified (show in write-up suggestions)
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button onClick={save} disabled={saving} className="w-full py-3 rounded-xl bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
        Save part
      </button>
    </div>
  );
}

/* ───────────────────────── Work to complete ───────────────────────── */

function WorkEditor() {
  const [items, setItems] = useState<WorkCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<WorkCatalogItem | "new" | null>(null);

  async function reload() {
    setItems(await fetchAllWork());
  }
  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  if (editing) {
    return (
      <WorkForm
        item={editing === "new" ? null : editing}
        onDone={async () => {
          setEditing(null);
          await reload();
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div>
      <button
        onClick={() => setEditing("new")}
        className="w-full flex items-center justify-center gap-1 mb-3 px-3 py-2.5 rounded-lg bg-amber-500 text-white text-sm font-semibold"
      >
        <Plus className="w-4 h-4" /> Add work item
      </button>
      {loading ? (
        <div className="flex justify-center py-8 text-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted text-center py-6">No work items.</p>
      ) : (
        <div className="space-y-1">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => setEditing(it)}
              className="w-full text-left px-3 py-2.5 rounded-lg border border-border bg-surface flex items-center gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-2">
                  {it.label}
                  {!it.verified && <UnverifiedBadge />}
                </div>
                {(it.minutesPerUnit != null || it.productType) && (
                  <div className="text-[11px] text-muted truncate">
                    {[it.minutesPerUnit != null ? `${it.minutesPerUnit} min/unit` : "", it.productType || ""].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <Pencil className="w-4 h-4 text-muted shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkForm({ item, onDone, onCancel }: { item: WorkCatalogItem | null; onDone: () => void; onCancel: () => void }) {
  const [labelText, setLabelText] = useState(item?.label || "");
  const [minutes, setMinutes] = useState(item?.minutesPerUnit != null ? String(item.minutesPerUnit) : "");
  const [productType, setProductType] = useState(item?.productType || "");
  const [verified, setVerified] = useState(item?.verified ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    if (!labelText.trim()) { setError("A label is required."); return; }
    setSaving(true);
    setError("");
    const res = await upsertWork({
      id: item?.id,
      label: labelText,
      productType: productType || null,
      minutesPerUnit: minutes.trim() ? parseInt(minutes, 10) || null : null,
      verified,
    });
    setSaving(false);
    if (!res.ok) { setError(res.error || "Couldn't save."); return; }
    onDone();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onCancel} className="text-sm text-primary">← Back</button>
        {item && (
          confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-danger">Delete?</span>
              <button onClick={async () => { await deleteWork(item.id); onDone(); }} className="text-xs font-semibold text-danger">Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted">No</button>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1 text-xs text-danger">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          )
        )}
      </div>

      <div>
        <div className={label}>Work item</div>
        <input value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="Redo caulking" className={field} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={label}>Time per unit (min, optional)</div>
          <input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ""))} placeholder="15" className={field} />
        </div>
        <div>
          <div className={label}>Product type (optional)</div>
          <input value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="Any" className={field} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="w-4 h-4 accent-amber-500" />
        Verified (show in write-up suggestions)
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button onClick={save} disabled={saving} className="w-full py-3 rounded-xl bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
        {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
        Save work item
      </button>
    </div>
  );
}
