import type { ShownVendor } from "@/lib/trim-order-handoff";

/**
 * A Vendor cell's contents. When the trim order has moved the vendor, the
 * order's vendor is the one shown, with a small line underneath saying so and
 * what the write-up was written with.
 */
export default function ShownVendorText({ shown }: { shown: ShownVendor }) {
  if (!shown.was) return <>{shown.vendor || "—"}</>;
  return (
    <>
      {shown.vendor}
      <span
        className="block text-[9px] font-normal text-muted whitespace-nowrap"
        title={`The write-up said ${shown.was}; this is the vendor on its trim order in the material list app.`}
      >
        per trim order · was {shown.was}
      </span>
    </>
  );
}
