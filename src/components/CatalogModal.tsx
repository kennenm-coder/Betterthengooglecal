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
import { useBackClose } from "@/hooks/useBackClose";
import {
  PartsCatalogItem,
  PartsBundle,
  BundleMember,
  WorkCatalogItem,
  PartVariant,
  fetchAllParts,
  upsertPart,
  sectionsInUse,
  matchingPartNumber,
  DEFAULT_PART_SECTION,
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
  useBackClose(onClose);
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
/** A part with more colour × size variants than this folds its matrix away. */
const MATRIX_FOLD_ABOVE = 8;

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
// The catalog is split into SECTIONS (Location Parts, Renewal Parts, later IQ
// Parts). The screen narrows Section → Model → Category, and a long result is
// shown as collapsible category groups instead of one wall of cards. A bundle
// can still hold parts from any section — bundles refer to parts by id.

/** Remembered between visits, per device. Never required: private windows and
 *  blocked storage throw, and the screen just opens on "All". */
const SECTION_KEY = "catalog.parts.section";

function readSavedSection(): string {
  try {
    return window.localStorage.getItem(SECTION_KEY) || "All";
  } catch {
    return "All";
  }
}

function saveSection(section: string) {
  try {
    window.localStorage.setItem(SECTION_KEY, section);
  } catch {
    /* storage unavailable — the choice just isn't remembered */
  }
}

/** Past this many parts on screen the list is grouped by category and starts
 *  collapsed — 700 cards in a row is not something a phone can use. */
const GROUP_ABOVE = 60;
/** Cards drawn at once; "Show more" draws the next batch. */
const RENDER_STEP = 100;
/** More categories than this and the chips become a dropdown. */
const MAX_CATEGORY_CHIPS = 12;

const REVIEW_GROUP = "\u0000review";

const uniqSorted = (list: string[]) => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));

/** Does this part answer the search? Name, category, position, nicknames, or any
 *  variant's part number. `q` is already trimmed and lowercased. */
function partMatches(p: PartsCatalogItem, q: string): boolean {
  if (!q) return true;
  return (
    `${p.partName} ${p.category} ${p.position || ""} ${p.nicknames.join(" ")}`.toLowerCase().includes(q) ||
    matchingPartNumber(p, q) !== undefined
  );
}

/** How many rows each group may draw so the total stays within `limit`, in order. */
function takeCounts(sizes: number[], limit: number): number[] {
  let left = limit;
  return sizes.map((n) => {
    const take = Math.max(0, Math.min(n, left));
    left -= take;
    return take;
  });
}

function PartsEditor() {
  const [parts, setParts] = useState<PartsCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [section, setSection] = useState<string>(() => (typeof window === "undefined" ? "All" : readSavedSection()));
  const [typeFilter, setTypeFilter] = useState("All");
  const [catFilter, setCatFilter] = useState("All");
  // Category groups the person has flipped from how they would open by default.
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(RENDER_STEP);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function reload() {
    setParts(await fetchAllParts());
  }
  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  /** Any change to what is being looked at starts the list afresh. */
  function resetView() {
    setFlipped(new Set());
    setLimit(RENDER_STEP);
  }

  const sections = useMemo(() => sectionsInUse(parts), [parts]);
  // A remembered section that has no parts any more (or none loaded yet) is "All".
  const activeSection = section !== "All" && sections.includes(section) ? section : "All";
  const inSection = useMemo(
    () => (activeSection === "All" ? parts : parts.filter((p) => p.section === activeSection)),
    [parts, activeSection]
  );

  const productTypes = useMemo(() => uniqSorted(inSection.map((p) => p.productType)), [inSection]);
  const activeType = typeFilter !== "All" && productTypes.includes(typeFilter) ? typeFilter : "All";
  const inType = useMemo(
    () => (activeType === "All" ? inSection : inSection.filter((p) => p.productType === activeType)),
    [inSection, activeType]
  );

  const categories = useMemo(() => uniqSorted(inType.map((p) => p.category)), [inType]);
  const activeCat = catFilter !== "All" && categories.includes(catFilter) ? catFilter : "All";
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of inType) m.set(p.category, (m.get(p.category) || 0) + 1);
    return m;
  }, [inType]);

  // What the forms offer as suggestions — the whole catalog, not just this view.
  const allProductTypes = useMemo(() => uniqSorted(parts.map((p) => p.productType)), [parts]);
  const allCategories = useMemo(() => uniqSorted(parts.map((p) => p.category)), [parts]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () => inType.filter((p) => (activeCat === "All" || p.category === activeCat) && partMatches(p, q)),
    [inType, activeCat, q]
  );

  const grouped = shown.length > GROUP_ABOVE;
  const groups = useMemo(() => {
    if (!grouped) return [];
    const review: PartsCatalogItem[] = [];
    const byCat = new Map<string, PartsCatalogItem[]>();
    for (const p of shown) {
      // Parts awaiting review get a group of their own, open — buried in a
      // collapsed category they would never be seen.
      if (!p.verified) { review.push(p); continue; }
      const key = p.category || "(No category)";
      const arr = byCat.get(key) || [];
      arr.push(p);
      byCat.set(key, arr);
    }
    const out = [...byCat.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, items]) => ({ key, title: key, items }));
    if (review.length) out.unshift({ key: REVIEW_GROUP, title: "Needs review", items: review });
    return out;
  }, [shown, grouped]);

  /** A group opens by default while searching, when it is the only one, and for
   *  the review pile; otherwise it starts closed. The person's taps flip that. */
  const groupOpen = (key: string) => {
    const byDefault = q !== "" || groups.length === 1 || key === REVIEW_GROUP;
    return byDefault !== flipped.has(key);
  };
  const flip = (key: string) =>
    setFlipped((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const multiSection = sections.length > 1;
  const addSection = activeSection !== "All" ? activeSection : DEFAULT_PART_SECTION;
  const addScope = [activeSection !== "All" ? activeSection : "", activeType !== "All" ? activeType : ""]
    .filter(Boolean)
    .join(" · ");

  function pickSection(s: string) {
    setSection(s);
    saveSection(s);
    setTypeFilter("All");
    setCatFilter("All");
    resetView();
  }

  function renderCard(p: PartsCatalogItem) {
    const open = expanded === p.id;
    const hit = q ? matchingPartNumber(p, q) : undefined;
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
              {[
                p.position,
                p.variants.length ? `${p.variants.length} part #s` : "",
                hit ? `Part # ${hit}` : "",
                money(partPrice(p)),
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
          {/* Which catalog it is in — only worth saying when the list mixes them. */}
          {multiSection && activeSection === "All" && <Badge tone="muted">{p.section}</Badge>}
          <Badge tone="category">{p.category || "—"}</Badge>
          {open ? <ChevronDown className="w-4 h-4 text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted shrink-0" />}
        </button>
        {open && (
          <div className="border-t border-border p-3">
            <PartForm
              part={p}
              productTypes={allProductTypes}
              categories={allCategories}
              sectionOptions={sections}
              onDone={async () => { setExpanded(null); await reload(); }}
              onCancel={() => setExpanded(null)}
            />
          </div>
        )}
      </div>
    );
  }

  // The list body. A flat list stays as it always was; a long one is grouped,
  // and only as many cards are drawn as the "Show more" batches allow.
  const openSizes = groups.map((g) => (groupOpen(g.key) ? g.items.length : 0));
  const takes = takeCounts(openSizes, limit);
  const truncated = takes.some((n, i) => n < openSizes[i]);
  const body = grouped ? (
    <div className="space-y-2">
      {groups.map((g, gi) => {
        const open = groupOpen(g.key);
        const cards = g.items.slice(0, takes[gi]);
        return (
          <div key={g.key}>
            <button
              onClick={() => flip(g.key)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border text-left"
            >
              {open ? <ChevronDown className="w-4 h-4 text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted shrink-0" />}
              <span className={`flex-1 min-w-0 text-sm font-semibold truncate ${g.key === REVIEW_GROUP ? "text-amber-600" : ""}`}>{g.title}</span>
              <span className="text-xs text-muted tabular-nums shrink-0">{g.items.length}</span>
            </button>
            {open && cards.length > 0 && <div className="space-y-1.5 mt-1.5 mb-1">{cards.map(renderCard)}</div>}
          </div>
        );
      })}
      {truncated && (
        <button
          onClick={() => setLimit((n) => n + RENDER_STEP)}
          className="w-full py-2.5 rounded-lg border border-border text-sm font-semibold text-muted"
        >
          Show more
        </button>
      )}
    </div>
  ) : (
    <div className="space-y-1.5">{shown.map(renderCard)}</div>
  );

  return (
    <div>
      <input
        value={search}
        onChange={(e) => { setSearch(e.target.value); resetView(); }}
        placeholder="Search name, category or part number…"
        className={`${field} mb-2`}
      />

      {multiSection && (
        <div className="mb-2">
          <div className={label}>Section</div>
          <div className="flex flex-wrap gap-1.5">
            <Pill active={activeSection === "All"} onClick={() => pickSection("All")}>All ({parts.length})</Pill>
            {sections.map((s) => (
              <Pill key={s} active={activeSection === s} onClick={() => pickSection(s)}>
                {s} ({parts.filter((p) => p.section === s).length})
              </Pill>
            ))}
          </div>
        </div>
      )}

      <div className="mb-2">
        {multiSection && <div className={label}>Model</div>}
        <div className="flex flex-wrap gap-1.5">
          <Pill active={activeType === "All"} onClick={() => { setTypeFilter("All"); setCatFilter("All"); resetView(); }}>All</Pill>
          {productTypes.map((t) => (
            <Pill key={t} active={activeType === t} onClick={() => { setTypeFilter(t); setCatFilter("All"); resetView(); }}>{t}</Pill>
          ))}
        </div>
      </div>

      {categories.length > 1 && (
        <div className="mb-3">
          <div className={label}>Category</div>
          {categories.length > MAX_CATEGORY_CHIPS ? (
            <select
              value={activeCat}
              onChange={(e) => { setCatFilter(e.target.value); resetView(); }}
              className={field}
            >
              <option value="All">All categories ({inType.length})</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c} ({categoryCounts.get(c) || 0})</option>
              ))}
            </select>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <Pill active={activeCat === "All"} onClick={() => { setCatFilter("All"); resetView(); }}>All</Pill>
              {categories.map((c) => (
                <Pill key={c} active={activeCat === c} onClick={() => { setCatFilter(c); resetView(); }}>
                  {c} ({categoryCounts.get(c) || 0})
                </Pill>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted">
          {shown.length} part{shown.length !== 1 ? "s" : ""}
          {shown.length !== parts.length ? ` of ${parts.length}` : ""}
        </span>
      </div>

      <button
        onClick={() => { setAdding(true); setExpanded(null); }}
        className="w-full py-2.5 rounded-lg border-2 border-dashed border-amber-500/50 text-amber-600 text-sm font-semibold flex items-center justify-center gap-1 mb-3"
      >
        <Plus className="w-4 h-4" /> Add part {addScope ? `(${addScope})` : ""}
      </button>

      {adding && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 mb-2">
          <PartForm
            part={null}
            defaultProductType={activeType !== "All" ? activeType : ""}
            defaultSection={addSection}
            productTypes={allProductTypes}
            categories={allCategories}
            sectionOptions={sections}
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
        body
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
  defaultSection,
  productTypes,
  categories,
  sectionOptions,
  onDone,
  onCancel,
}: {
  part: PartsCatalogItem | null;
  defaultProductType?: string;
  /** Where a NEW part goes — the section being looked at, never "All". */
  defaultSection?: string;
  productTypes: string[];
  categories: string[];
  /** Sections that already have parts; the form adds the standard ones. */
  sectionOptions: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [section, setSection] = useState(part?.section || defaultSection || DEFAULT_PART_SECTION);
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
  // A part with dozens of colour/size variants would be a screen of inputs, so
  // a big matrix starts folded away behind a one-line summary.
  const [showMatrix, setShowMatrix] = useState(false);

  const colorOpts = colors.length ? colors : [""];
  const sizeOpts = sizes.length ? sizes : [""];
  const variantCount = colorOpts.length * sizeOpts.length;
  const bigMatrix = variantCount > MATRIX_FOLD_ABOVE;
  const filledCount = variants.filter((v) => v.partNumber.trim()).length;
  const sectionChoices = [...new Set([...sectionOptions, DEFAULT_PART_SECTION, "Renewal Parts", "IQ Parts", section])];
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
      section,
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
      <div>
        <div className={label}>Section</div>
        <select value={section} onChange={(e) => setSection(e.target.value)} className={field}>
          {sectionChoices.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
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
          Part number{variantCount > 1 ? "s and prices — per color / size" : " and price"}
        </div>
        {bigMatrix && (
          <button
            type="button"
            onClick={() => setShowMatrix((v) => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-background text-left text-sm"
          >
            {showMatrix ? <ChevronDown className="w-4 h-4 text-muted shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted shrink-0" />}
            <span className="flex-1 min-w-0 font-semibold">{variantCount} variants</span>
            <span className="text-xs text-muted shrink-0">
              {filledCount} part #s filled · {showMatrix ? "Hide" : "Show"}
            </span>
          </button>
        )}
        {(!bigMatrix || showMatrix) && (
          <div className={`space-y-1.5 ${bigMatrix ? "mt-1.5 max-h-96 overflow-y-auto pr-1" : ""}`}>
            {colorOpts.map((c) =>
              sizeOpts.map((s) => (
                <div key={`${c}|${s}`} className="flex items-center gap-2">
                  {(c || s) && (
                    <span className={`text-xs text-muted shrink-0 truncate ${bigMatrix ? "w-40" : "w-28"}`} title={[c, s].filter(Boolean).join(" · ")}>
                      {[c, s].filter(Boolean).join(" · ") || "Any"}
                    </span>
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
        )}
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

/** Search box over the parts list; calls onPick with the chosen part. Reaches
 *  every section — a bundle can mix Location, Renewal and any other parts. */
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
  const multiSection = useMemo(() => new Set(parts.map((p) => p.section)).size > 1, [parts]);
  const matches = parts
    .filter((p) => !exclude.includes(p.id))
    .filter(
      (p) =>
        !query ||
        `${p.partName} ${p.category} ${p.productType} ${p.section} ${p.position || ""} ${p.nicknames.join(" ")}`
          .toLowerCase()
          .includes(query) ||
        matchingPartNumber(p, query) !== undefined
    );
  const shown = matches.slice(0, 40);
  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a part or part number to add…" className={`${field} mb-2`} />
      <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {shown.length === 0 && <p className="text-xs text-muted text-center py-4">No parts match.</p>}
        {shown.map((p) => {
          const hit = query ? matchingPartNumber(p, query) : undefined;
          return (
            <button key={p.id} onClick={() => { onPick(p); setQ(""); }} className="w-full flex items-center gap-2 px-2.5 py-2 text-left">
              <CatalogThumb path={p.photoPath} alt={p.partName} />
              <span className="flex-1 min-w-0 text-xs font-semibold truncate">
                {p.partName}
                <span className="font-normal text-muted">
                  {p.position ? ` · ${p.position}` : ""}
                  {p.productType ? ` · ${p.productType}` : ""}
                  {multiSection ? ` · ${p.section}` : ""}
                  {hit ? ` · Part # ${hit}` : ""}
                </span>
              </span>
              <span className="text-[11px] text-muted tabular-nums shrink-0">{money(partPrice(p))}</span>
            </button>
          );
        })}
        {matches.length > shown.length && (
          <p className="text-[11px] text-muted text-center py-2">
            Showing {shown.length} of {matches.length} — type to narrow it down.
          </p>
        )}
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
