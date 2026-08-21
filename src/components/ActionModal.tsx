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
import { X, ChevronRight, Phone, FileText, AlertTriangle, Mic, MicOff } from "lucide-react";
import { format } from "date-fns";

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

  function submit() {
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

    const toEmails = [person.email, fieldNotesEmail || DEFAULT_FIELDNOTES_EMAIL].join(",");
    const ccPart = autoCc.length > 0 ? `&cc=${encodeURIComponent(autoCc.join(","))}` : "";
    const mailto = `mailto:${toEmails}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}${ccPart}`;

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

    window.location.href = mailto;
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
                disabled={!notes.trim()}
                className="w-full py-3 rounded-lg bg-primary text-white font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
              >
                Open in Mail App
              </button>
              <p className="text-xs text-muted text-center">
                This will compose the email in your default mail app. You just need to hit send.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
