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
  AlertTriangle,
  Paintbrush,
  ClipboardList,
} from "lucide-react";
import { useState } from "react";
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

export default function JobCard({
  order,
  compact = false,
}: {
  order: WorkOrder;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const typeBg = typeColor(order.workOrderType);
  const multiDay = isMultiDay(order);

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

          <div className="mt-3 space-y-2">
            {/* Schedule — show full date range for multi-day */}
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

            {/* Order # and WO# — Order Number is primary */}
            <InfoRow icon={Hash} label="Order#">
              <span className="font-medium">{order.orderNumber}</span>
              <CopyButton text={order.orderNumber} label="order number" />
              <span className="text-muted mx-1">|</span>
              <span className="text-muted text-xs">WO: {order.workOrderNumber}</span>
              <CopyButton text={order.workOrderNumber} label="work order" />
            </InfoRow>

            {/* Address */}
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

            {/* Key people — always visible */}
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

            {/* Phone */}
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

            {/* Email */}
            {order.email && (
              <InfoRow icon={Mail} label="Email">
                <a href={`mailto:${order.email}`} className="text-primary underline break-all">
                  {order.email}
                </a>
                <CopyButton text={order.email} label="email" />
              </InfoRow>
            )}

            {/* Salesforce */}
            <SalesforceButton workOrderNumber={order.workOrderNumber} />
          </div>

          {/* Expanded: booking date + job status */}
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

          {/* Materials section — shown when linked material data exists */}
          {order.materialJob && (
            <MaterialsSection data={order.materialJob} />
          )}
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

function unitSummary(units: MaterialUnit[]): string {
  const counts: Record<string, number> = {};
  for (const u of units) {
    const abbr = u.type
      .replace(/Double Hung/i, "DH")
      .replace(/Casement/i, "CAS")
      .replace(/Patio Door/i, "PD")
      .replace(/Picture/i, "PIC")
      .replace(/Sliding/i, "SLD")
      .replace(/Bay/i, "BAY")
      .replace(/Bow/i, "BOW")
      .replace(/Awning/i, "AWN")
      .replace(/Entry Door/i, "ED")
      .replace(/Gliding/i, "GLD");
    counts[abbr] = (counts[abbr] || 0) + (u.qty || 1);
  }
  return Object.entries(counts)
    .map(([type, qty]) => `${qty} ${type}`)
    .join(", ");
}

function formatSize(u: MaterialUnit): string {
  const w = u.widthWhole + (u.widthFrac ? ` ${fracToString(u.widthFrac)}` : "");
  const h = u.heightWhole + (u.heightFrac ? ` ${fracToString(u.heightFrac)}` : "");
  return `${w}" x ${h}"`;
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

function MaterialsSection({ data }: { data: MaterialJobData }) {
  const [open, setOpen] = useState(false);
  const summary = unitSummary(data.units);
  const hasNotes = data.job.installNotes?.trim();
  const hasPrefinish = data.job.prefinishNotes?.trim();
  const hasLeadPaint = data.job.leadPaint;

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Materials</span>
          {hasLeadPaint && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-danger/10 text-danger font-semibold uppercase">
              Lead Paint
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">{summary || `${data.units.length} units`}</span>
          {open ? (
            <ChevronUp className="w-4 h-4 text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted" />
          )}
        </div>
      </button>

      {open && (
        <div className="mt-2 space-y-3 text-sm">
          {/* Install Notes */}
          {hasNotes && (
            <div className="rounded-lg bg-surface p-3">
              <div className="flex items-center gap-1.5 mb-1 text-muted">
                <ClipboardList className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">Install Notes</span>
              </div>
              <p className="text-foreground whitespace-pre-wrap">{data.job.installNotes}</p>
            </div>
          )}

          {/* Lead Paint Warning */}
          {hasLeadPaint && (
            <div className="rounded-lg bg-danger/5 border border-danger/20 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
              <p className="text-danger font-medium">Lead paint present — follow safe work practices</p>
            </div>
          )}

          {/* Trim / Finish */}
          {data.globalTrim && (data.globalTrim.species || data.globalTrim.trimStyle || data.globalTrim.finishType) && (
            <div className="rounded-lg bg-surface p-3">
              <div className="flex items-center gap-1.5 mb-1 text-muted">
                <Paintbrush className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">Trim & Finish</span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {data.globalTrim.species && (
                  <TrimLine label="Species" value={data.globalTrim.species} />
                )}
                {data.globalTrim.trimStyle && (
                  <TrimLine label="Style" value={data.globalTrim.trimStyle} />
                )}
                {data.globalTrim.casingProfile && (
                  <TrimLine label="Casing" value={data.globalTrim.casingProfile} />
                )}
                {data.globalTrim.finishType && (
                  <TrimLine label="Finish" value={data.globalTrim.finishType} />
                )}
                {data.globalTrim.stain && (
                  <TrimLine label="Stain" value={data.globalTrim.stain} />
                )}
                {data.globalTrim.paint && (
                  <TrimLine label="Paint" value={data.globalTrim.paint} />
                )}
                {(data.globalTrim.jambDepthWhole || data.globalTrim.jambDepthFrac) && (
                  <TrimLine
                    label="Jamb"
                    value={`${data.globalTrim.jambDepthWhole || "0"}${data.globalTrim.jambDepthFrac ? ` ${fracToString(data.globalTrim.jambDepthFrac)}` : ""}"`}
                  />
                )}
              </div>
            </div>
          )}

          {/* Prefinish Notes */}
          {hasPrefinish && (
            <div className="rounded-lg bg-surface p-3">
              <div className="flex items-center gap-1.5 mb-1 text-muted">
                <Paintbrush className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">Prefinish Notes</span>
              </div>
              <p className="text-foreground whitespace-pre-wrap">{data.job.prefinishNotes}</p>
            </div>
          )}

          {/* Unit List */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Units ({data.units.length})
            </span>
            <div className="mt-1 space-y-1.5">
              {data.units.map((unit, i) => (
                <div
                  key={i}
                  className="rounded-lg bg-surface p-2.5 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{unit.type}</span>
                      {unit.qty > 1 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-primary-light text-primary font-medium">
                          x{unit.qty}
                        </span>
                      )}
                      {unit.grilles && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-primary-light text-primary font-medium">
                          Grilles
                        </span>
                      )}
                      {unit.tempered && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-warning/15 text-warning font-medium">
                          Tempered
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {formatSize(unit)}
                      {unit.extColor && ` · Ext: ${unit.extColor}`}
                      {unit.intColor && ` · Int: ${unit.intColor}`}
                    </div>
                    {unit.intFinish && (
                      <div className="text-xs text-muted">{unit.intFinish}</div>
                    )}
                  </div>
                  <span className="text-xs text-muted shrink-0">{unit.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrimLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs">
      <span className="text-muted">{label}: </span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}

function SalesforceButton({ workOrderNumber }: { workOrderNumber: string }) {
  const [copied, setCopied] = useState(false);

  function handleClick() {
    navigator.clipboard.writeText(workOrderNumber).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = `salesforce1://search/${encodeURIComponent(workOrderNumber)}`;
    }
  }

  return (
    <button
      onClick={handleClick}
      className="mt-1 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#0176D3] text-white text-sm font-medium active:scale-[0.98] transition-transform"
    >
      <ExternalLink className="w-4 h-4" />
      {copied ? "Copied! Paste in Salesforce search" : "Open Salesforce"}
    </button>
  );
}
