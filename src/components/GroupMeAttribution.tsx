/**
 * Required attribution for the GroupMe API.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DO NOT REMOVE, AND DO NOT REPLACE WITH A LOGO IMAGE FOUND ONLINE.
 *
 * THIS IS THE MOST COMPLIANT STATE AVAILABLE TO US. Read why before changing it.
 *
 * The two documents do not fully agree, and the gap is GroupMe's.
 *
 * API License Agreement §5.1 names a TEXT notice as the floor:
 *   "Licensee must, at a minimum, use the following notice on any Licensee
 *    Applications when the GroupMe API is used: powered by GroupMe®"
 *   ...then adds that location and design "shall be done in accordance with
 *   the GroupMe Brand Standards".
 *
 * The Brand Standards go further and require the artwork itself:
 *   "Either the vertical or horizontal logo must be used in your application."
 *   "Always use the logos included in the asset pack. Never recreate or use
 *    your own version."
 *
 * So: a logo is required, must come from their asset pack, and recreating one
 * is expressly forbidden. The asset pack is not obtainable (see record below).
 * There is therefore NO path to the logo requirement that we can take.
 *
 * Given that, the choice is between:
 *   (a) text notice, no logo  — satisfies §5.1's stated minimum, and obeys the
 *       explicit "never recreate" instruction; falls short only on a clause we
 *       are unable to satisfy because they will not supply the input; or
 *   (b) a home-made logo      — a DEFINITE breach of an explicit written
 *       instruction, plus §5.2 on misuse of GroupMe Marks.
 *
 * (a) is plainly better. Shortfall caused by their missing asset beats a
 * deliberate breach of something they wrote in bold. Do not "fix" this by
 * adding a logo from a search engine, an icon library, or a screenshot.
 *
 * ALREADY CONSIDERED AND REJECTED: cropping the logo out of the Brand
 * Standards PDF. Using their own published artwork would not be "recreating"
 * it, so that part is fine — the problem is purely resolution. Every page of
 * that PDF is a flattened 1024px-wide raster with no vector art, and the
 * primary logo measures 203px across inside it (measured 2026-10-01). The
 * standards set a 250px minimum, doubled to 500px for retina — i.e. every
 * phone this app runs on. A 2.5x upscale of a compressed crop is a degraded
 * version of their mark, which fails the same rule by another route. If a
 * vector or a genuinely large asset ever turns up, revisit this.
 *
 * GOOD-FAITH RECORD — asset pack sought and not obtainable (2026-10-01):
 *   • dev.groupme.com/brand_standards renders the standards, but the asset
 *     pack itself is not downloadable from it.
 *   • GroupMe support was contacted directly and could not supply it; the
 *     developer site now redirects to support.microsoft.com/en-us/groupme/,
 *     which carries no developer asset pack either.
 *   • §9 of the agreement states GroupMe owes licensees no support, so there
 *     is no further channel to escalate through.
 *
 * NOT APPLICABLE TO THIS APP: the standards also require the logo on a
 * "Registration or Group Create page". We have neither — this app never
 * registers GroupMe users and never creates GroupMe groups. It reads and posts
 * to groups that already exist.
 *
 * IF THE ASSET PACK EVER ARRIVES, mind the sizing before dropping it in: the
 * standards set a minimum of 250px wide (horizontal) or 200px (vertical),
 * doubled for retina. That is wider than a phone's content column at the
 * places this currently renders, so the layout around it WILL need rethinking
 * — probably its own row rather than a footer line. Switch VARIANT, add the
 * light/dark/blue files to public/, and pick by background per their rules:
 * primary logo on white/light-grey, solid white on dark, white+light-blue only
 * on GroupMe blue (#00AFF0).
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Sources of truth:
 *   https://dev.groupme.com/brand_standards
 *   https://dev.groupme.com/terms
 */

/** Swap to "asset" once the official image pack is in hand. */
const VARIANT: "text" | "asset" = "text";

export default function GroupMeAttribution({
  className = "",
  compact = false,
}: {
  className?: string;
  /**
   * Drops the "not built or endorsed" half, for tight spots like a chat header.
   * Only ever use this where the full notice is one tap away -- every
   * conversation is reached through the chat list, whose footer carries it.
   */
  compact?: boolean;
}) {
  if (VARIANT !== "text") {
    // Intentionally unreachable until the official asset lands. The light and
    // dark files go here, picked by the same prefers-color-scheme the rest of
    // the app uses — not a recreation, only the supplied artwork.
    return null;
  }

  return (
    // Deliberately plain and unstyled-looking: this must be legible and
    // visible, but subordinate to our own interface. GroupMe provides the
    // messaging; the product is ours, and the UI should keep saying so.
    <p className={`text-[11px] text-muted leading-snug ${className}`}>
      <a
        href="https://groupme.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-foreground transition-colors"
      >
        powered by GroupMe&reg;
      </a>
      {/* §5.2: "Licensee shall ensure that users know that Licensee's
          applications were not built or endorsed by GroupMe." Phrased with
          their own words so there is no argument about whether it counts.
          Not part of the link -- pointing a disclaimer at groupme.com would
          read like they published it. */}
      {!compact && (
        <>
          <span className="mx-1.5" aria-hidden="true">
            &middot;
          </span>
          <span>not built or endorsed by GroupMe</span>
        </>
      )}
    </p>
  );
}
