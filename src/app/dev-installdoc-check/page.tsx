"use client";

// DEV-ONLY acceptance check for the install-instructions handoff. Renders
// nothing in production (NODE_ENV is "production" on Vercel), and the
// middleware only exempts /dev-* from auth in development — so this is inert
// and unreachable in production.
//
// What it does: for every submitted job, builds the NWO rows + board summary
// with THIS app's (soon to be deleted) builder and compares them to the
// document the material-list app wrote to install_docs. Any mismatch is a bug
// in the handoff to fix before the fallback builder is removed.
//
// Run the app locally (npm run dev), sign in, open /dev-installdoc-check.

import { useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { buildNwoRows, buildBoardSummaryByUnit, fetchCatalogAndOffsets } from "@/lib/nwo-builder";
import type { InstallDoc } from "@/lib/install-doc";

type Row = { qty: number; unit: string; item: string; color: string; species: string; lengths: string; vendor: string };

const norm = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "--" || s === "—" ? "" : s;
};
const rowKey = (r: Row) =>
  [r.qty, norm(r.unit), norm(r.item), norm(r.color), norm(r.species), norm(r.lengths), norm(r.vendor)].join("|");

interface Result {
  jobId: string;
  po: string;
  customer: string;
  status: "match" | "mismatch" | "missing-doc";
  detail: string[];
}

export default function DevInstallDocCheck() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");

  if (process.env.NODE_ENV !== "development") return null;

  async function run() {
    setRunning(true);
    setError("");
    setResults([]);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error("no supabase client");
      const catalog = await fetchCatalogAndOffsets();

      // All handoff documents (dev-only; a few MB).
      const docs = new Map<string, InstallDoc>();
      {
        let from = 0;
        const size = 200;
        while (true) {
          const { data, error } = await supabase
            .from("install_docs")
            .select("job_id, doc")
            .order("job_id")
            .range(from, from + size - 1);
          if (error) throw error;
          for (const r of data || []) docs.set(r.job_id, r.doc as InstallDoc);
          if (!data || data.length < size) break;
          from += size;
        }
      }

      const out: Result[] = [];
      let afterId: string | null = null;
      let seen = 0;
      while (true) {
        const { data, error } = await supabase
          .rpc("calendar_jobs", { since: null, after_id: afterId, page_limit: 100 })
          .select("id, data");
        if (error) throw error;
        const rows = (data || []) as { id: string; data: any }[];
        for (const row of rows) {
          const d = row.data;
          if (!d?.submitted) continue;
          seen++;
          setProgress(`checked ${seen} submitted jobs…`);
          const po = d.job?.poNumber || "";
          const customer = d.job?.customerName || "";
          const doc = docs.get(row.id);
          if (!doc) {
            out.push({ jobId: row.id, po, customer, status: "missing-doc", detail: [] });
            continue;
          }
          const mine = buildNwoRows(d.job || {}, d.units || [], catalog.catalog, catalog.offsets) as Row[];
          const theirs = (doc.nwoRows || []) as Row[];
          const detail: string[] = [];
          const a = mine.map(rowKey).sort();
          const b = theirs.map(rowKey).sort();
          if (a.length !== b.length) detail.push(`row count: local ${a.length} vs doc ${b.length}`);
          const bSet = new Set(b);
          const aSet = new Set(a);
          for (const k of a) if (!bSet.has(k)) detail.push(`only local: ${k}`);
          for (const k of b) if (!aSet.has(k)) detail.push(`only doc:   ${k}`);
          // Board summary: compare unit-label groupings and stock counts. The
          // material-list app prints raw profile names in the sig where this
          // app printed catalog display names, so compare labels + the numeric
          // "n@len" tokens only.
          const sigTokens = (s: string) => (s.match(/\d+@\d+'/g) || []).sort().join(" ");
          const mineBs = buildBoardSummaryByUnit(d.job || {}, d.units || [], catalog.catalog, catalog.offsets)
            .map((e) => `${e.unitLabels.join(",")} => ${sigTokens(e.sig)}`)
            .sort();
          const theirBs = (doc.boardSummary || [])
            .map((e) => `${(e.unitLabels || []).join(",")} => ${sigTokens(e.sig)}`)
            .sort();
          if (JSON.stringify(mineBs) !== JSON.stringify(theirBs)) {
            detail.push(`board summary differs:\n  local: ${mineBs.join(" | ")}\n  doc:   ${theirBs.join(" | ")}`);
          }
          out.push({ jobId: row.id, po, customer, status: detail.length ? "mismatch" : "match", detail });
        }
        if (rows.length < 100) break;
        afterId = rows[rows.length - 1].id;
      }
      setResults(out);
      setProgress(`done — ${out.length} submitted jobs checked`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const counts = results.reduce(
    (acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }),
    {} as Record<string, number>
  );

  return (
    <div className="p-4 max-w-4xl mx-auto text-sm">
      <h1 className="text-lg font-bold mb-2">Install-doc handoff check (dev only)</h1>
      <p className="text-muted mb-3">
        Compares this app&apos;s local builder against the material-list app&apos;s install_docs for
        every submitted job. Run after pressing &quot;Rebuild Install Docs&quot; in the material-list app.
      </p>
      <button
        onClick={run}
        disabled={running}
        className="px-3 py-1.5 rounded bg-primary text-white disabled:opacity-50"
      >
        {running ? "Running…" : "Run check"}
      </button>
      <span className="ml-3 text-muted">{progress}</span>
      {error && <div className="mt-3 text-red-600">{error}</div>}
      {results.length > 0 && (
        <div className="mt-4">
          <div className="font-semibold mb-2">
            match: {counts.match || 0} · mismatch: {counts.mismatch || 0} · missing doc: {counts["missing-doc"] || 0}
          </div>
          {results
            .filter((r) => r.status !== "match")
            .map((r) => (
              <div key={r.jobId} className="mb-3 border border-border rounded p-2">
                <div className="font-semibold">
                  {r.status.toUpperCase()} — PO {r.po || "?"} · {r.customer || "?"} · {r.jobId}
                </div>
                {r.detail.map((d, i) => (
                  <pre key={i} className="text-[11px] whitespace-pre-wrap mt-1">{d}</pre>
                ))}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
