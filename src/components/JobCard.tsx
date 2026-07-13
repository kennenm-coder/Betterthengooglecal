"use client";

import { WorkOrder } from "@/lib/types";
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

function SalesforceButton({ workOrderNumber }: { workOrderNumber: string }) {
  const sfUrl = `https://renewalbyandersen.my.site.com/rForceLEX/s/global-search/${encodeURIComponent(workOrderNumber)}`;

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    navigator.clipboard.writeText(workOrderNumber).catch(() => {});
    window.location.href = sfUrl;
  }

  return (
    <a
      href={sfUrl}
      onClick={handleClick}
      className="mt-1 w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#0176D3] text-white text-sm font-medium active:scale-[0.98] transition-transform no-underline"
    >
      <ExternalLink className="w-4 h-4" />
      Search in Salesforce
    </a>
  );
}
