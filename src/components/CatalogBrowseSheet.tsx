"use client";

// ─── CATALOG BROWSE SHEET ───────────────────────────────────────────────────
// The write-up's photo catalog: a full-screen sheet over the write-up for
// picking parts by looking at them instead of knowing their names. Opened from
// "Browse catalog" beside the parts search; Done, X, or the phone's back
// button closes it and the write-up underneath is exactly as it was — the sheet
// holds nothing of the write-up's, it only hands picked parts back up.
//
// Read-only on purpose. The catalog screen's editor (PartForm, photo upload)
// is never mounted here: only admins and field managers may write the catalog,
// and a tech picking a part has no business one tap away from editing it.
//
// Photos show here while PICKING. They are still never saved on a write-up,
// a PDF, an email or an install doc — see lib/catalog-photo.ts.
//
// Built for ~700 parts on a phone: categories first as big tiles, a grid drawn
// in steps of GRID_STEP with "Show more", and lazy images.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBackClose } from "@/hooks/useBackClose";
import {
  type PartsCatalogItem,
  type PartsBundle,
  sectionsInUse,
  matchingPartNumber,
  partPrice,
  bundlePrice,
} from "@/lib/work-order-store";
import { familyMatcher, isInstallBucket, isUniversalType, onlyIqProducts } from "@/lib/product-family";
import { catalogPhotoUrl } from "@/lib/catalog-photo";
import {
  settleVariant,
  variantColors,
  variantSizes,
  needsPick,
  optionCount,
  partDescription,
  partDetailLines,
  choiceHint,
  type VariantPick,
} from "@/lib/part-variants";
import { PartSourceBadge } from "@/components/PartSourceBadge";
import { ArrowLeft, Check, ImageOff, Layers, Plus, Search, X } from "lucide-react";

/** Cards drawn at once; "Show more" draws the next batch. */
const GRID_STEP = 40;

/** The category key for the part-packs (bundles) tile. */
const PACKS = "\u0000packs";

/** Remembered per device, apart from the catalog screen's own choice. */
const SECTION_KEY = "writeup.browse.section";

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

const money = (n: number | null) => (n == null ? "" : `$${n.toFixed(2)}`);

/** Which product types the grid shows: the units' own (the default), every
 *  type, or a hand-picked set. Blank / universal parts and "Custom" ones show
 *  under all three, as they do in the search dropdown. */
type TypeMode = { kind: "units" } | { kind: "all" } | { kind: "set"; types: string[] };

export default function CatalogBrowseSheet({
  catalog,
  bundles,
  unitTypes,
  initialQuery = "",
  onAddPart,
  onAddBundle,
  onClose,
}: {
  catalog: PartsCatalogItem[];
  bundles: PartsBundle[];
  /** Product types of the units being written up — what the type chips start on. */
  unitTypes: string[];
  /** What was already typed in the write-up's search box, carried over. */
  initialQuery?: string;
  onAddPart: (part: PartsCatalogItem, pick: VariantPick, qty: number) => void;
  /** Returns how many part lines the bundle actually added. */
  onAddBundle: (bundle: PartsBundle, count: number) => number;
  onClose: () => void;
}) {
  useBackClose(onClose);

  const [query, setQuery] = useState(initialQuery);
  const [section, setSection] = useState<string>(() => readSavedSection());
  const unitKey = unitTypes.map((t) => t.trim()).filter(Boolean).join("\u0000");
  const matcher = useMemo(() => familyMatcher(unitKey ? unitKey.split("\u0000") : []), [unitKey]);
  const [typeMode, setTypeMode] = useState<TypeMode>(() => (matcher.empty ? { kind: "all" } : { kind: "units" }));
  const [category, setCategory] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [added, setAdded] = useState(0);
  const [flash, setFlash] = useState<{ text: string } | null>(null);

  // Back steps out of a category before it closes the sheet.
  useBackClose(() => setCategory(null), { active: category !== null });

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(t);
  }, [flash]);

  const partsById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);

  const sections = useMemo(() => sectionsInUse(catalog), [catalog]);
  const multiSection = sections.length > 1;
  const activeSection = multiSection && sections.includes(section) ? section : "All";
  const inSection = useMemo(
    () => (activeSection === "All" ? catalog : catalog.filter((c) => c.section === activeSection)),
    [catalog, activeSection]
  );

  const typeOk = useMemo(() => {
    return (type: string | null | undefined, cat?: string | null): boolean => {
      if ((cat || "").trim().toLowerCase() === "custom") return true;
      if (typeMode.kind === "all") return true;
      if (typeMode.kind === "units") return matcher.matches(type);
      // Renewal's "Installation Parts" stay with every chip except IQ products
      // (patio / storm doors): their parts are the IQ Parts section's.
      if (isUniversalType(type)) return !(isInstallBucket(type) && onlyIqProducts(typeMode.types));
      return typeMode.types.includes((type || "").trim());
    };
  }, [typeMode, matcher]);

  // The type chips: the section's named types, the selected ones first.
  const typeChips = useMemo(() => {
    const all = [...new Set(inSection.map((c) => c.productType.trim()).filter((t) => t && !isUniversalType(t)))];
    const on = (t: string) => typeMode.kind !== "all" && typeOk(t);
    return all.sort((a, b) => Number(on(b)) - Number(on(a)) || a.localeCompare(b)).map((t) => ({ type: t, on: on(t) }));
  }, [inSection, typeMode, typeOk]);

  function toggleType(t: string) {
    const current = typeChips.filter((c) => c.on).map((c) => c.type);
    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
    setTypeMode(next.length ? { kind: "set", types: next } : { kind: "all" });
    setCategory(null);
  }

  const q = query.trim().toLowerCase();

  // Browsing narrows by type; a search covers the whole section, as the search
  // dropdown does — someone typing a name is asking for that part.
  const browseParts = useMemo(() => inSection.filter((c) => typeOk(c.productType, c.category)), [inSection, typeOk]);
  const searchHits = useMemo(() => {
    if (!q) return [];
    return inSection
      .filter(
        (c) =>
          `${c.productType} ${c.category} ${c.partName} ${c.position || ""} ${c.nicknames.join(" ")}`.toLowerCase().includes(q) ||
          matchingPartNumber(c, q) !== undefined
      )
      .sort((a, b) => Number(typeOk(b.productType, b.category)) - Number(typeOk(a.productType, a.category)));
  }, [inSection, q, typeOk]);

  const shownBundles = useMemo(() => {
    if (q) {
      return bundles.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.productType.toLowerCase().includes(q) ||
          b.nicknames.some((n) => n.toLowerCase().includes(q))
      );
    }
    return bundles.filter((b) => typeOk(b.productType));
  }, [bundles, q, typeOk]);

  const categories = useMemo(() => {
    const by = new Map<string, PartsCatalogItem[]>();
    for (const c of browseParts) {
      const k = c.category.trim() || "Other";
      const arr = by.get(k) || [];
      arr.push(c);
      by.set(k, arr);
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, items]) => ({ name, items, photo: items.find((i) => i.photoPath)?.photoPath || null }));
  }, [browseParts]);

  const inCategory = useMemo(
    () => (category && category !== PACKS ? browseParts.filter((c) => (c.category.trim() || "Other") === category) : []),
    [browseParts, category]
  );

  // How many cards are drawn. Kept with the view it belongs to, so changing
  // what's looked at starts afresh without an effect.
  const viewKey = [q, category || "", activeSection, JSON.stringify(typeMode)].join("|");
  const [limitState, setLimitState] = useState({ key: viewKey, n: GRID_STEP });
  const limit = limitState.key === viewKey ? limitState.n : GRID_STEP;
  const showMore = () => setLimitState({ key: viewKey, n: limit + GRID_STEP });

  function pickSection(s: string) {
    setSection(s);
    saveSection(s);
    setCategory(null);
  }

  function addPart(part: PartsCatalogItem, pick: VariantPick, qty: number) {
    onAddPart(part, pick, qty);
    setAdded((n) => n + 1);
    setFlash({ text: `Added ${qty > 1 ? `${qty} × ` : ""}${part.partName}` });
  }

  function addBundle(b: PartsBundle, count: number) {
    const n = onAddBundle(b, count);
    setAdded((x) => x + n);
    setFlash({
      text: n ? `Added ${b.name}${count > 1 ? ` × ${count}` : ""} (${n} part${n === 1 ? "" : "s"})` : `${b.name}: none of its parts are in the catalog`,
    });
  }

  const detail = detailId ? partsById.get(detailId) : undefined;
  const title = q ? "Search" : category === PACKS ? "Part packs" : category || "Parts catalog";

  const grid = (items: PartsCatalogItem[]) => (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2.5">
        {items.slice(0, limit).map((c) => (
          <PartCard
            key={c.id}
            part={c}
            matchedNumber={q ? matchingPartNumber(c, q) : undefined}
            offType={q && !typeOk(c.productType, c.category) ? c.productType : undefined}
            onOpen={() => setDetailId(c.id)}
            onQuickAdd={() => addPart(c, settleVariant(c, "", ""), 1)}
          />
        ))}
      </div>
      {items.length > limit && (
        <button
          type="button"
          onClick={showMore}
          className="mt-3 w-full py-3 rounded-xl border border-border text-sm font-semibold text-amber-600 bg-surface"
        >
          Show more ({items.length - limit} more)
        </button>
      )}
    </>
  );

  const body = q ? (
    <>
      {shownBundles.length > 0 && (
        <div className="mb-3 space-y-2">
          {shownBundles.map((b) => (
            <BundleCard key={b.id} bundle={b} partsById={partsById} onAdd={(n) => addBundle(b, n)} />
          ))}
        </div>
      )}
      {searchHits.length > 0 ? (
        grid(searchHits)
      ) : shownBundles.length === 0 ? (
        <p className="text-sm text-muted text-center py-10">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
      ) : null}
    </>
  ) : category === PACKS ? (
    <div className="space-y-2">
      {shownBundles.map((b) => (
        <BundleCard key={b.id} bundle={b} partsById={partsById} onAdd={(n) => addBundle(b, n)} />
      ))}
    </div>
  ) : category ? (
    inCategory.length ? grid(inCategory) : <p className="text-sm text-muted text-center py-10">No parts here for these types.</p>
  ) : categories.length || shownBundles.length ? (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2.5">
      {shownBundles.length > 0 && (
        <CategoryTile
          name="Part packs"
          count={shownBundles.length}
          photo={shownBundles.find((b) => b.photoPath)?.photoPath || null}
          icon
          onOpen={() => setCategory(PACKS)}
        />
      )}
      {categories.map((c) => (
        <CategoryTile key={c.name} name={c.name} count={c.items.length} photo={c.photo} onOpen={() => setCategory(c.name)} />
      ))}
    </div>
  ) : (
    <div className="text-center py-10 space-y-3">
      <p className="text-sm text-muted">
        {catalog.length === 0 ? "No parts catalog loaded." : "Nothing in the catalog is filed under these types."}
      </p>
      {typeMode.kind !== "all" && catalog.length > 0 && (
        <button
          type="button"
          onClick={() => setTypeMode({ kind: "all" })}
          className="px-4 py-2 rounded-full bg-amber-500 text-white text-sm font-semibold"
        >
          Show all types
        </button>
      )}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[65] bg-background flex flex-col break-words" role="dialog" aria-modal="true" aria-label="Parts catalog">
      {/* One scroller holds the header and the grid. The header sticks to the top
          of it — except on a short landscape phone, where it would eat the screen
          and so scrolls away with the parts. */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        {/* Header: back/close, title, the running count, Done. */}
        <div className="sticky top-0 z-10 border-b border-border bg-background pt-[env(safe-area-inset-top)] [@media(max-height:500px)]:static">
          <div className="max-w-5xl mx-auto px-3 pt-1.5 pb-2 space-y-1.5">
            <div className="flex items-center gap-2">
              {category && !q ? (
                <button
                  type="button"
                  onClick={() => setCategory(null)}
                  className="w-10 h-10 -ml-1 shrink-0 flex items-center justify-center rounded-lg hover:bg-surface text-muted"
                  aria-label="Back to categories"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-10 h-10 -ml-1 shrink-0 flex items-center justify-center rounded-lg hover:bg-surface text-muted"
                  aria-label="Close catalog"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
              <h2 className="flex-1 min-w-0 text-base font-semibold truncate">{title}</h2>
              {added > 0 && (
                <span className="shrink-0 text-xs font-semibold text-green-700 bg-green-500/10 border border-green-600/30 rounded-full px-2.5 py-1 tabular-nums">
                  Added {added}
                </span>
              )}
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 min-h-10 px-4 rounded-lg bg-amber-500 text-white text-sm font-bold"
              >
                Done
              </button>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, nickname or part #"
                enterKeyHint="search"
                className="w-full rounded-xl border border-border bg-surface pl-9 pr-11 py-2 text-base focus:outline-none focus:ring-2 focus:ring-amber-400/50"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full text-muted hover:bg-background"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {multiSection && (
              <div className="flex flex-wrap gap-1.5">
                {["All", ...sections].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => pickSection(s)}
                    className={`min-h-10 flex-1 sm:flex-none px-2 sm:px-3 rounded-lg max-sm:text-xs text-sm font-semibold border ${
                      activeSection === s ? "bg-foreground text-background border-foreground" : "bg-background text-muted border-border"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {(typeChips.length > 0 || !matcher.empty) && (
              <ChipArea>
                {!matcher.empty && (
                  <Chip
                    active={typeMode.kind === "units"}
                    onClick={() => {
                      setTypeMode({ kind: "units" });
                      setCategory(null);
                    }}
                  >
                    These units
                  </Chip>
                )}
                <Chip
                  active={typeMode.kind === "all"}
                  onClick={() => {
                    setTypeMode({ kind: "all" });
                    setCategory(null);
                  }}
                >
                  All types
                </Chip>
                {typeChips.map((c) => (
                  <Chip key={c.type} active={c.on} soft onClick={() => toggleType(c.type)}>
                    {c.type}
                  </Chip>
                ))}
              </ChipArea>
            )}
          </div>
        </div>

        <div className="max-w-5xl mx-auto p-3 pb-[max(6rem,calc(env(safe-area-inset-bottom)+4rem))]">{body}</div>
      </div>

      {flash && (
        <div
          className={`pointer-events-none fixed left-1/2 -translate-x-1/2 z-[67] max-w-[calc(100vw-2rem)] ${
            // With a part open its Add bar is at the bottom: the toast goes up
            // under the header instead of over it.
            detail ? "top-[calc(env(safe-area-inset-top)+4rem)]" : "bottom-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))]"
          }`}
        >
          <div className="flex items-center gap-2 rounded-full bg-green-700 text-white text-sm font-semibold px-4 py-2.5 shadow-lg">
            <Check className="w-4 h-4 shrink-0" />
            <span className="truncate">{flash.text}</span>
          </div>
        </div>
      )}

      {detail && (
        <PartDetail
          key={detail.id}
          part={detail}
          onClose={() => setDetailId(null)}
          onAdd={(pick, qty) => {
            addPart(detail, pick, qty);
            setDetailId(null);
          }}
        />
      )}
    </div>,
    document.body
  );
}

/**
 * The product-type chips, wrapped onto as many lines as they need. On a phone
 * they are held to two rows and a bit (they scroll inside that box, and the
 * peeking third row fades out as the cue that there are more) so the header
 * leaves room for the parts — likewise on a short landscape phone. From
 * tablet width up, at a normal height, they all just show.
 */
function ChipArea({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const check = () => {
    const el = box.current;
    if (el) setMore(el.scrollHeight > el.clientHeight + 1 && el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  };
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    // The observer's first callback fires on observe(), so this also measures once.
    const ro = new ResizeObserver(() => {
      const b = box.current;
      if (b) setMore(b.scrollHeight > b.clientHeight + 1 && b.scrollTop + b.clientHeight < b.scrollHeight - 4);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={box}
      onScroll={check}
      className={`overflow-y-auto overscroll-contain max-sm:max-h-[7.25rem] [@media(max-height:500px)]:max-h-[7.25rem] sm:[@media(min-height:501px)]:overflow-visible ${
        more
          ? "max-sm:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)] [@media(max-height:500px)]:[mask-image:linear-gradient(to_bottom,black_calc(100%-1.5rem),transparent)]"
          : ""
      }`}
    >
      <div ref={inner} className="flex flex-wrap gap-1.5">
        {children}
      </div>
    </div>
  );
}

function Chip({
  active,
  soft,
  children,
  onClick,
}: {
  active: boolean;
  /** A product-type chip: lit amber-outline rather than solid when on. */
  soft?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  const on = soft
    ? "bg-amber-500/15 text-amber-700 border-amber-500"
    : "bg-amber-500 text-white border-amber-500";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-10 max-w-full px-3 py-1 rounded-full text-xs font-semibold leading-tight text-left border ${
        active ? on : "bg-background text-muted border-border"
      }`}
    >
      {children}
    </button>
  );
}

/** A catalog photo, or a quiet placeholder when there is none (or it won't load). */
function Photo({ path, alt, className, fit = "cover" }: { path: string | null; alt: string; className: string; fit?: "cover" | "contain" }) {
  const url = catalogPhotoUrl(path);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) {
    return (
      <div className={`${className} flex items-center justify-center bg-surface text-muted`}>
        <ImageOff className="w-6 h-6 opacity-50" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(url)}
      className={`${className} ${fit === "contain" ? "object-contain bg-white" : "object-cover bg-surface"}`}
    />
  );
}

function CategoryTile({
  name,
  count,
  photo,
  icon,
  onOpen,
}: {
  name: string;
  count: number;
  photo: string | null;
  icon?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-xl border border-border bg-background overflow-hidden active:scale-[0.98] transition-transform"
    >
      <div className="relative">
        <Photo path={photo} alt={name} className="w-full aspect-[4/3]" />
        {icon && (
          <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/70 text-white text-xs font-bold uppercase px-2 py-0.5">
            <Layers className="w-3 h-3" /> Packs
          </span>
        )}
      </div>
      <div className="px-2.5 py-2 flex items-start gap-2">
        <span className="flex-1 min-w-0 text-sm font-semibold leading-snug line-clamp-2 break-words">{name}</span>
        <span className="shrink-0 text-xs font-semibold text-muted tabular-nums bg-surface rounded-full px-2 py-0.5">{count}</span>
      </div>
    </button>
  );
}

function PartCard({
  part,
  matchedNumber,
  offType,
  onOpen,
  onQuickAdd,
}: {
  part: PartsCatalogItem;
  matchedNumber?: string;
  offType?: string;
  onOpen: () => void;
  onQuickAdd: () => void;
}) {
  const options = optionCount(part);
  const oneTap = !needsPick(part);
  const single = oneTap ? settleVariant(part, "", "").partNumber : "";
  const price = partPrice(part);
  return (
    <div className="relative rounded-xl border border-border bg-background overflow-hidden">
      <button type="button" onClick={onOpen} className="w-full text-left active:opacity-80">
        <div className="relative">
          <Photo path={part.photoPath} alt={part.partName} className="w-full aspect-square" />
          <PartSourceBadge section={part.section} corner className="!max-w-[calc(100%-3.75rem)]" />
        </div>
        <div className="px-2.5 py-2">
          <div className="text-sm font-semibold leading-snug line-clamp-2">
            {part.partName}
            {part.position && <span className="font-normal text-muted"> · {part.position}</span>}
          </div>
          <div className="text-xs text-muted mt-0.5 truncate">
            {matchedNumber ? (
              <>
                Part # <span className="font-mono text-foreground">{matchedNumber}</span>
              </>
            ) : single ? (
              <span className="font-mono">{single}</span>
            ) : options > 1 ? (
              `${options} options`
            ) : (
              part.category
            )}
            {price != null && <span> · {money(price)}</span>}
          </div>
          {offType && (
            <div className="mt-1 inline-block text-xs font-semibold uppercase tracking-wide text-muted bg-surface border border-border rounded-full px-1.5 py-0.5 max-w-full truncate">
              {offType}
            </div>
          )}
        </div>
      </button>
      {oneTap && (
        <button
          type="button"
          onClick={onQuickAdd}
          className="absolute top-2 right-2 w-10 h-10 rounded-full bg-amber-500 text-white shadow-md flex items-center justify-center active:scale-95"
          aria-label={`Add ${part.partName}`}
        >
          <Plus className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

function BundleCard({
  bundle,
  partsById,
  onAdd,
}: {
  bundle: PartsBundle;
  partsById: Map<string, PartsCatalogItem>;
  onAdd: (count: number) => void;
}) {
  const [count, setCount] = useState(1);
  const price = bundlePrice(bundle, partsById);
  const parts = bundle.members
    .map((m) => partsById.get(m.partId))
    .filter((p): p is PartsCatalogItem => !!p);
  const SHOWN_MEMBERS = 6;
  return (
    <div className="flex gap-3 rounded-xl border border-border bg-background p-2.5">
      <Photo path={bundle.photoPath} alt={bundle.name} className="w-20 h-20 shrink-0 rounded-lg" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold leading-snug break-words">{bundle.name}</div>
        <div className="text-xs text-muted truncate">
          {[
            `${bundle.members.length} part${bundle.members.length === 1 ? "" : "s"}`,
            bundle.productType || null,
            price.total != null ? `${money(price.total * count)}${price.partial ? "+" : ""}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {parts.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted mt-1">
            {parts.slice(0, SHOWN_MEMBERS).map((p, i) => (
              <span key={`${p.id}-${i}`} className="inline-flex items-center gap-1 min-w-0 max-w-full">
                <span className="truncate">{p.partName}</span>
                <PartSourceBadge section={p.section} className="shrink-0" />
              </span>
            ))}
            {parts.length > SHOWN_MEMBERS && <span>+{parts.length - SHOWN_MEMBERS} more</span>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Stepper value={count} onChange={setCount} label={bundle.name} />
          <button
            type="button"
            onClick={() => {
              onAdd(count);
              setCount(1);
            }}
            className="ml-auto min-h-10 px-3.5 rounded-lg bg-amber-500 text-white text-sm font-bold"
          >
            Add pack
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="w-10 h-10 rounded-lg border border-border text-lg text-muted flex items-center justify-center"
        aria-label={`One fewer ${label}`}
      >
        −
      </button>
      <span className="w-8 text-center text-base font-semibold tabular-nums">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="w-10 h-10 rounded-lg border border-border text-lg text-muted flex items-center justify-center"
        aria-label={`One more ${label}`}
      >
        +
      </button>
    </div>
  );
}

/**
 * One part, up close: the photo, what the catalog says about it, and the
 * colour / size pickers. Only combinations that exist are offered: a dimension
 * not yet picked shows only what goes with the other pick, and picking one
 * that doesn't go with it drops the other. The part number appears once the
 * picks leave exactly one.
 */
function PartDetail({
  part,
  onClose,
  onAdd,
}: {
  part: PartsCatalogItem;
  onClose: () => void;
  onAdd: (pick: VariantPick, qty: number) => void;
}) {
  useBackClose(onClose);
  const [pick, setPick] = useState<VariantPick>(() => settleVariant(part, "", ""));
  const [qty, setQty] = useState(1);

  const colors = pick.color ? variantColors(part) : variantColors(part, pick.size);
  const sizes = pick.size ? variantSizes(part) : variantSizes(part, pick.color);
  const description = partDescription(part, pick.partNumber);
  const general = partDetailLines(part, "description");
  const fits = partDetailLines(part, "fits");
  const notes = partDetailLines(part, "notes");
  const price = partPrice(part, pick.color, pick.size);
  const open = (colors.length > 1 && !pick.color) || (sizes.length > 1 && !pick.size);

  const choose = (dim: "color" | "size", value: string) => {
    const same = (dim === "color" ? pick.color : pick.size) === value;
    const next = same ? "" : value;
    setPick(
      dim === "color" ? settleVariant(part, next, pick.size, "color") : settleVariant(part, pick.color, next, "size")
    );
  };

  return (
    <div className="absolute inset-0 z-[66] bg-background flex flex-col" role="dialog" aria-modal="true" aria-label={part.partName}>
      <div className="shrink-0 border-b border-border pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="max-w-3xl mx-auto px-3 py-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 -ml-1 shrink-0 flex items-center justify-center rounded-lg hover:bg-surface text-muted"
            aria-label="Back to parts"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h3 className="flex-1 min-w-0 text-base font-semibold truncate">{part.partName}</h3>
          <PartSourceBadge section={part.section} className="shrink-0" />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="max-w-3xl mx-auto p-3 space-y-4 md:grid md:grid-cols-2 md:gap-5 md:space-y-0">
          <Photo path={part.photoPath} alt={part.partName} fit="contain" className="w-full aspect-square max-h-[42vh] md:max-h-[70vh] rounded-xl border border-border" />

          <div className="space-y-4">
            <div>
              <div className="text-lg font-bold leading-snug">
                {part.partName}
                {part.position && <span className="font-normal text-muted"> · {part.position}</span>}
              </div>
              <div className="text-xs text-muted mt-0.5">
                {[part.category, part.productType, part.section].filter(Boolean).join(" · ")}
              </div>
              {general.map((t, i) => (
                <p key={`d${i}`} className="text-sm mt-2">{t}</p>
              ))}
              {fits.length > 0 && (
                <p className="text-xs text-muted mt-2">
                  <span className="font-semibold text-foreground">Fits:</span> {fits.join("; ")}
                </p>
              )}
              {notes.map((t, i) => (
                <p key={`n${i}`} className="text-xs text-muted mt-1.5">{t}</p>
              ))}
            </div>

            {colors.length > 0 && (colors.length > 1 || sizes.length > 1) && (
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-muted mb-1.5">Colour</div>
                <div className="flex flex-wrap gap-2">
                  {colors.map((c) => {
                    const on = pick.color === c;
                    const hint = choiceHint(part, c, pick.size);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => choose("color", c)}
                        className={`text-left rounded-xl border px-3 py-2 min-h-11 max-w-full break-words ${
                          on ? "border-amber-500 bg-amber-500/15 ring-1 ring-amber-500" : "border-border bg-background"
                        }`}
                      >
                        <span className="block text-sm font-semibold">{c}</span>
                        {hint && <span className="block text-xs text-muted line-clamp-2">{hint}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {sizes.length > 0 && (sizes.length > 1 || colors.length > 1) && (
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-muted mb-1.5">
                  Size{pick.color && !pick.size ? ` in ${pick.color}` : ""}
                </div>
                <div className="flex flex-wrap gap-2">
                  {sizes.map((s) => {
                    const on = pick.size === s;
                    const hint = pick.color ? choiceHint(part, pick.color, s) : undefined;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => choose("size", s)}
                        className={`text-left rounded-xl border px-3 py-2 min-h-11 max-w-full break-words ${
                          on ? "border-amber-500 bg-amber-500/15 ring-1 ring-amber-500" : "border-border bg-background"
                        }`}
                      >
                        <span className="block text-sm font-semibold">{s}</span>
                        {hint && <span className="block text-xs text-muted line-clamp-2">{hint}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
              {pick.partNumber ? (
                <>
                  <div className="text-xs text-muted">
                    Part # <span className="font-mono font-bold text-base text-foreground">{pick.partNumber}</span>
                    {price != null && <span> · {money(price)}</span>}
                  </div>
                  {description && <div className="text-sm mt-1">{description}</div>}
                </>
              ) : open ? (
                <div className="text-sm text-muted">
                  Pick {colors.length > 1 && !pick.color && sizes.length > 1 && !pick.size ? "colour and size" : colors.length > 1 && !pick.color ? "a colour" : "a size"} for
                  the part number — or add it now and pick on the line later.
                </div>
              ) : (
                <div className="text-sm text-muted">No part number in the catalog for this part.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="max-w-3xl mx-auto px-3 py-2 flex items-center gap-3">
          <Stepper value={qty} onChange={setQty} label={part.partName} />
          <button
            type="button"
            onClick={() => onAdd(pick, qty)}
            className="flex-1 min-h-12 py-2 rounded-xl bg-amber-500 text-white text-base font-bold flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            <Plus className="w-5 h-5" /> Add to write-up
          </button>
        </div>
      </div>
    </div>
  );
}
