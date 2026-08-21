"use client";

// Settings → Manage Catalogs. Modeled on the material-list-maker's Material
// Catalog editor: a search box, category filter pills, an item count, an
// "+ Add" button, and collapsible item cards you expand to edit inline (with
// category / verified badges and duplicate / delete). Two catalogs feed the
// write-up flow:
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
import { X, Plus, Trash2, Loader2, Check, Package, Wrench, ChevronDown, ChevronRight, Copy } from "lucide-react";

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
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold ${
                tab === t ? "bg-amber-500 text-white" : "bg-surface text-muted"
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

function Pill({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold ${active ? "bg-amber-500 text-white" : "bg-surface text-muted border border-border"}`}
    >
      {children}
    </button>
  );
}

function Badge({ tone, children }: { tone: "category" | "muted" | "review"; children: React.ReactNode }) {
  const cls =
    tone === "category"
      ? "bg-amber-500/15 text-amber-600"
      : tone === "review"
      ? "bg-amber-500/15 text-amber-600"
      : "bg-surface text-muted border border-border";
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${cls}`}>{children}</span>;
}

/* ───────────────────────── Parts ───────────────────────── */

function PartsEditor() {
  const [parts, setParts] = useState<PartsCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function reload() {
    setParts(await fetchAllParts());
  }
  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  const productTypes = [...new Set(parts.map((p) => p.productType).filter(Boolean))].sort();
  const categories = [...new Set(parts.map((p) => p.category).filter(Boolean))].sort();
  const q = search.trim().toLowerCase();
  const shown = parts.filter(
    (p) =>
      (catFilter === "All" || p.productType === catFilter) &&
      (!q || `${p.partName} ${p.category} ${p.position || ""}`.toLowerCase().includes(q))
  );

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search parts…" className={`${field} mb-2`} />

      <div className="flex flex-wrap gap-1.5 mb-3">
        <Pill active={catFilter === "All"} onClick={() => setCatFilter("All")}>All</Pill>
        {productTypes.map((t) => (
          <Pill key={t} active={catFilter === t} onClick={() => setCatFilter(t)}>{t}</Pill>
        ))}
      </div>

      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted">{parts.length} part{parts.length !== 1 ? "s" : ""}</span>
      </div>

      <button
        onClick={() => { setAdding(true); setExpanded(null); }}
        className="w-full py-2.5 rounded-lg border-2 border-dashed border-amber-500/50 text-amber-600 text-sm font-semibold flex items-center justify-center gap-1 mb-3"
      >
        <Plus className="w-4 h-4" /> Add part {catFilter !== "All" ? `(${catFilter})` : ""}
      </button>

      {adding && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 mb-2">
          <PartForm
            part={null}
            defaultProductType={catFilter !== "All" ? catFilter : ""}
            productTypes={productTypes}
            categories={categories}
            onDone={async () => { setAdding(false); await reload(); }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8 text-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted text-center py-6">No parts.</p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((p) => {
            const open = expanded === p.id;
            return (
              <div key={p.id} className="rounded-lg border border-border bg-surface overflow-hidden">
                <button onClick={() => setExpanded(open ? null : p.id)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate flex items-center gap-2">
                      {p.partName}
                      {!p.verified && <Badge tone="review">Review</Badge>}
                    </div>
                    <div className="text-[11px] text-muted truncate">
                      {[p.position, p.variants.length ? `${p.variants.length} part #s` : ""].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <Badge tone="category">{p.category || "—"}</Badge>
                  {open ? <ChevronDown className="w-4 h-4 text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted shrink-0" />}
                </button>
                {open && (
                  <div className="border-t border-border p-3">
                    <PartForm
                      part={p}
                      productTypes={productTypes}
                      categories={categories}
                      onDone={async () => { setExpanded(null); await reload(); }}
                      onCancel={() => setExpanded(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {items.map((it) => (
            <span key={it} className="inline-flex items-center gap-1 text-xs bg-background border border-border rounded-full px-2 py-1">
              {it}
              <button onClick={() => onChange(items.filter((x) => x !== it))} className="text-muted hover:text-danger">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
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
  defaultProductType,
  productTypes,
  categories,
  onDone,
  onCancel,
}: {
  part: PartsCatalogItem | null;
  defaultProductType?: string;
  productTypes: string[];
  categories: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [productType, setProductType] = useState(part?.productType || defaultProductType || "");
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

  async function save(asCopy = false) {
    if (!partName.trim()) { setError("A part name is required."); return; }
    setSaving(true);
    setError("");
    const res = await upsertPart({
      id: asCopy ? undefined : part?.id,
      productType: productType || "Custom",
      category: category || "Custom",
      partName: asCopy ? `${partName} (Copy)` : partName,
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
                  <span className="text-xs text-muted shrink-0 w-28 truncate">{[c, s].filter(Boolean).join(" · ") || "Any"}</span>
                )}
                <input value={partNumberFor(c, s)} onChange={(e) => setPartNumber(c, s, e.target.value)} placeholder="Part #" className={field} />
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

      <div className="flex items-center gap-2">
        <button onClick={() => save(false)} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save
        </button>
        {part && (
          <button onClick={() => save(true)} disabled={saving} title="Save as a copy" className="px-3 py-2.5 rounded-lg border border-border text-muted">
            <Copy className="w-4 h-4" />
          </button>
        )}
        <button onClick={onCancel} className="px-3 py-2.5 rounded-lg border border-border text-sm text-muted">Cancel</button>
        {part && (
          confirmDelete ? (
            <button onClick={async () => { await deletePart(part.id); onDone(); }} className="px-3 py-2.5 rounded-lg bg-danger text-white text-sm font-semibold">Delete?</button>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="px-3 py-2.5 rounded-lg border border-danger/40 text-danger"><Trash2 className="w-4 h-4" /></button>
          )
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── Work to complete ───────────────────────── */

function WorkEditor() {
  const [items, setItems] = useState<WorkCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function reload() {
    setItems(await fetchAllWork());
  }
  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  const q = search.trim().toLowerCase();
  const shown = q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items;

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search work items…" className={`${field} mb-2`} />
      <div className="text-xs text-muted mb-2">{items.length} item{items.length !== 1 ? "s" : ""}</div>

      <button
        onClick={() => { setAdding(true); setExpanded(null); }}
        className="w-full py-2.5 rounded-lg border-2 border-dashed border-amber-500/50 text-amber-600 text-sm font-semibold flex items-center justify-center gap-1 mb-3"
      >
        <Plus className="w-4 h-4" /> Add work item
      </button>

      {adding && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 mb-2">
          <WorkForm item={null} onDone={async () => { setAdding(false); await reload(); }} onCancel={() => setAdding(false)} />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8 text-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted text-center py-6">No work items.</p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((it) => {
            const open = expanded === it.id;
            return (
              <div key={it.id} className="rounded-lg border border-border bg-surface overflow-hidden">
                <button onClick={() => setExpanded(open ? null : it.id)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate flex items-center gap-2">
                      {it.label}
                      {!it.verified && <Badge tone="review">Review</Badge>}
                    </div>
                  </div>
                  {it.minutesPerUnit != null && <Badge tone="muted">{it.minutesPerUnit} min/unit</Badge>}
                  {open ? <ChevronDown className="w-4 h-4 text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted shrink-0" />}
                </button>
                {open && (
                  <div className="border-t border-border p-3">
                    <WorkForm item={it} onDone={async () => { setExpanded(null); await reload(); }} onCancel={() => setExpanded(null)} />
                  </div>
                )}
              </div>
            );
          })}
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
      <div>
        <div className={label}>Work item</div>
        <input value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="Redo caulking" className={field} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={label}>Time per unit (min)</div>
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

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save
        </button>
        <button onClick={onCancel} className="px-3 py-2.5 rounded-lg border border-border text-sm text-muted">Cancel</button>
        {item && (
          confirmDelete ? (
            <button onClick={async () => { await deleteWork(item.id); onDone(); }} className="px-3 py-2.5 rounded-lg bg-danger text-white text-sm font-semibold">Delete?</button>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="px-3 py-2.5 rounded-lg border border-danger/40 text-danger"><Trash2 className="w-4 h-4" /></button>
          )
        )}
      </div>
    </div>
  );
}
