"use client";

import { WorkOrder, MaterialJobData, MaterialUnit } from "@/lib/types";
import { formatTime, formatDateShort, typeColor } from "@/lib/calendar-utils";
import CopyButton from "./CopyButton";
import {
  Phone,
  Mail,
  MapPin,
  Wrench,
  User,
  Calendar,
  Hash,
  ChevronDown,
  ChevronUp,
  Briefcase,
  ExternalLink,
  Package,
  ClipboardList,
  FileText,
} from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseISO, isSameDay } from "date-fns";

function phoneHref(phone: string): string {
  return "tel:" + phone.replace(/[\s\-\(\)]/g, "");
}

function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function isMultiDay(order: WorkOrder): boolean {
  if (!order.scheduledStart || !order.scheduledEnd) return false;
  return !isSameDay(parseISO(order.scheduledStart), parseISO(order.scheduledEnd));
}

function openSalesforce(workOrderNumber: string) {
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (isMobile) {
    window.location.href = `salesforce1://search/${encodeURIComponent(workOrderNumber)}`;
  } else {
    navigator.clipboard.writeText(workOrderNumber).catch(() => {});
  }
}

function StatusBadge({ status }: { status: string }) {
  let color = "bg-gray-100 text-gray-700";
  const s = status.toLowerCase();
  if (s.includes("complete") || s.includes("closed")) color = "bg-green-100 text-green-800";
  else if (s.includes("scheduled") || s.includes("assigned")) color = "bg-blue-100 text-blue-800";
  else if (s.includes("hold")) color = "bg-yellow-100 text-yellow-800";
  else if (s.includes("progress")) color = "bg-purple-100 text-purple-800";
  else if (s.includes("ordered")) color = "bg-orange-100 text-orange-800";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}

function getExterior(u: MaterialUnit): string {
  return u.exteriorColor || u.summaryExterior || u.extColor || "";
}

function getInterior(u: MaterialUnit): string {
  return u.interiorColor || u.summaryInterior || u.intColor || "";
}

export default function JobCard({
  order,
  compact = false,
}: {
  order: WorkOrder;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const router = useRouter();
  const typeBg = typeColor(order.workOrderType);
  const multiDay = isMultiDay(order);
  const mat = order.materialJob;

  if (compact) {
    return (
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left"
      >
        <div
          className={`rounded-lg border border-border overflow-hidden transition-all ${
            expanded ? "shadow-md" : "shadow-sm"
          }`}
        >
          <div className="flex items-stretch">
            <div className={`w-1.5 ${typeBg} shrink-0`} />
            <div className="flex-1 p-2.5 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">
                  {order.customerName}
                </span>
                <span className="text-xs text-muted whitespace-nowrap">
                  {formatTime(order.scheduledStart)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-muted">{order.workOrderType}</span>
                <span className="text-xs text-muted">#{order.workOrderNumber}</span>
                {mat && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#6DB344]/15 text-[#6DB344] font-semibold">
                    Linked
                  </span>
                )}
                {multiDay && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-light text-primary font-medium">
                    Multi-day
                  </span>
                )}
              </div>
            </div>
          </div>
          {expanded && (
            <div className="px-3 pb-3 border-t border-border" onClick={(e) => e.stopPropagation()}>
              <FullDetails order={order} />
            </div>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden shadow-sm">
      <div className="flex items-stretch">
        <div className={`w-2 ${typeBg} shrink-0`} />
        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-base truncate">
                  {order.customerName}
                </h3>
                <CopyButton text={order.customerName} label="name" />
              </div>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full text-white ${typeBg}`}
                >
                  {order.workOrderType}
                </span>
                <StatusBadge status={order.appointmentStatus || order.status} />
                {multiDay && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary-light text-primary font-medium">
                    Multi-day
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => openSalesforce(order.workOrderNumber)}
                className="p-1 rounded hover:bg-surface"
                title="Open in Salesforce"
              >
                <ExternalLink className="w-4 h-4 text-muted" />
              </button>
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 rounded hover:bg-surface"
              >
                {expanded ? (
                  <ChevronUp className="w-5 h-5 text-muted" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-muted" />
                )}
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            <InfoRow icon={Calendar} label="Scheduled">
              {multiDay ? (
                <span>
                  {formatDateShort(order.scheduledStart)} {formatTime(order.scheduledStart)}
                  {" → "}
                  {formatDateShort(order.scheduledEnd)} {formatTime(order.scheduledEnd)}
                </span>
              ) : (
                <span>
                  {formatDateShort(order.scheduledStart)}{" "}
                  {formatTime(order.scheduledStart)}
                  {order.scheduledEnd && ` - ${formatTime(order.scheduledEnd)}`}
                </span>
              )}
            </InfoRow>

            <InfoRow icon={Hash} label="Order#">
              <span className="font-medium">{order.orderNumber}</span>
              <CopyButton text={order.orderNumber} label="order number" />
              <span className="text-muted mx-1">|</span>
              <span className="text-muted text-xs">WO: {order.workOrderNumber}</span>
              <CopyButton text={order.workOrderNumber} label="work order" />
            </InfoRow>

            <InfoRow icon={MapPin} label="Address">
              <a
                href={mapsHref(order.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline break-words"
              >
                {order.address}
              </a>
              <CopyButton text={order.address} label="address" />
            </InfoRow>

            {order.orderOwner && (
              <InfoRow icon={Briefcase} label="Owner">
                <span>{order.orderOwner}</span>
              </InfoRow>
            )}
            {order.salesRep && (
              <InfoRow icon={User} label="Sales Rep">
                <span>{order.salesRep}</span>
              </InfoRow>
            )}
            {order.techMeasure && (
              <InfoRow icon={User} label="Measure Tech">
                <span>{order.techMeasure}</span>
              </InfoRow>
            )}
            {order.installer && (
              <InfoRow icon={Wrench} label="Installer">
                <span>{order.installer}</span>
              </InfoRow>
            )}
            {order.serviceRep && (
              <InfoRow icon={Wrench} label="Service Tech">
                <span>{order.serviceRep}</span>
              </InfoRow>
            )}

            {order.phones.length > 0 && (
              <InfoRow icon={Phone} label="Phone">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {order.phones.map((p, i) => (
                    <span key={i} className="inline-flex items-center gap-1">
                      <a href={phoneHref(p.number)} className="text-primary underline">
                        {p.number}
                      </a>
                      <span className="text-xs text-muted">({p.label})</span>
                      <CopyButton text={p.number} label={p.label} />
                    </span>
                  ))}
                </div>
              </InfoRow>
            )}

            {order.email && (
              <InfoRow icon={Mail} label="Email">
                <a href={`mailto:${order.email}`} className="text-primary underline break-all">
                  {order.email}
                </a>
                <CopyButton text={order.email} label="email" />
              </InfoRow>
            )}
          </div>

          {expanded && (
            <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-sm">
              <div className="flex items-center gap-2 text-muted">
                <Hash className="w-3.5 h-3.5" />
                <span>Job Status: <span className="text-foreground">{order.status}</span></span>
              </div>
              {order.bookingDate && (
                <div className="flex items-center gap-2 text-muted">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Booked: {formatDateShort(order.bookingDate)}</span>
                </div>
              )}
            </div>
          )}

          {/* Install Notes — always visible when material job is paired */}
          {mat?.job.installNotes?.trim() && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="rounded-lg bg-surface p-3">
                <div className="flex items-center gap-1.5 mb-1 text-muted">
                  <ClipboardList className="w-3.5 h-3.5" />
                  <span className="text-xs font-semibold uppercase tracking-wide">Install Notes</span>
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{mat.job.installNotes}</p>
              </div>
            </div>
          )}

          {/* Open Install Instructions — navigates to full page */}
          {mat && (
            <button
              onClick={() => {
                window.history.replaceState(null, "", `/?order=${order.id}`);
                router.push(`/install/${mat.id}`);
              }}
              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-primary text-white text-sm font-medium active:scale-[0.98] transition-transform"
            >
              <FileText className="w-4 h-4" />
              Open Install Instructions
            </button>
          )}

          {/* Product Specs — collapsible per-unit */}
          {mat && mat.units.length > 0 && <ProductSpecs units={mat.units} />}
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="w-4 h-4 text-muted mt-0.5 shrink-0" />
      <div className="flex items-center gap-1 flex-wrap min-w-0">{children}</div>
    </div>
  );
}

function FullDetails({ order }: { order: WorkOrder }) {
  return (
    <div className="mt-2 pt-2 space-y-1.5 text-sm">
      {order.orderOwner && (
        <DetailLine icon={Briefcase} label="Owner" value={order.orderOwner} />
      )}
      {order.salesRep && (
        <DetailLine icon={User} label="Sales Rep" value={order.salesRep} />
      )}
      {order.techMeasure && (
        <DetailLine icon={User} label="Measure Tech" value={order.techMeasure} />
      )}
      {order.installer && (
        <DetailLine icon={Wrench} label="Installer" value={order.installer} />
      )}
      {order.serviceRep && (
        <DetailLine icon={Wrench} label="Service Tech" value={order.serviceRep} />
      )}
    </div>
  );
}

function DetailLine({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-muted">
      <Icon className="w-3.5 h-3.5" />
      <span>
        {label}: <span className="text-foreground">{value}</span>
      </span>
    </div>
  );
}

function fracToString(frac: number): string {
  if (frac === 0.125) return "1/8";
  if (frac === 0.25) return "1/4";
  if (frac === 0.375) return "3/8";
  if (frac === 0.5) return "1/2";
  if (frac === 0.625) return "5/8";
  if (frac === 0.75) return "3/4";
  if (frac === 0.875) return "7/8";
  if (frac === 0) return "";
  return String(frac);
}

function formatSize(u: MaterialUnit): string {
  const w = u.widthWhole + (u.widthFrac ? ` ${fracToString(u.widthFrac)}` : "");
  const h = u.heightWhole + (u.heightFrac ? ` ${fracToString(u.heightFrac)}` : "");
  return `${w}" x ${h}"`;
}

/* ── Product Specs ── */

function ProductSpecs({ units }: { units: MaterialUnit[] }) {
  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="flex items-center gap-2 mb-2">
        <Package className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Product Specs ({units.length})
        </span>
      </div>
      <div className="space-y-1">
        {units.map((unit, i) => (
          <UnitAccordion key={i} unit={unit} index={i} />
        ))}
      </div>
    </div>
  );
}

function parseSpecDescription(spec: string): { label: string; value: string }[] {
  return spec
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return { label: line, value: "" };
      return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    });
}

function UnitAccordion({ unit, index }: { unit: MaterialUnit; index: number }) {
  const [open, setOpen] = useState(false);
  const unitLabel = unit.label || `#${index + 1}`;
  const unitName = unit.type || unit.unitType || unit.abbrev || "Unit";
  const specLines = unit.specDescription ? parseSpecDescription(unit.specDescription) : [];
  const fieldCount = specLines.length;
  const category = specLines.find(s => s.label === "Category")?.value || "";
  const subCategory = specLines.find(s => s.label === "Sub-Category")?.value || "";

  if (unit.isMisc) {
    return (
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-surface">
          <span className="text-xs text-muted font-mono shrink-0">{unitLabel}</span>
          <span className="text-sm font-medium">MISC</span>
          <span className="text-sm text-muted truncate">{unit.description || ""}</span>
          {(unit.qty || 1) > 1 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary-light text-primary font-medium shrink-0">
              x{unit.qty}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left bg-surface hover:bg-surface/80 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-muted font-mono shrink-0">{unitLabel}</span>
          <span className="text-sm font-medium truncate">{unitName}</span>
          {category && <span className="text-xs text-muted truncate">· {category}</span>}
          {subCategory && <span className="text-xs text-muted truncate">· {subCategory}</span>}
          {(unit.qty || unit.summaryQty || 0) > 1 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary-light text-primary font-medium shrink-0">
              x{unit.qty || unit.summaryQty}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {fieldCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-light text-primary font-medium">
              {fieldCount} fields
            </span>
          )}
          {open ? (
            <ChevronUp className="w-4 h-4 text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted" />
          )}
        </div>
      </button>

      {open && (
        <div className="px-3 py-2 border-t border-border text-sm space-y-0.5">
          {specLines.length > 0 ? (
            specLines.map((s, i) => (
              <SpecLine key={i} label={s.label} value={s.value} />
            ))
          ) : (
            <>
              <SpecLine label="Size" value={formatSize(unit)} />
              {getExterior(unit) && <SpecLine label="Ext Color" value={getExterior(unit)} />}
              {getInterior(unit) && <SpecLine label="Int Color" value={getInterior(unit)} />}
              {unit.intFinish && <SpecLine label="Int Finish" value={unit.intFinish} />}
              {unit.location && <SpecLine label="Location" value={unit.location} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SpecLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-xs">
      <span className="text-muted shrink-0">{label}:</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}
