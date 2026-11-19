/**
 * Log Action (the "field notes" email button on the job card).
 *
 * Switched OFF 2026-11-19 — nobody ended up using it. Everything behind it is
 * kept (ActionModal, the action_settings rows, the admin fields), just hidden,
 * so it can come back by flipping this to true. While it's off:
 *   - the job card has no Log Action button (JobCard.tsx)
 *   - Admin → Config hides "Action Types" and the "Field Notes Email" inbox
 *   - Admin hides the "Action Log" tab (it only ever listed field notes)
 *
 * The per-person auto-CC list is NOT part of this: despite its old "Auto CC on
 * Field Notes" label it's also added to every write-up email, so it stays.
 */
export const LOG_ACTION_ENABLED = false;
