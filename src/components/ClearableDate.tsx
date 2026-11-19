"use client";

// A date field with a Clear button. Phone date pickers have no way to blank a
// date once it is set, so the From / To filters on the More for More screens
// use this: the small x appears whenever a date is chosen and empties it.

import { X } from "lucide-react";

export default function ClearableDate({
  value,
  onChange,
  min,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  /** Classes for the input itself (border, padding, text size). */
  className?: string;
}) {
  return (
    <div className="relative flex items-center">
      <input
        type="date"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${className} ${value ? "pr-7" : ""}`}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear date"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-surface hover:bg-border"
        >
          <X className="w-3.5 h-3.5 text-muted" />
        </button>
      )}
    </div>
  );
}
