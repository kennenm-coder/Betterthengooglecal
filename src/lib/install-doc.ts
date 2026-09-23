import { getSupabase } from "./supabase";
import type { MaterialUnit } from "./types";

// ─── Install-instructions handoff ───────────────────────────────────────────
// The material-list app (nwo-material-list-maker) is the ONLY builder of
// install instructions. Every time a submitted job is saved there it writes
// the finished document to the shared `install_docs` table (migration 023).
// This app just reads that row by job id and renders it — it does not
// re-compute rows from the raw job + catalog anymore, so builder changes never
// have to be mirrored here. Shape is owned by lib/installDoc.js in that repo.

export interface InstallDocRow {
  qty: number;
  unit: string;
  item: string;
  color: string;
  species: string;
  lengths: string;
  vendor: string;
}

export interface InstallDocBoardEntry {
  sig: string;
  unitLabels: string[];
  /** Pre-formatted "1-3, 5" label the report prints. */
  label: string;
}

export interface InstallDocHeader {
  poNumber?: string;
  customerName?: string;
  address?: string;
  techMeasurer?: string;
  date?: string;
  submittedBy?: string;
  submittedAt?: string | null;
  modifiedBy?: string;
  modifiedAt?: string | null;
  trimOrderedBy?: string;
  trimOrderedAt?: string | null;
  installNotes?: string;
  leadPaint?: boolean;
  prefinishNotes?: string;
  pfWindowsNeeded?: boolean;
  pfWindowsList?: string;
  bayMaterials?: unknown[];
}

export interface InstallDoc {
  version: number;
  builtAt: string;
  builtBy: string;
  jobId: string;
  header: InstallDocHeader;
  units: MaterialUnit[];
  globalTrim: Record<string, unknown>;
  nwoRows: InstallDocRow[];
  boardSummary: InstallDocBoardEntry[];
}

export interface InstallDocRecord {
  jobId: string;
  orderNumber: string | null;
  builderVersion: number;
  builtBy: string | null;
  builtAt: string | null;
  updatedAt: string;
  doc: InstallDoc;
}

/** The material-list app prints "--" for an empty cell; show a proper dash. */
export function dash(v: string | null | undefined): string {
  if (!v || v === "--" || v === "—") return "—";
  return v;
}

function isInstallDoc(x: unknown): x is InstallDoc {
  if (!x || typeof x !== "object") return false;
  const d = x as Record<string, unknown>;
  return Array.isArray(d.nwoRows) && Array.isArray(d.units) && typeof d.header === "object" && d.header !== null;
}

/** Fetch one job's handoff document, or null if none has been built yet. */
export async function fetchInstallDoc(jobId: string): Promise<InstallDocRecord | null> {
  const supabase = getSupabase();
  if (!supabase || !jobId) return null;
  const { data, error } = await supabase
    .from("install_docs")
    .select("job_id, order_number, doc, builder_version, built_by, built_at, updated_at")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error || !data || !isInstallDoc(data.doc)) return null;
  const doc = data.doc as InstallDoc;
  return {
    jobId: data.job_id,
    orderNumber: data.order_number ?? null,
    builderVersion: data.builder_version ?? 1,
    builtBy: data.built_by ?? null,
    builtAt: data.built_at ?? null,
    updatedAt: data.updated_at,
    doc: {
      ...doc,
      boardSummary: (doc.boardSummary || []).map((b) => ({
        sig: b.sig || "",
        unitLabels: Array.isArray(b.unitLabels) ? b.unitLabels : [],
        label: b.label || (Array.isArray(b.unitLabels) ? b.unitLabels.join(", ") : ""),
      })),
    },
  };
}
