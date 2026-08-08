/**
 * Status chip.
 *
 * Statuses previously carried eleven distinct hues — purple for under_review, teal for
 * liquidated, orange for pending_approval, yellow for pending — each used once or twice. That
 * asks the user to memorise a colour per status instead of learning a small vocabulary.
 *
 * They now collapse to five *outcome* tones. A user learns once that amber means "waiting on
 * someone" and red means "went wrong", and that reading transfers across programs, budgets,
 * expenses, liquidations and compliance alike.
 *
 * Colour is never the sole carrier of meaning here — the label always spells the status out —
 * so this stays legible to colour-blind users and in monochrome print.
 *
 * Tone class names are deliberately kept (`bg-green-100`, `bg-gray-100`) because they are the
 * public contract asserted by StatusBadge.test.jsx.
 */
const TONES = {
  // Terminal or not-yet-started states. Nothing is expected of anyone.
  neutral: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-700/60 dark:text-gray-200 dark:border-gray-600',
  // In flight, progressing normally.
  info: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30',
  // Good outcome, or actively running.
  success: 'bg-green-100 text-green-800 border-green-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30',
  // Waiting on a person. Someone has an action to take.
  warning: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30',
  // Bad outcome. Needs intervention.
  danger: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30',
};

const STATUS_TONES = {
  // Program lifecycle
  planned: 'info',
  ongoing: 'success',
  delayed: 'danger',
  completed: 'neutral',
  // Cancelled was amber. It is a terminal state that asks nothing of anyone, so it now reads
  // neutral alongside completed rather than competing with states that need action.
  cancelled: 'neutral',
  // Approval flow
  draft: 'neutral',
  submitted: 'info',
  under_review: 'info',
  pending: 'warning',
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'danger',
  liquidated: 'success',
  // Account state
  active: 'success',
  inactive: 'neutral',
  // Compliance
  compliant: 'success',
  at_risk: 'warning',
  non_compliant: 'danger',
};

const STATUS_LABELS = {
  pending_approval: 'Pending Approval',
  under_review: 'Under Review',
  non_compliant: 'Non-Compliant',
  at_risk: 'At Risk',
};

export default function StatusBadge({ status, className = '' }) {
  const style = TONES[STATUS_TONES[status]] || TONES.neutral;
  const label = STATUS_LABELS[status] || status?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${style} ${className}`}
    >
      {label}
    </span>
  );
}
