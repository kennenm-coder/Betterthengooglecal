"use client";

import { useState, useEffect } from "react";
import { WorkOrder, ActionPerson } from "@/lib/types";
import {
  getActionTypes,
  addActionLog,
  getFieldNotesEmail,
  DEFAULT_FIELDNOTES_EMAIL,
} from "@/lib/action-settings";
import { useAuth } from "@/hooks/useAuth";
import { dedupeRecipients } from "@/lib/email-recipients";
import { X, ChevronRight, Phone, FileText, AlertTriangle, Mic, MicOff, Loader2, Send } from "lucide-react";
import { format } from "date-fns";

// ─────────────────────────────────────────────────────────────────────────────
// LINKED FEATURE: this "field notes" email send mirrors the write-up submission
// email in WriteUpModal.tsx. Both send through POST /api/writeups/notify (the
// generic Gmail sender), both show a Sent/Failed state, and both fall back to
// the user's local mail app on failure. If you change the send flow, the
// failure UX, or the fallback here, check whether WriteUpModal.tsx needs the
// same change — and vice versa.
// ─────────────────────────────────────────────────────────────────────────────

function getSalesforceUrl(workOrderNumber: string): string {
  return `https://renewalbyandersen.my.site.com/rForceLEX/s/global-search/${encodeURIComponent(workOrderNumber)}`;
}

export default function ActionModal({
  order,
  onClose,
}: {
  order: WorkOrder;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"type" | "notes">("type");
  const [actionType, setActionType] = useState("");
  const [notes, setNotes] = useState("");
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  const [fieldNotesEmail, setFieldNotesEmail] = useState(DEFAULT_FIELDNOTES_EMAIL);
  const [listening, setListening] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);
  const { user, autoCc } = useAuth();
  const [sending, setSending] = useState(false);
  // Set when the action was logged but its email didn't send — holds everything
  // needed to resend (or fall back to the local mail app) without re-logging.
  const [emailFailed, setEmailFailed] = useState<{
    to: string[];
    cc: string[];
    subject: string;
    body: string;
  } | null>(null);

  const person: ActionPerson | null = user
    ? { name: (user.user_metadata?.full_name as string) || user.email || "Unknown", email: user.email || "" }
    : null;

  useEffect(() => {
    getActionTypes().then(setActionTypes);
    getFieldNotesEmail().then(setFieldNotesEmail);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";
      r.onresult = (e: any) => {
        let transcript = "";
        for (let i = 0; i < e.results.length; i++) {
          transcript += e.results[i][0].transcript;
        }
        setNotes(transcript);
      };
      r.onerror = () => setListening(false);
      r.onend = () => setListening(false);
      setRecognition(r);
    }
  }, []);

  function toggleVoice() {
    if (!recognition) return;
    if (listening) {
      recognition.stop();
      setListening(false);
    } else {
      recognition.start();
      setListening(true);
    }
  }

  function selectType(type: string) {
    setActionType(type);
    setStep("notes");
  }

  async function submit() {
    if (!person || !actionType) return;

    const now = new Date();
    const timestamp = format(now, "MM/dd/yyyy h:mm a");
    const sfUrl = getSalesforceUrl(order.workOrderNumber);

    const subject = `${actionType} ${timestamp} - ${order.customerName} - ${order.orderNumber} - ${order.workOrderType} - ${order.workOrderNumber}`;

    const body = [
      notes,
      "",
      `Timestamp: ${timestamp}`,
      "",
      `Homeowner Address: ${order.address}`,
      "",
      `Salesforce Link: ${sfUrl}`,
    ].join("\n");

    // Email goes to the field-notes inbox + the person logging it. Dedupe so an
    // address on both the To list and the user's auto-CC isn't on both lines.
    const { to, cc } = dedupeRecipients(
      [person.email, fieldNotesEmail || DEFAULT_FIELDNOTES_EMAIL].filter(Boolean),
      autoCc
    );

    // Log the action regardless of whether the email sends — the log is the record.
    addActionLog({
      id: crypto.randomUUID(),
      timestamp: now.toISOString(),
      actionType,
      person,
      notes,
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      workOrderNumber: order.workOrderNumber,
      workOrderType: order.workOrderType,
      address: order.address,
    });

    setSending(true);
    const sent = await sendFieldNoteEmail(to, cc, subject, body);
    setSending(false);
    if (sent.ok) {
      onClose();
    } else {
      // Keep the modal open on a resend prompt so the email isn't silently lost.
      setEmailFailed({ to, cc, subject, body });
    }
  }

  /** POST the field note to the server (generic Gmail sender). Mirrors
   *  sendWriteUpNotify() in WriteUpModal.tsx — see the LINKED FEATURE note above. */
  async function sendFieldNoteEmail(
    to: string[],
    cc: string[],
    subject: string,
    body: string
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch("/api/writeups/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, cc, subject, body }),
      });
      if (res.ok) return { ok: true };
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: (data as { error?: string })?.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }

  async function resendFieldNote() {
    if (!emailFailed) return;
    setSending(true);
    const sent = await sendFieldNoteEmail(
      emailFailed.to,
      emailFailed.cc,
      emailFailed.subject,
      emailFailed.body
    );
    setSending(false);
    if (sent.ok) {
      setEmailFailed(null);
      onClose();
    }
  }

  /** Safety-net fallback (e.g. the Gmail daily cap is hit): open the user's own
   *  mail app with the same message pre-filled — the original pre-Gmail path. */
  function resendViaLocalMail() {
    if (!emailFailed) return;
    const { to, cc, subject, body } = emailFailed;
    const ccPart = cc.length ? `&cc=${encodeURIComponent(cc.join(","))}` : "";
    const mailto = `mailto:${to.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
      body
    )}${ccPart}`;
    if (typeof window !== "undefined") window.location.href = mailto;
    setEmailFailed(null);
    onClose();
  }

  const typeIcons: Record<string, React.ReactNode> = {
    Call: <Phone className="w-5 h-5" />,
    Note: <FileText className="w-5 h-5" />,
    "Action Item": <AlertTriangle className="w-5 h-5" />,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Action logged, but its email didn't send */}
      {emailFailed && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6">
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-xs p-5 text-center">
            <AlertTriangle className="w-8 h-8 text-amber-600 mx-auto mb-2" />
            <p className="font-semibold">Logged — but the email didn&apos;t send</p>
            <p className="text-xs text-muted mt-1">
              The action is saved to the log. The email to {emailFailed.to.join(", ")} didn&apos;t go
              through. Resend it now?
            </p>
            <div className="mt-4 space-y-2">
              <button
                onClick={resendFieldNote}
                disabled={sending}
                className="w-full py-3 rounded-xl bg-amber-500 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" /> Resend email
                  </>
                )}
              </button>
              <button
                onClick={resendViaLocalMail}
                disabled={sending}
                className="w-full py-3 rounded-xl border border-border text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <FileText className="w-4 h-4" /> Send from my mail app instead
              </button>
              <button
                onClick={() => {
                  setEmailFailed(null);
                  onClose();
                }}
                disabled={sending}
                className="w-full py-3 rounded-xl text-sm font-medium text-muted disabled:opacity-60"
              >
                Close without sending
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative w-full max-w-md bg-background rounded-t-2xl sm:rounded-2xl animate-slide-up max-h-[85vh] flex flex-col safe-area-bottom">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Log Action</h2>
            <span className="text-xs text-muted px-2 py-0.5 rounded-full bg-surface">
              {order.customerName}
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface">
            <X className="w-5 h-5 text-muted" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted border-b border-border shrink-0">
          <span className={step === "type" ? "text-primary font-semibold" : ""}>Type</span>
          <ChevronRight className="w-3 h-3" />
          <span className={step === "notes" ? "text-primary font-semibold" : ""}>Notes</span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === "type" && (
            <div className="space-y-2">
              <p className="text-sm text-muted mb-3">What type of action?</p>
              {actionTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => selectType(type)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border hover:bg-surface transition-colors text-left"
                >
                  <span className="text-primary">
                    {typeIcons[type] || <FileText className="w-5 h-5" />}
                  </span>
                  <span className="font-medium">{type}</span>
                  <ChevronRight className="w-4 h-4 text-muted ml-auto" />
                </button>
              ))}
            </div>
          )}

          {step === "notes" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted">Add notes for this {actionType.toLowerCase()}</p>
                <button
                  onClick={() => setStep("type")}
                  className="text-xs text-primary font-medium"
                >
                  Back
                </button>
              </div>

              {/* Summary */}
              <div className="rounded-lg bg-surface p-3 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-muted">Type:</span>
                  <span className="font-medium">{actionType}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted">Logged by:</span>
                  <span className="font-medium">{person?.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted">Job:</span>
                  <span className="font-medium">{order.customerName} - #{order.workOrderNumber}</span>
                </div>
              </div>

              {/* Notes input */}
              <div className="relative">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Type your notes here..."
                  rows={5}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
                />
                {recognition && (
                  <button
                    onClick={toggleVoice}
                    className={`absolute bottom-3 right-3 p-2 rounded-full transition-colors ${
                      listening
                        ? "bg-danger text-white"
                        : "bg-surface text-muted hover:text-primary"
                    }`}
                    title={listening ? "Stop recording" : "Start voice input"}
                  >
                    {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {/* Submit */}
              <button
                onClick={submit}
                disabled={!notes.trim() || sending}
                className="w-full py-3 rounded-lg bg-primary text-white font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" /> Send
                  </>
                )}
              </button>
              <p className="text-xs text-muted text-center">
                Logs the action and emails it automatically — no need to open your mail app.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
