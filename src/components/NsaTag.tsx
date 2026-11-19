/**
 * "NSA" marker for jobs rForce flags as NSA-owned (work_orders.nsa_owned,
 * migration 062). One look everywhere, so the flag reads the same on a
 * calendar tile, a search result and the open job card.
 *
 *   tile   sits on a coloured calendar tile: solid white pill, dark text, so it
 *          stands out against every job-type colour
 *   card   sits on a light card or list row
 *
 * Renders nothing for an ordinary job, so callers can drop it in unconditionally.
 */
export default function NsaTag({
  owned,
  variant = "card",
  size = "sm",
}: {
  owned?: boolean;
  variant?: "tile" | "card";
  size?: "xs" | "sm";
}) {
  if (!owned) return null;
  const text = size === "xs" ? "text-[10px]" : "text-xs";
  const look =
    variant === "tile"
      ? "bg-white text-slate-900"
      : "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300";
  return (
    <span
      className={`px-1.5 py-0.5 rounded ${text} font-bold tracking-wide ${look}`}
      title="NSA-owned job"
    >
      NSA
    </span>
  );
}
