"use client";

import { useSyncExternalStore } from "react";
import { format, parseISO } from "date-fns";
import { ExternalLink, Hash, MapPin, Ruler, User } from "lucide-react";
import { daysAgo, mapsUrl, type MeasureAppointment, type MeasureGroupKey } from "@/lib/measure-appointments";

/** The handset's own maps app where there is one; the web URL for everything else. Mirrors JobCard. */
function nativeMapsHref(address: string): string {
  const encoded = encodeURIComponent(address);
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return `maps:?q=${encoded}`;
  if (/Android/i.test(ua)) return `geo:0,0?q=${encoded}`;
  return mapsUrl(address) ?? "";
}

const noSubscription = () => () => {};

/**
 * Web URL on the server and for hydration, the native deep link once on the
 * phone. Choosing from navigator.userAgent in a plain render would make server
 * and client disagree, and React keeps the server's attribute — so the phone
 * would never get the deep link. useSyncExternalStore is built for exactly this
 * split: it renders the server snapshot while hydrating, then the client one.
 */
function useMapsHref(address: string): string | null {
  const href = useSyncExternalStore(
    noSubscription,
    () => (address.trim() ? nativeMapsHref(address) : ""),
    () => mapsUrl(address) ?? ""
  );
  return href || null;
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  let color = "bg-surface text-muted border border-border";
  if (s.includes("complete") || s.includes("closed")) color = "bg-green-100 text-green-800";
  else if (s.includes("scheduled") || s.includes("assigned")) color = "bg-blue-100 text-blue-800";
  else if (s.includes("progress")) color = "bg-purple-100 text-purple-800";
  return (
    <span className={`inline-block shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}

/** "Wed, Nov 5 · 8:00 AM". The calendar stores local wall-clock, so parseISO's local reading is the right one. */
function whenLabel(a: MeasureAppointment): string {
  if (!a.scheduledStart) return "Not scheduled yet";
  const d = parseISO(a.scheduledStart);
  if (isNaN(d.getTime())) return "Not scheduled yet";
  return `${format(d, "EEE, MMM d")} · ${format(d, "h:mm a")}`;
}

export default function MeasureAppointmentCard({
  appointment: a,
  group,
  now,
  showTech,
  toolsUrl,
}: {
  appointment: MeasureAppointment;
  group: MeasureGroupKey;
  now: Date;
  /** Everyone's view: say whose appointment it is. */
  showTech: boolean;
  /** Where Measure Tools lives; null hides the link. */
  toolsUrl: string | null;
}) {
  const mapsHref = useMapsHref(a.address);
  const ago = group === "overdue" ? daysAgo(a, now) : null;
  const tech = a.techMeasure || a.primaryResource;

  return (
    <li
      className={`rounded-xl border bg-surface p-3 space-y-2 ${
        group === "overdue" ? "border-warning/60" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{whenLabel(a)}</p>
          {ago !== null && ago > 0 && (
            <p className="text-xs text-danger font-medium">
              {ago === 1 ? "Yesterday" : `${ago} days ago`} — still open
            </p>
          )}
        </div>
        {a.appointmentStatus && <StatusPill status={a.appointmentStatus} />}
      </div>

      <p className="text-base font-medium break-words">{a.customerName || "No customer name"}</p>

      {a.address ? (
        <a
          href={mapsHref ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start gap-2 min-h-11 -mx-1 px-1 py-1.5 rounded-lg text-sm text-primary active:bg-primary-light"
        >
          <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="break-words underline underline-offset-2">{a.address}</span>
        </a>
      ) : (
        <p className="flex items-start gap-2 text-sm text-muted">
          <MapPin className="w-4 h-4 shrink-0 mt-0.5" />
          No address on file
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {a.orderNumber && (
          <span className="flex items-center gap-1">
            <Hash className="w-3.5 h-3.5" />
            Order {a.orderNumber}
          </span>
        )}
        {a.workOrderNumber && <span>WO {a.workOrderNumber}</span>}
        {showTech && tech && (
          <span className="flex items-center gap-1">
            <User className="w-3.5 h-3.5" />
            {tech}
          </span>
        )}
      </div>

      {toolsUrl && (
        <a
          href={toolsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 min-h-11 rounded-lg border border-border bg-background text-sm font-medium active:bg-primary-light"
        >
          <Ruler className="w-4 h-4" />
          Open in Measure Tools
          <ExternalLink className="w-3.5 h-3.5 text-muted" />
        </a>
      )}
    </li>
  );
}
