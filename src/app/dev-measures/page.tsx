"use client";

// DEV-ONLY look at the Measures screen with fixture data — no login, no database.
// Renders nothing in production (NODE_ENV is "production" on Vercel), and the
// middleware only exempts /dev-* from auth in development — so this is inert and
// unreachable in production.
//
// Every name is "ZZ DEMO ...". Dates are built from today, so each group is always
// populated. Open /dev-measures on a phone-sized window; it runs the same
// filter -> group -> card pipeline the real screen does (app/measures/page.tsx).

import { useState } from "react";
import MeasureAppointmentCard from "@/components/MeasureAppointmentCard";
import {
  dayKey,
  filterAssignedTo,
  groupMeasureAppointments,
  MEASURE_GROUP_LABELS,
  toMeasureAppointment,
  type MeasureRow,
} from "@/lib/measure-appointments";

const ME = "ZZ DEMO Tech One";

function fixtures(today: Date): MeasureRow[] {
  const at = (offsetDays: number, time: string) =>
    `${dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays))}T${time}`;
  const row = (
    n: number,
    offsetDays: number | null,
    time: string,
    over: Partial<MeasureRow> = {}
  ): MeasureRow => ({
    id: `ZZ-WO-${n}`,
    order_number: `ZZ-${1000 + n}`,
    work_order_number: `ZZ-WO-${n}`,
    customer_name: `ZZ DEMO, Customer ${n}`,
    address: `${n} ZZ Demo Street, Nowhere, OH 43000`,
    appointment_status: "Scheduled & Assigned",
    status: "",
    scheduled_start: offsetDays === null ? null : at(offsetDays, time),
    tech_measure: ME,
    primary_resource: "",
    ...over,
  });
  return [
    row(1, 0, "08:00:00"),
    row(2, 0, "13:30:00", { appointment_status: "Appt Complete / Closed" }),
    row(3, 1, "09:00:00"),
    row(4, 3, "10:30:00", { tech_measure: "", primary_resource: ME }),
    row(5, 9, "08:00:00"),
    row(6, -2, "08:00:00"),
    row(7, -6, "11:00:00"),
    row(8, -1, "08:00:00", { appointment_status: "Appt Complete / Closed" }), // closed: left off
    row(9, 2, "08:00:00", { appointment_status: "Cancelled" }), // cancelled: left off
    row(10, null, "", { appointment_status: "To be Scheduled" }),
    row(11, 0, "09:00:00", { tech_measure: "ZZ DEMO Tech Two", address: "" }), // someone else's
    row(12, 4, "14:00:00", { tech_measure: "ZZ DEMO Tech Two" }), // someone else's
  ];
}

export default function DevMeasures() {
  const [now] = useState(() => new Date());
  const [everyone, setEveryone] = useState(false);
  const [withTools, setWithTools] = useState(true);
  if (process.env.NODE_ENV !== "development") return null;

  const all = fixtures(now).map(toMeasureAppointment);
  const shown = everyone ? all : filterAssignedTo(all, ME);
  const groups = groupMeasureAppointments(shown, now);

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      <div className="rounded-lg border border-border bg-surface p-3 text-sm space-y-2">
        <p className="font-semibold">Measures screen — fixture data (ZZ DEMO)</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} />
          Everyone (admin view) — off = only &ldquo;{ME}&rdquo;
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={withTools} onChange={(e) => setWithTools(e.target.checked)} />
          Measure Tools link configured
        </label>
      </div>

      {groups.map((g) => (
        <section key={g.key}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
            {MEASURE_GROUP_LABELS[g.key]} ({g.items.length})
          </h2>
          <ul className="space-y-2">
            {g.items.map((a) => (
              <MeasureAppointmentCard
                key={a.id}
                appointment={a}
                group={g.key}
                now={now}
                showTech={everyone}
                toolsUrl={withTools ? "https://measure.example.test/" : null}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
