"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import {
  DAY_KEYS,
  DAY_LABELS,
  defaultSchedule,
  describeSchedule,
  normalizeSchedule,
  type DayKey,
  type DayMode,
  type Schedule,
} from "@/lib/quiet-hours";

/**
 * When Duck Force may buzz you: per day of the week, buzz any time, set quiet
 * hours, or take the whole day off. One schedule per ACCOUNT, covering every
 * Duck Force buzz (Job Alerts, write-ups, GroupMe messages...). Quiet time only
 * stops the buzz -- the bell still collects everything.
 *
 * Used in two places, both editing the same saved schedule:
 *   - Settings -> Notification Schedule
 *   - the Chat tab's notification menu (top right)
 *
 * `onSaved` hands the new one-line summary back so the caller can show it.
 */

const MODES: { value: DayMode; label: string }[] = [
  { value: "on", label: "On" },
  { value: "quiet", label: "Quiet hours" },
  { value: "off", label: "Off all day" },
];

const WEEKDAYS: DayKey[] = ["tue", "wed", "thu", "fri"];

export default function NotificationScheduleEditor({
  compact = false,
  onSaved,
}: {
  /** Tighter spacing for the Chat tab's pop-down menu. */
  compact?: boolean;
  onSaved?: (summary: string) => void;
}) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        const s = normalizeSchedule(body?.schedule);
        setSchedule(s);
        setSaved(JSON.stringify(s));
      })
      .catch(() => {
        if (cancelled) return;
        const s = defaultSchedule();
        setSchedule(s);
        setSaved(JSON.stringify(s));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(day: DayKey, patch: Partial<Schedule[DayKey]>) {
    setMessage(null);
    setSchedule((prev) => (prev ? { ...prev, [day]: { ...prev[day], ...patch } } : prev));
  }

  function copyMondayToWeekdays() {
    setMessage(null);
    setSchedule((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const d of WEEKDAYS) next[d] = { ...prev.mon };
      return next;
    });
  }

  async function save() {
    if (!schedule) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/notifications/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule,
          // Quiet hours follow the clock on the person's own device.
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Couldn't save.");
      const s = normalizeSchedule(body.schedule);
      setSchedule(s);
      setSaved(JSON.stringify(s));
      setMessage({ ok: true, text: "Saved. This applies to all your Duck Force notifications." });
      onSaved?.(describeSchedule(s));
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (!schedule) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading your schedule…
      </div>
    );
  }

  const dirty = JSON.stringify(schedule) !== saved;

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <p className="text-xs text-muted">
        Pick when Duck Force can buzz your phone. Quiet hours can run overnight (like 9pm to 7am).
        Nothing is lost: everything still shows in the bell.
      </p>

      <ul className="divide-y divide-border rounded-lg border border-border bg-background">
        {DAY_KEYS.map((d) => {
          const day = schedule[d];
          return (
            <li key={d} className={compact ? "px-2.5 py-2" : "px-3 py-2.5"}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium w-24 shrink-0">{DAY_LABELS[d]}</span>
                <div className="flex rounded-lg border border-border overflow-hidden text-xs">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => update(d, { mode: m.value })}
                      aria-pressed={day.mode === m.value}
                      className={`px-2 py-1 whitespace-nowrap ${
                        day.mode === m.value
                          ? m.value === "off"
                            ? "bg-red-500/15 text-red-700 dark:text-red-300 font-semibold"
                            : m.value === "quiet"
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold"
                              : "bg-green-600/15 text-green-700 dark:text-green-300 font-semibold"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              {day.mode === "quiet" && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted pl-1">
                  No buzzes from
                  <input
                    type="time"
                    value={day.from}
                    onChange={(e) => e.target.value && update(d, { from: e.target.value })}
                    className="bg-surface border border-border rounded-md px-1.5 py-1 text-foreground"
                  />
                  to
                  <input
                    type="time"
                    value={day.to}
                    onChange={(e) => e.target.value && update(d, { to: e.target.value })}
                    className="bg-surface border border-border rounded-md px-1.5 py-1 text-foreground"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="inline-flex items-center gap-1.5 bg-primary text-white rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Save schedule
        </button>
        <button
          type="button"
          onClick={copyMondayToWeekdays}
          className="inline-flex items-center gap-1.5 border border-border rounded-lg px-3 py-2 text-sm text-muted hover:text-foreground"
        >
          <Copy className="w-3.5 h-3.5" />
          Copy Monday to Tue–Fri
        </button>
      </div>

      {message && (
        <p className={`text-xs ${message.ok ? "text-green-700 dark:text-green-400" : "text-danger"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
