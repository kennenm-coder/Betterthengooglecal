import { OUTCOME_INFO, type JcTag } from "@/lib/job-complete";

const PILL = {
  green: "bg-green-600/15 text-green-700 dark:text-green-400",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  red: "bg-danger/15 text-danger",
} as const;

/**
 * The Job Complete tag on an install tile: green when the job is finished and
 * clean, amber when it's finished with issues (or a checklist answer flagged
 * it), red when it isn't finished. Drawn only for roles that can read the
 * reports (DataProvider.completionFor), so nobody else ever sees one.
 */
export default function JobCompleteTag({ tag, compact = false }: { tag: JcTag; compact?: boolean }) {
  // A clean "complete" that a checklist answer flagged reads as a check-it tag.
  const tone =
    tag.outcome === "complete" && tag.flagged ? "amber" : OUTCOME_INFO[tag.outcome].tone;
  const label =
    tag.outcome === "complete" && tag.flagged ? "COMPLETE · CHECK" : OUTCOME_INFO[tag.outcome].tag;
  const reviewed = tag.flagged && tag.review_status === "reviewed";
  return (
    <span
      className={`inline-block rounded-full font-semibold whitespace-nowrap ${PILL[tone]} ${
        compact ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5"
      }`}
      title={reviewed ? "Reviewed by the office" : undefined}
    >
      {label}
      {reviewed ? " ✓" : ""}
    </span>
  );
}
