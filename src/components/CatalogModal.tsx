"use client";

// Settings → Manage Catalogs. Modeled on the material-list-maker's Material
// Catalog editor — the two edit the SAME Supabase rows, so they are kept
// feature-for-feature alike: a search box, category filter pills, an item
// count, an "+ Add" button, and collapsible cards you expand to edit inline
// (with category / verified badges and duplicate / delete). Three catalogs
// feed the write-up flow:
//  • Parts — name, category, product type, optional color/size options, a
//    per-variant (color+size) part-number matrix, and an optional photo.
//  • Bundles — "Triple Casement Brick Mould" = these parts at these
//    quantities. One tap in a write-up adds every member.
//  • Work to complete — the "what needs done" list, with an optional
//    time-to-complete per unit.
// Custom entries typed on a write-up land here as "unverified" for review.
//
// Photos are a catalog-screen aid only — never on a write-up, a PDF or an
// email. See lib/catalog-photo.ts.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PartsCatalogItem,
  PartsBundle,
  BundleMember,
  WorkCatalogItem,
  PartVariant,
  fetchAllParts,
  upsertPart,
  deletePart,
  fetchAllBundles,
  upsertBundle,
  deleteBundle,
  resolveBundle,
  partPrice,
  bundlePrice,
  fetchAllWork,
  upsertWork,
  deleteWork,
} from "@/lib/work-order-store";
import CatalogPhotoField, { CatalogThumb } from "@/components/CatalogPhotoField";
import { X, Plus, Trash2, Loader2, Check, Package, Wrench, Layers, ChevronDown, ChevronRight, Copy } from "lucide-react";

type Tab = "parts" | "bundles" | "work";

const TABS: { key: Tab; label: string; icon: typeof Package }[] = [
  { key: "parts", label: "Parts", icon: Package },
  { key: "bundles", label: "Bundles", icon: Layers },
  { key: "work", label: "Work to complete", icon: Wrench },
];

export default function CatalogModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("parts");
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-background w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl h-[94vh] sm:h-auto sm:max-h-[90vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">Manage Catalogs</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-surface text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex gap-1 px-4 pt-3 shrink-0 overflow-x-auto">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${
                tab === key ? "bg-amber-500 text-white" : "bg-surface text-muted"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {tab === "parts" ? <PartsEditor /> : tab === "bundles" ? <BundlesEditor /> : <WorkEditor />}
        </div>
      </div>
    </div>
  );
}

/** "$18.40", or a dash when nothing is recorded — never a confident $0.00. */
function money(n: number | null | undefined): string {
  return n == null ? "—" : "$" + Number(n).toFixed(2);
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
                  <CatalogThumb path={p.photoPath} alt={p.partName} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate flex items-center gap-2">
                      {p.partName}
                      {!p.verified && <Badge tone="review">Review</Badge>}
                    </div>
                    <div className="text-[11px] text-muted truncate">
                      {[p.position, p.variants.length ? `${p.variants.length} part #s` : "", money(partPrice(p))]
                        .filter(Boolean)
                        .join(" · ")}
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
  const [nicknames, setNicknames] = useState<string[]>(part?.nicknames || []);
  const [price, setPrice] = useState(part?.price != null ? String(part.price) : "");
  const [photoPath, setPhotoPath] = useState<string | null>(part?.photoPath || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const colorOpts = colors.length ? colors : [""];
  const sizeOpts = sizes.length ? sizes : [""];
  const variantAt = (c: string, s: string) => variants.find((v) => v.color === c && v.size === s);
  const partNumberFor = (c: string, s: string) => variantAt(c, s)?.partNumber || "";
  /** Keep a variant row while it carries either a part number or its own price. */
  function setVariantField(c: string, s: string, field: "partNumber" | "price", val: string) {
    setVariants((prev) => {
      const rest = prev.filter((v) => !(v.color === c && v.size === s));
      const cur = prev.find((v) => v.color === c && v.size === s) || { color: c, size: s, partNumber: "" };
      const next: PartVariant =
        field === "partNumber"
          ? { ...cur, partNumber: val }
          : { ...cur, price: val === "" ? null : Number(val) };
      const keep = next.partNumber.trim() !== "" || (next.price != null && Number.isFinite(next.price));
      return keep ? [...rest, next] : rest;
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
      // A variant earns its row by carrying a part number or its own price.
      variants: variants.filter((v) => v.partNumber.trim() || v.price != null),
      verified,
      nicknames,
      price: price === "" ? null : Number(price),
      // A copy starts with no photo on purpose: two rows pointing at one file
      // means replacing the original's picture deletes the copy's out from
      // under it, and a broken thumbnail is worse than an empty one.
      photoPath: asCopy ? null : photoPath,
    });
    setSaving(false);
    if (!res.ok) { setError(res.error || "Couldn't save."); return; }
    onDone();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={label}>Model</div>
          <input list="pt-list" value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="A-Series Patio Door…" className={field} />
          <datalist id="pt-list">{productTypes.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        <div>
          {/* One field for both "where on the unit" and "what kind of thing" —
              a part gets found by whichever the person happens to know. */}
          <div className={label}>Location / part type</div>
          <input list="cat-list" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Top frame, handle set, weather stripping…" className={field} />
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
        <div className={label}>Nicknames (optional)</div>
        <ChipList items={nicknames} onChange={setNicknames} placeholder="cam lock, sash latch…" />
        <p className="text-[11px] text-muted mt-1">
          What people call it when they don&apos;t use the real name. A write-up search finds the part by these,
          and shows the nickname in brackets — the write-up still records the real name.
        </p>
      </div>

      <div>
        <div className={label}>Price (each, optional)</div>
        <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className={field} />
        <p className="text-[11px] text-muted mt-1">
          Shown while picking a part, so the wrong one stands out by costing more than expected.
          It is never printed on the write-up.
        </p>
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
        <div className={label}>
          Part number{colorOpts.length * sizeOpts.length > 1 ? "s and prices — per color / size" : " and price"}
        </div>
        <div className="space-y-1.5">
          {colorOpts.map((c) =>
            sizeOpts.map((s) => (
              <div key={`${c}|${s}`} className="flex items-center gap-2">
                {(c || s) && (
                  <span className="text-xs text-muted shrink-0 w-28 truncate">{[c, s].filter(Boolean).join(" · ") || "Any"}</span>
                )}
                <input value={partNumberFor(c, s)} onChange={(e) => setVariantField(c, s, "partNumber", e.target.value)} placeholder="Part #" className={field} />
                <input
                  type="number" min="0" step="0.01"
                  value={variantAt(c, s)?.price ?? ""}
                  onChange={(e) => setVariantField(c, s, "price", e.target.value)}
                  placeholder={price ? Number(price).toFixed(2) : "price"}
                  title="Leave blank to use the part price above"
                  className={`${field} w-24 shrink-0`}
                />
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <div className={label}>Photo (optional)</div>
        <CatalogPhotoField
          path={photoPath}
          folder="parts"
          onChange={setPhotoPath}
          hint="So whoever is maintaining the catalog can tell which part this row means."
        />
      </div>

      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} className="w-4 h-4 accent-amber-500" />
        Verified (show in write-up suggestions)
      </label>

      {part && (part.createdBy || part.updatedBy) && (
        <p className="text-[11px] text-muted border-t border-border pt-2">
          {[
            part.createdBy ? `Added by ${part.createdBy}` : null,
            part.updatedBy
              ? `last changed by ${part.updatedBy}${part.updatedAt ? ` on ${new Date(part.updatedAt).toLocaleDateString()}` : ""}`
              : null,
          ].filter(Boolean).join(" · ")}
        </p>
      )}

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

/* ───────────────────────── Bundles ───────────────────────── */
// A bundle is a named set of parts and quantities. The write-up picker offers
// bundles alongside parts; tapping one adds every member at its quantity.
// A member whose part has since been deleted is shown as missing rather than
// dropped — a bundle must never quietly add fewer parts than it names.

/** Search box over the parts list; calls onPick with the chosen part. */
function PartSearchList({
  parts,
  exclude,
  onPick,
}: {
  parts: PartsCatalogItem[];
  exclude: string[];
  onPick: (p: PartsCatalogItem) => void;
}) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const shown = parts
    .filter((p) => !exclude.includes(p.id))
    .filter((p) => !query || `${p.partName} ${p.category} ${p.productType} ${p.nicknames.join(" ")}`.toLowerCase().includes(query))
    .slice(0, 40);
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a part to add…" className={`${field} mb-2`} />
      <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {shown.length === 0 && <p className="text-xs text-muted text-center py-4">No parts match.</p>}
        {shown.map((p) => (
          <button key={p.id} onClick={() => { onPick(p); setQ(""); }} className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
            <CatalogThumb path={p.photoPath} alt={p.partName} />
            <span className="flex-1 min-w-0 text-xs font-semibold truncate">
              {p.partName}
              <span className="font-normal text-muted">
                {p.position ? ` · ${p.position}` : ""}
                {p.productType ? ` · ${p.productType}` : ""}
              </span>
            </span>
            <span className="text-[11px] text-muted tabular-nums shrink-0">{money(partPrice(p))}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BundlesEditor() {
  const [bundles, setBundles] = useState<PartsBundle[]>([]);
  const [parts, setParts] = useState<PartsCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Bundles can't be built without the parts they name, so both load together.
  const reload = useCallback(async () => {
    const [b, p] = await Promise.all([fetchAllBundles(), fetchAllParts()]);
    setBundles(b);
    setParts(p);
  }, []);
  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, [reload]);

  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  const productTypes = [...new Set(bundles.map((b) => b.productType).filter(Boolean))].sort();
  const q = search.trim().toLowerCase();
  const shown = bundles.filter(
    (b) =>
      (typeFilter === "All" || b.productType === typeFilter) &&
      (!q || `${b.name} ${b.nicknames.join(" ")}`.toLowerCase().includes(q))
  );

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search bundles…" className={`${field} mb-2`} />

      {productTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <Pill active={typeFilter === "All"} onClick={() => setTypeFilter("All")}>All</Pill>
          {productTypes.map((t) => (
            <Pill key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>{t}</Pill>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted">{bundles.length} bundle{bundles.length !== 1 ? "s" : ""}</span>
      </div>

      <button
        onClick={() => { setAdding(true); setExpanded(null); }}
        className="w-full py-2.5 rounded-lg border-2 border-dashed border-amber-500/50 text-amber-600 text-sm font-semibold flex items-center justify-center gap-1 mb-3"
      >
        <Plus className="w-4 h-4" /> Add bundle
      </button>

      {adding && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 mb-2">
          <BundleForm
            bundle={null}
            parts={parts}
            productTypes={[...new Set(parts.map((p) => p.productType).filter(Boolean))].sort()}
            onDone={async () => { setAdding(false); await reload(); }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8 text-muted"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted text-center py-6">
          No bundles{bundles.length === 0 ? " yet — a bundle is a set of parts you add in one tap." : "."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {shown.map((b) => {
            const open = expanded === b.id;
            const price = bundlePrice(b, partsById);
            const missing = b.members.filter((m) => !partsById.has(m.partId)).length;
            return (
              <div key={b.id} className="rounded-lg border border-border bg-surface overflow-hidden">
                <button onClick={() => setExpanded(open ? null : b.id)} className="w-full flex items-center gap-2 px-3 py-2.5 text-left">
                  <CatalogThumb path={b.photoPath} alt={b.name} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate flex items-center gap-2">
                      {b.name}
                      {!b.verified && <Badge tone="review">Review</Badge>}
                    </div>
                    <div className="text-[11px] text-muted truncate">
                      {[
                        `${b.members.length} part${b.members.length !== 1 ? "s" : ""}`,
                        `${money(price.total)}${price.partial && price.total != null ? "+" : ""}`,
                        missing ? `${missing} missing` : "",
                      ].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {b.productType && <Badge tone="category">{b.productType}</Badge>}
                  {open ? <ChevronDown className="w-4 h-4 text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted shrink-0" />}
                </button>
                {open && (
                  <div className="border-t border-border p-3">
                    <BundleForm
                      bundle={b}
                      parts={parts}
                      productTypes={[...new Set(parts.map((p) => p.productType).filter(Boolean))].sort()}
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

function BundleForm({
  bundle,
  parts,
  productTypes,
  onDone,
  onCancel,
}: {
  bundle: PartsBundle | null;
  parts: PartsCatalogItem[];
  productTypes: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(bundle?.name || "");
  const [productType, setProductType] = useState(bundle?.productType || "");
  const [nicknames, setNicknames] = useState<string[]>(bundle?.nicknames || []);
  const [members, setMembers] = useState<BundleMember[]>(bundle?.members || []);
  const [override, setOverride] = useState(bundle?.priceOverride != null ? String(bundle.priceOverride) : "");
  const [photoPath, setPhotoPath] = useState<string | null>(bundle?.photoPath || null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resolved = useMemo(() => resolveBundle(members, parts), [members, parts]);
  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);
  // Priced off the members alone, so the summed figure stays visible next to an
  // override instead of being replaced by it.
  const computed = bundlePrice({ members, priceOverride: null }, partsById);

  function setQty(partId: string, qty: string) {
    setMembers((ms) => ms.map((m) => (m.partId === partId ? { ...m, qty: Math.max(1, Number(qty) || 1) } : m)));
  }

  async function save() {
    setSaving(true);
    setError("");
    const res = await upsertBundle({
      id: bundle?.id,
      name,
      productType,
      nicknames,
      members,
      priceOverride: override === "" ? null : Number(override),
      photoPath,
      // Deliberately no "verified" switch for bundles. The material-list app's
      // bundle form doesn't carry the field, and its save writes verified=true
      // either way — so a bundle held back here would quietly go live the next
      // time somebody edited it there. Both apps write the same value instead.
      // A real draft switch means adding the field in that app too.
    });
    setSaving(false);
    if (!res.ok) { setError(res.error || "Couldn't save."); return; }
    onDone();
  }

  async function remove() {
    setSaving(true);
    setError("");
    const res = await deleteBundle(bundle!.id);
    setSaving(false);
    if (!res.ok) { setError(res.error || "Couldn't delete."); setConfirmDelete(false); return; }
    onDone();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className={label}>Bundle name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Triple Casement Brick Mould" className={field} />
        </div>
        <div>
          <div className={label}>Model (optional)</div>
          <input list="bundle-pt-list" value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="A-Series Patio Door…" className={field} />
          <datalist id="bundle-pt-list">{productTypes.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
      </div>

      <div>
        <div className={label}>Nicknames (optional)</div>
        <ChipList items={nicknames} onChange={setNicknames} placeholder="3-wide brick mould…" />
        <p className="text-[11px] text-muted mt-1">Other ways someone might search for this bundle in a write-up.</p>
      </div>

      <div>
        <div className={label}>Parts in this bundle</div>
        {resolved.length === 0 && <p className="text-xs text-muted py-1.5">No parts yet — add at least one.</p>}
        <div className="space-y-1.5 mb-2">
          {resolved.map((m) => (
            <div
              key={m.partId}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${m.missing ? "border-danger/40 bg-danger/5" : "border-border bg-surface"}`}
            >
              <span className={`flex-1 min-w-0 text-xs truncate ${m.missing ? "text-danger" : ""}`}>
                {m.missing ? "(part no longer in the catalog)" : m.part!.partName}
                {!m.missing && m.part!.position && <span className="text-muted"> · {m.part!.position}</span>}
              </span>
              <span className="text-[11px] text-muted tabular-nums shrink-0">{m.missing ? "" : money(partPrice(m.part!))}</span>
              <input
                type="number" min="1" step="1" value={m.qty}
                onChange={(e) => setQty(m.partId, e.target.value)}
                title="Quantity in one bundle"
                className={`${field} w-16 shrink-0 text-center`}
              />
              <button
                onClick={() => setMembers((ms) => ms.filter((x) => x.partId !== m.partId))}
                title="Remove from bundle"
                className="p-1.5 rounded-lg border border-danger/40 text-danger shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        {adding ? (
          <div className="rounded-lg border border-amber-500/40 p-2.5">
            <PartSearchList
              parts={parts}
              exclude={members.map((m) => m.partId)}
              onPick={(p) => {
                setAdding(false);
                setMembers((ms) => (ms.some((m) => m.partId === p.id) ? ms : [...ms, { partId: p.id, qty: 1 }]));
              }}
            />
            <button onClick={() => setAdding(false)} className="text-[11px] text-muted underline mt-2">Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full py-2 rounded-lg border border-dashed border-amber-500/50 text-amber-600 text-xs font-semibold flex items-center justify-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add part to bundle
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 items-start">
        <div>
          <div className={label}>Bundle price</div>
          <div className="text-base font-semibold">
            {override !== "" ? money(Number(override)) : `${money(computed.total)}${computed.partial && computed.total != null ? "+" : ""}`}
          </div>
          <p className="text-[11px] text-muted mt-1 leading-snug">
            {override !== ""
              ? "Overridden — the members' prices are ignored."
              : computed.partial
              ? "Summed from the members. Some have no price yet, so this is a floor, not the total."
              : "Summed from the members, so it follows along when a part's price changes."}
          </p>
        </div>
        <div>
          <div className={label}>Price override</div>
          <input type="number" min="0" step="0.01" value={override} onChange={(e) => setOverride(e.target.value)} placeholder="leave blank" className={field} />
          <p className="text-[11px] text-muted mt-1">Only if the bundle is quoted as a kit.</p>
        </div>
      </div>

      <div>
        <div className={label}>Photo (optional)</div>
        <CatalogPhotoField path={photoPath} folder="bundles" onChange={setPhotoPath} hint="A picture of what this bundle amounts to." />
      </div>

      {bundle && (bundle.createdBy || bundle.updatedBy) && (
        <p className="text-[11px] text-muted border-t border-border pt-2">
          {[
            bundle.createdBy ? `Added by ${bundle.createdBy}` : null,
            bundle.updatedBy
              ? `last changed by ${bundle.updatedBy}${bundle.updatedAt ? ` on ${new Date(bundle.updatedAt).toLocaleDateString()}` : ""}`
              : null,
          ].filter(Boolean).join(" · ")}
        </p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="flex-1 py-2.5 rounded-lg bg-amber-500 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save
        </button>
        <button onClick={onCancel} className="px-3 py-2.5 rounded-lg border border-border text-sm text-muted">Cancel</button>
        {bundle && (
          confirmDelete ? (
            <button onClick={remove} disabled={saving} className="px-3 py-2.5 rounded-lg bg-danger text-white text-sm font-semibold">Delete?</button>
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
