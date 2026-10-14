"use client";

// Type-ahead multi-select for crew names. Used on the write-up form and on the
// expanded Write-Ups tile to tag which crews could do a write-up's work.
//
// Suggestions come from every crew name on the jobs this device already has
// cached (the scheduling roster itself is not readable by field logins), and
// anything typed that isn't on that list can be added as-is — a sub, a new
// hire, or a crew that hasn't had a job in the cached window yet.
//
// Built for people who don't live in software: tapping the box shows names
// right away, tapping a name adds it as a pill, the × on a pill removes it.

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { allCrewNames } from "@/lib/format-utils";
import { loadBoundedCache } from "@/lib/store";

/** Crew names known to this device, from its cached calendar jobs. */
export function useKnownCrews(): string[] {
  // Read once on first render. The picker only ever mounts after a tap, so
  // there is no server render to disagree with.
  const [crews] = useState<string[]>(() => {
    try {
      return allCrewNames(loadBoundedCache());
    } catch {
      return [];
    }
  });
  return crews;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

const MAX_SUGGESTIONS = 8;

export default function CrewPicker({
  value,
  onChange,
  options,
  placeholder = "Tap here and start typing a name…",
  autoFocus = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Known crew names to suggest from. Defaults to this device's cached jobs. */
  options?: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const known = useKnownCrews();
  const pool = options ?? known;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const chosen = useMemo(() => new Set(value.map(norm)), [value]);
  const q = norm(query);

  // Names matching what's typed, minus the ones already picked. Prefix matches
  // first so "ti" lands on "Tim …" before "Martin …". With nothing typed yet,
  // the first few names show so a tap on the box already offers something.
  const matches = useMemo(() => {
    const starts: string[] = [];
    const contains: string[] = [];
    for (const name of pool) {
      const n = norm(name);
      if (chosen.has(n)) continue;
      if (!q || n.startsWith(q)) starts.push(name);
      else if (n.includes(q)) contains.push(name);
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [pool, chosen, q]);

  // Offer the typed text itself when it isn't already a known name or a pick.
  const customOption = useMemo(() => {
    const t = query.trim();
    if (!t) return null;
    if (chosen.has(q)) return null;
    if (pool.some((p) => norm(p) === q)) return null;
    return t;
  }, [query, q, chosen, pool]);

  const rows: { label: string; name: string; custom: boolean }[] = [
    ...matches.map((m) => ({ label: m, name: m, custom: false })),
    ...(customOption ? [{ label: `Add “${customOption}” as a new name`, name: customOption, custom: true }] : []),
  ];

  // Tap outside closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  function add(name: string) {
    const t = name.trim();
    if (!t || chosen.has(norm(t))) {
      setQuery("");
      return;
    }
    onChange([...value, t]);
    setQuery("");
    setOpen(true);
  }

  function remove(name: string) {
    onChange(value.filter((v) => v !== name));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter with nothing typed shouldn't grab a random name off the list.
      if (!query.trim()) return;
      const row = rows[active] ?? rows[0];
      if (row) add(row.name);
    } else if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp" && rows.length) {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !query && value.length) {
      remove(value[value.length - 1]);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-amber-400/50">
        {value.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 pl-2.5 pr-1 py-1 text-sm font-semibold"
          >
            {name}
            <button
              type="button"
              onClick={() => remove(name)}
              className="rounded-full p-1 hover:bg-amber-500/25"
              aria-label={`Remove ${name}`}
              title="Remove"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={value.length ? "Add another name…" : placeholder}
          autoComplete="off"
          autoCapitalize="words"
          enterKeyHint="done"
          className="flex-1 min-w-[9rem] bg-transparent px-1 py-1.5 text-base focus:outline-none"
        />
      </div>
      {open && rows.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-background shadow-lg"
        >
          {rows.map((row, i) => (
            <li key={`${row.custom ? "custom:" : ""}${row.name}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                // mousedown so the pick lands before the input blurs
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(row.name);
                }}
                onMouseEnter={() => setActive(i)}
                className={`w-full text-left px-3 py-3 text-base ${
                  i === active ? "bg-amber-500/15" : ""
                } ${row.custom ? "text-muted italic" : ""}`}
              >
                {row.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What a picked list of crews means. Only matters once there are two or more. */
export interface CrewAssignment {
  crews: string[];
  /** true = send all of them together (a lead plus helpers); false = any one. */
  allNeeded: boolean;
}

/**
 * The full "who could do this" field: the picker plus, once two or more names
 * are in, a plain two-button question — does the job need just one of them,
 * or all of them together?
 */
export function CrewAssignmentField({
  value,
  onChange,
  autoFocus = false,
}: {
  value: CrewAssignment;
  onChange: (next: CrewAssignment) => void;
  autoFocus?: boolean;
}) {
  const several = value.crews.length >= 2;
  return (
    <div className="space-y-2">
      <CrewPicker value={value.crews} onChange={(crews) => onChange({ ...value, crews })} autoFocus={autoFocus} />
      <p className="text-[11px] text-muted">
        Tap a name to add it. Add as many as you like. Can&apos;t find someone? Type their name and tap
        &ldquo;Add&rdquo;.
      </p>
      {several && (
        <div>
          <div className="text-xs font-semibold mb-1">Does this job need just one of them, or all of them?</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChange({ ...value, allNeeded: false })}
              className={`rounded-lg border px-3 py-2.5 text-sm text-left transition-colors ${
                !value.allNeeded
                  ? "bg-amber-500 text-white border-amber-500"
                  : "border-border text-muted hover:border-amber-400/60"
              }`}
            >
              <div className="font-semibold">Just one of them</div>
              <div className={`text-[11px] ${!value.allNeeded ? "text-white/85" : "text-muted"}`}>
                Any of these crews can take it
              </div>
            </button>
            <button
              type="button"
              onClick={() => onChange({ ...value, allNeeded: true })}
              className={`rounded-lg border px-3 py-2.5 text-sm text-left transition-colors ${
                value.allNeeded
                  ? "bg-amber-500 text-white border-amber-500"
                  : "border-border text-muted hover:border-amber-400/60"
              }`}
            >
              <div className="font-semibold">All of them together</div>
              <div className={`text-[11px] ${value.allNeeded ? "text-white/85" : "text-muted"}`}>
                Send everyone listed to the job
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One line for the tile: "Any one of: A, B" or "All together: A + B". */
export function crewAssignmentSummary(a: CrewAssignment): string {
  if (a.crews.length === 0) return "";
  if (a.crews.length === 1) return a.crews[0];
  return a.allNeeded ? `All together: ${a.crews.join(" + ")}` : `Any one of: ${a.crews.join(", ")}`;
}
