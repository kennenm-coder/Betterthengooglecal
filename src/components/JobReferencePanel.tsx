"use client";

import { WorkOrder } from "@/lib/types";
import { formatTime, formatDateShort, typeColor, typeTileText } from "@/lib/calendar-utils";
import { shortDay } from "@/lib/format-utils";
import { describeParts } from "@/lib/purchase-orders";
import { useData } from "./DataProvider";
import CopyButton from "./CopyButton";
import ProductSpecs from "./ProductSpecs";
import {
  Calendar,
  Hash,
  MapPin,
  User,
  Users,
  Briefcase,
  BadgeDollarSign,
  Ruler,
  Hammer,
  Wrench,
  Phone,
  Mail,
  Package,
  ClipboardList,
  FileText,
  ExternalLink,
} from "lucide-react";

/**
 * The job, read-only, to sit beside a write-up on a desktop screen.
 *
 * It is the calendar tile's detail rows over again, minus everything that
 * changes anything: no legacy-link editing, no action log, no hammer. The two
 * page links open in a new tab rather than routing, because routing away from
 * here would take a half-finished write-up with it.
 *
 * Shown only by WriteUpModal's split layout — see the `reference` prop there.
 */
export default function JobReferencePanel({ order }: { order: WorkOrder }) {
  const { partsFor, activeWriteUpsAt } = useData();
  const mat = order.materialJob;
  const parts = describeParts(partsFor(order.orderNumber));
  const partsLabel = order.workOrderType === "Service" ? "Parts" : "Product";
  const legacyUrl = order.legacyInstallUrl || null;
  const writeUpRefs =
    order.workOrderType === "Service" ? activeWriteUpsAt(order.address) : [];
  const showWriteUps = writeUpRefs.length > 0;

  const crewDays = (() => {
    const map = order.dayCrews;
    if (!map) return [];
    const entries = Object.entries(map)
      .filter(([, names]) => names && names.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const distinct = new Set(entries.flatMap(([, names]) => names));
    if (distinct.size < 2) return [];
    return entries.map(([date, names]) => ({ date, names }));
  })();

  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    order.address
  )}`;

  return (
    <div className="flex flex-col h-full min-w-0 border-r border-border bg-surface/40">
      {/* Header — mirrors the write-up pane's own header height so the two
          panes line up across the split. */}
      <div className="flex items-start gap-2 px-4 py-3 border-b border-border bg-background shrink-0">
        <div className={`w-1.5 self-stretch rounded-full ${typeColor(order.workOrderType)}`} />
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-tight truncate">
            {order.customerName}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${typeColor(
                order.workOrderType
              )} ${typeTileText(order.workOrderType)}`}
            >
              {order.workOrderType}
            </span>
            <span className="text-xs text-muted">
              {order.appointmentStatus || order.status}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <Row icon={Calendar} label="Scheduled">
          <span>
            {formatDateShort(order.scheduledStart)} {formatTime(order.scheduledStart)}
            {order.scheduledEnd && ` - ${formatTime(order.scheduledEnd)}`}
          </span>
        </Row>

        <Row icon={Hash} label="Order#">
          <span className="font-medium">{order.orderNumber}</span>
          <CopyButton text={order.orderNumber} label="order number" />
          <span className="text-muted mx-1">|</span>
          <span className="text-muted text-xs">WO: {order.workOrderNumber}</span>
          <CopyButton text={order.workOrderNumber} label="work order" />
        </Row>

        <Row icon={MapPin} label="Address">
          <span className="min-w-0">
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline break-words"
            >
              {order.address}
            </a>
            <CopyButton text={order.address} label="address" />
          </span>
        </Row>

        {order.primaryResource && (
          <Row icon={User} label="Primary Resource">
            <span className="font-medium">{order.primaryResource}</span>
          </Row>
        )}
        {crewDays.length > 0 && (
          <Row icon={Users} label="Crews">
            <div className="space-y-0.5">
              {crewDays.map(({ date, names }) => (
                <div key={date} className="flex gap-1.5">
                  <span className="text-muted shrink-0">{shortDay(date)}</span>
                  <span className="font-medium break-words">{names.join(" + ")}</span>
                </div>
              ))}
            </div>
          </Row>
        )}
        {order.orderOwner && (
          <Row icon={Briefcase} label="Owner">
            <span>{order.orderOwner}</span>
          </Row>
        )}
        {order.salesRep && (
          <Row icon={BadgeDollarSign} label="Sales Rep">
            <span>{order.salesRep}</span>
          </Row>
        )}
        {order.techMeasure && order.techMeasure !== order.primaryResource && (
          <Row icon={Ruler} label="Measure Tech">
            <span>{order.techMeasure}</span>
          </Row>
        )}
        {order.installer && order.installer !== order.primaryResource && (
          <Row icon={Hammer} label="Installer">
            <span>{order.installer}</span>
          </Row>
        )}
        {order.serviceRep && order.serviceRep !== order.primaryResource && (
          <Row icon={Wrench} label="Service Tech">
            <span>{order.serviceRep}</span>
          </Row>
        )}
        {order.workOrderType === "Service" && order.serviceDescription && (
          <Row icon={ClipboardList} label="Service Details">
            <span className="text-foreground whitespace-pre-wrap">
              {order.serviceDescription}
            </span>
          </Row>
        )}

        {(order.phones.length > 0 || order.email || order.contactName) && (
          <div className="pt-3 border-t border-border">
            <div className="rounded-lg bg-background border border-border p-3">
              <div className="flex items-center gap-1.5 mb-2 text-muted">
                <User className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Customer Contact
                </span>
              </div>
              {order.contactName && order.contactName !== order.customerName && (
                <p className="text-sm font-semibold break-words mb-2">
                  {order.contactName}
                </p>
              )}
              <div className="space-y-2">
                {order.phones.length > 0 && (
                  <Row icon={Phone} label="Phone">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {order.phones.map((p, i) => (
                        <span key={i} className="inline-flex items-center gap-1">
                          <a
                            href={`tel:${p.number.replace(/[\s\-()]/g, "")}`}
                            className="text-primary underline"
                          >
                            {p.number}
                          </a>
                          <span className="text-xs text-muted">({p.label})</span>
                          <CopyButton text={p.number} label={p.label} />
                        </span>
                      ))}
                    </div>
                  </Row>
                )}
                {order.email && (
                  <Row icon={Mail} label="Email">
                    <span className="min-w-0">
                      <a
                        href={`mailto:${order.email}`}
                        className="text-primary underline break-words"
                      >
                        {order.email}
                      </a>
                      <CopyButton text={order.email} label="email" />
                    </span>
                  </Row>
                )}
              </div>
            </div>
          </div>
        )}

        {parts && (
          <div
            className="pt-3 border-t border-border flex items-center gap-2 text-[15px]"
            title={parts.detail}
          >
            <Package className="w-3.5 h-3.5 text-muted shrink-0" />
            <span className="text-muted">{partsLabel}:</span>
            <span
              className={`px-2 py-0.5 rounded-full text-sm font-medium ${
                parts.stage === "received"
                  ? "bg-emerald-500/10 text-emerald-700 border border-emerald-500/30"
                  : parts.stage === "partial"
                    ? "bg-amber-500/10 text-amber-700 border border-amber-500/30"
                    : parts.stage === "ordered"
                      ? "bg-sky-500/10 text-sky-700 border border-sky-500/30"
                      : "bg-surface text-muted border border-border"
              }`}
            >
              {parts.stage === "received" ? "✓ " : ""}
              {parts.label}
            </span>
          </div>
        )}

        {mat?.job.installNotes?.trim() && (
          <div className="pt-3 border-t border-border">
            <div className="rounded-lg bg-background border border-border p-3">
              <div className="flex items-center gap-1.5 mb-1 text-muted">
                <ClipboardList className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">
                  Install Notes
                </span>
              </div>
              <p className="text-sm text-foreground whitespace-pre-wrap">
                {mat.job.installNotes}
              </p>
            </div>
          </div>
        )}

        {/* Paperwork — new tab, so the write-up in the other pane survives. */}
        {mat && (
          <a
            href={`/install/${mat.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-primary text-white text-sm font-medium"
          >
            <FileText className="w-4 h-4" />
            Install Instructions
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </a>
        )}
        {!mat && legacyUrl && (
          <a
            href={legacyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 text-amber-700 border border-amber-500/30 text-sm font-medium"
          >
            <FileText className="w-4 h-4" />
            Legacy Install Instructions
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </a>
        )}
        {showWriteUps && (
          <a
            href={`/work-orders/address/${encodeURIComponent(order.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-medium"
          >
            <Wrench className="w-4 h-4" />
            Active Write-Ups
            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
          </a>
        )}

        {mat && mat.units.length > 0 && <ProductSpecs units={mat.units} />}
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 text-[15px]">
      <Icon className="w-4 h-4 text-muted mt-0.5 shrink-0" />
      <div className="flex items-center gap-1 flex-wrap min-w-0">
        <span className="text-muted shrink-0">{label}:</span>
        {children}
      </div>
    </div>
  );
}
