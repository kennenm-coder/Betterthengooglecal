"use client";

import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";

export default function PinModal({
  onSuccess,
  onClose,
}: {
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit() {
    const correct = process.env.NEXT_PUBLIC_TIMEOFF_PIN || "1234";
    if (pin === correct) {
      onSuccess();
    } else {
      setError(true);
      setPin("");
      inputRef.current?.focus();
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-background rounded-xl shadow-xl w-full max-w-xs p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Enter PIN</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-surface">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-muted">Enter your PIN code to manage time off requests.</p>

        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          value={pin}
          onChange={(e) => {
            setError(false);
            setPin(e.target.value.replace(/\D/g, ""));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
          }}
          placeholder="••••"
          className={`w-full text-center text-2xl tracking-[0.5em] border rounded-lg px-4 py-3 bg-surface focus:outline-none focus:ring-2 ${
            error
              ? "border-danger focus:ring-danger"
              : "border-border focus:ring-rba-green"
          }`}
        />

        {error && (
          <p className="text-sm text-danger text-center">Incorrect PIN. Try again.</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={pin.length === 0}
          className="w-full py-3 rounded-lg text-white font-medium bg-rba-green disabled:opacity-50 active:scale-[0.98] transition-all"
        >
          Unlock
        </button>
      </div>
    </div>
  );
}
