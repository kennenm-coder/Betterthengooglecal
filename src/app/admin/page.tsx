"use client";

import { useState, useRef } from "react";
import { useData } from "@/components/DataProvider";
import { parseXlsHtml } from "@/lib/parse-xls";
import { parseCsv } from "@/lib/parse-csv";
import { upsertWorkOrders } from "@/lib/store";
import BottomNav from "@/components/BottomNav";
import { Upload, CheckCircle, AlertCircle, FileSpreadsheet, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";

export default function AdminPage() {
  const { orders, lastUpdated, refresh, setOrdersLocal } = useData();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setResult(null);

    try {
      const text = await file.text();
      let parsed = parseXlsHtml(text);
      if (parsed.length === 0) {
        parsed = parseCsv(text);
      }

      if (parsed.length === 0) {
        setResult({ success: false, message: "No orders found in file." });
        setUploading(false);
        return;
      }

      // Save to localStorage immediately as fallback
      setOrdersLocal(parsed);

      // Upsert to Supabase work_orders table
      const supaOk = await upsertWorkOrders(parsed);

      if (supaOk) {
        // Refresh to pull enriched data (with material links)
        await refresh();
        setResult({
          success: true,
          message: `Uploaded ${parsed.length} orders to cloud. Material data will link automatically.`,
        });
      } else {
        setResult({
          success: true,
          message: `Loaded ${parsed.length} orders locally. (Cloud sync unavailable — data is on this device only.)`,
        });
      }
    } catch {
      // Full fallback to client-side parsing
      try {
        const text = await file.text();
        let parsed = parseXlsHtml(text);
        if (parsed.length === 0) parsed = parseCsv(text);
        if (parsed.length > 0) {
          setOrdersLocal(parsed);
          setResult({
            success: true,
            message: `Loaded ${parsed.length} orders locally. (Offline mode — data is on this device only.)`,
          });
        } else {
          setResult({ success: false, message: "Could not parse the file." });
        }
      } catch {
        setResult({ success: false, message: "Failed to read file." });
      }
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  return (
    <div className="flex flex-col h-full">
      <header className="bg-background border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Data Upload</h1>
        <p className="text-sm text-muted">
          Upload the daily .xls report to update all job data
        </p>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status */}
        <div className="rounded-lg border border-border p-4 bg-surface">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-8 h-8 text-primary" />
            <div>
              <p className="font-medium">{orders.length} orders loaded</p>
              {lastUpdated && (
                <p className="text-sm text-muted">
                  Last updated:{" "}
                  {format(parseISO(lastUpdated), "MMM d, yyyy 'at' h:mm a")}
                </p>
              )}
              {!lastUpdated && (
                <p className="text-sm text-muted">No data uploaded yet</p>
              )}
            </div>
          </div>
        </div>

        {/* Upload zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={`rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-primary bg-primary-light"
              : "border-border hover:border-primary/50 hover:bg-surface"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".xls,.xlsx,.html,.csv"
            onChange={onFileChange}
            className="hidden"
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-sm text-muted">Processing file...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-10 h-10 text-muted" />
              <p className="font-medium">
                Drag & drop your .xls file here
              </p>
              <p className="text-sm text-muted">or tap to browse files</p>
            </div>
          )}
        </div>

        {/* Result message */}
        {result && (
          <div
            className={`rounded-lg border p-4 flex items-start gap-3 ${
              result.success
                ? "border-success/30 bg-success/5"
                : "border-danger/30 bg-danger/5"
            }`}
          >
            {result.success ? (
              <CheckCircle className="w-5 h-5 text-success shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
            )}
            <p className="text-sm">{result.message}</p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
