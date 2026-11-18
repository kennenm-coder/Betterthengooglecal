"use client";

// The install lead's Job Complete report, opened from an install tile.
// Step 1: pick one of three outcomes. Step 2: that outcome's questions and
// photos. Submitting saves the report, emails the right people, and puts a
// tag on the tile. See migration 058 and src/lib/job-complete.ts.

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ChevronLeft, ImagePlus, Loader2, X } from "lucide-react";
import { useBackClose } from "@/hooks/useBackClose";
import { useAuth } from "@/hooks/useAuth";
import { useData } from "@/components/DataProvider";
import CameraCapture from "@/components/CameraCapture";
import { crewsForDate } from "@/lib/format-utils";
import type { WorkOrder } from "@/lib/types";
import {
  DEFAULT_TEMPLATES,
  OUTCOME_INFO,
  OUTCOME_ORDER,
  fetchMyCompletion,
  loadTemplates,
  missingAnswers,
  photosOf,
  requestCompletionEmail,
  saveCompletion,
  uploadCompletionPhoto,
  type JcAnswers,
  type JcOutcome,
  type JcPhoto,
  type JcQuestion,
  type JcTemplates,
  type JobCompletion,
} from "@/lib/job-complete";

const TONE = {
  green: "border-green-600/40 bg-green-600/10 text-green-800 dark:text-green-300",
  amber: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  red: "border-danger/40 bg-danger/5 text-danger",
} as const;

const INPUT =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

export default function JobCompleteModal({ order, onClose }: { order: WorkOrder; onClose: () => void }) {
  useBackClose(onClose);
  const { user, name } = useAuth();
  const { refreshCompletions } = useData();
  const email = (user?.email || "").toLowerCase();

  const [templates, setTemplates] = useState<JcTemplates>(DEFAULT_TEMPLATES);
  const [existing, setExisting] = useState<JobCompletion | null>(null);
  const [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState<JcOutcome | null>(null);
  const [answers, setAnswers] = useState<JcAnswers>({});
  const [uploading, setUploading] = useState(0);
  const [camera, setCamera] = useState<string | null>(null); // question id being photographed
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ flagged: boolean; emailError?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileFor = useRef<string>("");

  useEffect(() => {
    let live = true;
    (async () => {
      const [t, mine] = await Promise.all([
        loadTemplates(),
        email ? fetchMyCompletion(order.orderNumber, email).catch(() => null) : Promise.resolve(null),
      ]);
      if (!live) return;
      setTemplates(t);
      if (mine) {
        setExisting(mine);
        setOutcome(mine.outcome);
        setAnswers(mine.answers);
      }
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [order.orderNumber, email]);

  // When editing a report and keeping its outcome, keep the questions it was
  // filled in with; a changed outcome gets the current questions.
  const questions: JcQuestion[] = useMemo(() => {
    if (!outcome) return [];
    if (existing && existing.outcome === outcome && existing.template.length > 0) return existing.template;
    return templates[outcome];
  }, [outcome, existing, templates]);

  const crew = useMemo(() => {
    const day = order.scheduledStart ? order.scheduledStart.slice(0, 10) : null;
    const names = crewsForDate(order, day);
    return names.length ? names.join(" + ") : order.primaryResource || null;
  }, [order]);

  function setAnswer(id: string, value: string) {
    setAnswers((a) => ({ ...a, [id]: value }));
  }

  async function addPhotos(qid: string, files: File[]) {
    if (files.length === 0) return;
    setError("");
    setUploading((n) => n + files.length);
    const added: JcPhoto[] = [];
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const p = await uploadCompletionPhoto(order.orderNumber, files[i], Date.now() + i).catch(() => null);
      if (p) added.push(p);
      else failed++;
    }
    setUploading((n) => n - files.length);
    if (added.length) setAnswers((a) => ({ ...a, [qid]: [...photosOf(a[qid]), ...added] }));
    if (failed) setError(`${failed} photo${failed === 1 ? "" : "s"} didn't upload — check your signal and add ${failed === 1 ? "it" : "them"} again.`);
  }

  function removePhoto(qid: string, path: string) {
    setAnswers((a) => ({ ...a, [qid]: photosOf(a[qid]).filter((p) => p.path !== path) }));
  }

  async function submit() {
    if (!outcome) return;
    const missing = missingAnswers(questions, answers);
    if (missing.length) {
      setError(`Still needed: ${missing.join("; ")}.`);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await saveCompletion({
        order,
        crew,
        outcome,
        template: questions,
        answers,
        byName: name || email.split("@")[0] || null,
        existingId: existing?.id ?? null,
      });
      const mail = await requestCompletionEmail(saved.id);
      await refreshCompletions();
      setDone({ flagged: saved.flagged, emailError: mail.ok ? undefined : mail.error });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  const close = () => !saving && onClose();

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={(e) => {
        // Only a tap on the dim backdrop itself closes it.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="bg-background w-full sm:max-w-lg max-h-[92dvh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-3 border-b border-border">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">Job complete</p>
            <p className="text-xs text-muted truncate">
              {order.customerName} · #{order.orderNumber}
            </p>
            {order.address && <p className="text-xs text-muted truncate">{order.address}</p>}
          </div>
          <button type="button" onClick={close} className="p-1 -m-1 text-muted" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : done ? (
            <div className="text-center py-6 space-y-3">
              <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto" />
              <p className="text-base font-semibold">Submitted</p>
              <p className="text-sm text-muted">
                {done.flagged
                  ? "The office has been flagged to look at this one."
                  : "Thanks — this job is marked complete."}
              </p>
              {done.emailError && (
                <p className="text-xs text-amber-700 flex items-start gap-1 justify-center text-left">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Your report is saved, but the email to the office didn&apos;t send ({done.emailError}). They&apos;ll still see it in the app.
                </p>
              )}
              <button
                type="button"
                onClick={onClose}
                className="mt-2 px-6 py-3 rounded-xl bg-primary text-white text-sm font-semibold"
              >
                Done
              </button>
            </div>
          ) : !outcome ? (
            <div className="space-y-2.5">
              <p className="text-sm text-muted">How did it go?</p>
              {OUTCOME_ORDER.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOutcome(o)}
                  className={`w-full text-left rounded-xl border-2 px-4 py-3 active:scale-[0.99] transition-transform ${TONE[OUTCOME_INFO[o].tone]}`}
                >
                  <span className="block text-base font-semibold">{OUTCOME_INFO[o].label}</span>
                  <span className="block text-xs opacity-80 mt-0.5">{OUTCOME_INFO[o].detail}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-5">
              <div className={`rounded-xl border-2 px-3 py-2 flex items-center justify-between gap-2 ${TONE[OUTCOME_INFO[outcome].tone]}`}>
                <span className="text-sm font-semibold">{OUTCOME_INFO[outcome].label}</span>
                <button
                  type="button"
                  onClick={() => setOutcome(null)}
                  className="text-xs underline flex items-center gap-0.5 shrink-0"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Change
                </button>
              </div>

              {questions.map((q) => (
                <div key={q.id}>
                  <p className="text-sm font-medium leading-snug">
                    {q.title}
                    {q.required && <span className="text-danger"> *</span>}
                  </p>
                  {q.help && <p className="text-xs text-muted mt-0.5">{q.help}</p>}
                  <div className="mt-1.5">
                    {q.type === "yesno" && (
                      <div className="flex gap-2">
                        {(["yes", "no"] as const).map((v) => {
                          const on = answers[q.id] === v;
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setAnswer(q.id, v)}
                              className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-semibold transition-colors ${
                                on
                                  ? v === "yes"
                                    ? "bg-green-600 border-green-600 text-white"
                                    : "bg-danger border-danger text-white"
                                  : "border-border bg-surface text-muted"
                              }`}
                            >
                              {v === "yes" ? "Yes" : "No"}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {q.type === "text" && (
                      <input className={INPUT} value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""} onChange={(e) => setAnswer(q.id, e.target.value)} />
                    )}
                    {q.type === "number" && (
                      <input
                        className={INPUT}
                        inputMode="decimal"
                        value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
                        onChange={(e) => setAnswer(q.id, e.target.value)}
                      />
                    )}
                    {q.type === "longtext" && (
                      <textarea
                        className={INPUT}
                        rows={3}
                        value={typeof answers[q.id] === "string" ? (answers[q.id] as string) : ""}
                        onChange={(e) => setAnswer(q.id, e.target.value)}
                      />
                    )}
                    {q.type === "select" && (
                      <div className="flex flex-wrap gap-1.5">
                        {(q.options || []).map((o) => (
                          <button
                            key={o}
                            type="button"
                            onClick={() => setAnswer(q.id, o)}
                            className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                              answers[q.id] === o ? "bg-primary border-primary text-white" : "border-border bg-surface text-muted"
                            }`}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    )}
                    {q.type === "photo" && (
                      <div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setCamera(q.id)}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-primary/40 bg-primary/10 text-primary text-sm font-medium"
                          >
                            <Camera className="w-4 h-4" /> Take photos
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              fileFor.current = q.id;
                              fileRef.current?.click();
                            }}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-border bg-surface text-muted text-sm font-medium"
                          >
                            <ImagePlus className="w-4 h-4" /> From phone
                          </button>
                        </div>
                        <p className="text-xs text-muted mt-1.5">
                          {photosOf(answers[q.id]).length} added
                          {q.required && (q.minPhotos ?? 1) > 1 ? ` · at least ${q.minPhotos} needed` : ""}
                          {uploading > 0 && " · uploading…"}
                        </p>
                        {photosOf(answers[q.id]).length > 0 && (
                          <ul className="mt-1.5 space-y-1">
                            {photosOf(answers[q.id]).map((p, i) => (
                              <li key={p.path} className="flex items-center justify-between text-xs rounded-md bg-surface border border-border px-2 py-1">
                                <span>Photo {i + 1}</span>
                                <button type="button" onClick={() => removePhoto(q.id, p.path)} className="text-danger p-0.5" aria-label={`Remove photo ${i + 1}`}>
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading && !done && outcome && (
          <div className="px-4 pt-3 pb-5 border-t border-border">
            {error && (
              <p className="text-xs text-danger mb-2 flex items-start gap-1">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={saving || uploading > 0}
              onClick={submit}
              className="w-full py-3 rounded-xl bg-primary text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {(saving || uploading > 0) && <Loader2 className="w-4 h-4 animate-spin" />}
              {uploading > 0 ? "Uploading photos…" : saving ? "Submitting…" : existing ? "Update report" : "Submit"}
            </button>
          </div>
        )}
      </div>
    </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = "";
          if (fileFor.current) addPhotos(fileFor.current, files);
        }}
      />
      {camera && (
        <CameraCapture
          onDone={(files) => {
            const qid = camera;
            setCamera(null);
            addPhotos(qid, files);
          }}
          onClose={() => setCamera(null)}
        />
      )}
    </>
  );
}
