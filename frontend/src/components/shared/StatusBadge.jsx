const STATUS_STYLES = {
  // Program statuses
  planned: 'bg-blue-100 text-blue-700 border-blue-200',
  ongoing: 'bg-green-100 text-green-700 border-green-200',
  delayed: 'bg-red-100 text-red-700 border-red-200',
  completed: 'bg-gray-100 text-gray-700 border-gray-200',
  cancelled: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  // General
  approved: 'bg-green-100 text-green-700 border-green-200',
  rejected: 'bg-red-100 text-red-700 border-red-200',
  pending: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  submitted: 'bg-blue-100 text-blue-700 border-blue-200',
  under_review: 'bg-purple-100 text-purple-700 border-purple-200',
  liquidated: 'bg-teal-100 text-teal-700 border-teal-200',
  pending_approval: 'bg-orange-100 text-orange-700 border-orange-200',
  active: 'bg-green-100 text-green-700 border-green-200',
  inactive: 'bg-gray-100 text-gray-600 border-gray-200',
  // Compliance
  compliant: 'bg-green-100 text-green-700 border-green-200',
  at_risk: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  non_compliant: 'bg-red-100 text-red-700 border-red-200',
};

const STATUS_LABELS = {
  pending_approval: 'Pending Approval',
  under_review: 'Under Review',
  non_compliant: 'Non-Compliant',
  at_risk: 'At Risk',
};

export default function StatusBadge({ status, className = '' }) {
  const style = STATUS_STYLES[status] || 'bg-gray-100 text-gray-600 border-gray-200';
  const label = STATUS_LABELS[status] || status?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style} ${className}`}>
      {label}
    </span>
  );
}
