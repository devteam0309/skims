export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  PROVINCIAL_ADMIN: 'provincial_admin',
  MUNICIPAL_ADMIN: 'municipal_admin',
  SK_CHAIRPERSON: 'sk_chairperson',
  SK_TREASURER: 'sk_treasurer',
  SK_SECRETARY: 'sk_secretary',
  SK_KAGAWAD: 'sk_kagawad',
  DILG_REPRESENTATIVE: 'dilg_representative',
  PUBLIC_USER: 'public_user',
};

export const ROLE_LABELS = {
  super_admin: 'Super Administrator',
  provincial_admin: 'Provincial SK Fed. Admin',
  municipal_admin: 'Municipal SK Fed. Admin',
  sk_chairperson: 'SK Chairperson',
  sk_treasurer: 'SK Treasurer',
  sk_secretary: 'SK Secretary',
  sk_kagawad: 'SK Kagawad',
  dilg_representative: 'DILG Representative',
  youth: 'Youth Member',
  public_user: 'Public User',
};

export const PROGRAM_STATUS_COLORS = {
  planned: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-green-100 text-green-700',
  delayed: 'bg-red-100 text-red-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-yellow-100 text-yellow-700',
};

/*
 * Suggestions, not a closed list — the category input is a ComboInput that stores whatever is
 * typed. "Other" was removed deliberately: the control looks like a <select>, so offering
 * "Other" taught users to pick it and then left them nowhere to say what they actually meant,
 * which is the exact problem free text solves. Existing programs stored as `other` still show
 * and still filter — the filter builds its options from live data, not from this list.
 */
export const PROGRAM_CATEGORIES = [
  { value: 'education', label: 'Education' },
  { value: 'health', label: 'Health' },
  { value: 'livelihood', label: 'Livelihood' },
  { value: 'sports', label: 'Sports' },
  { value: 'environment', label: 'Environment' },
  { value: 'peace_and_order', label: 'Peace & Order' },
  { value: 'governance', label: 'Governance' },
  { value: 'social_services', label: 'Social Services' },
  { value: 'culture_and_arts', label: 'Culture & Arts' },
  { value: 'infrastructure', label: 'Infrastructure' },
];

export const DOCUMENT_CATEGORIES = [
  { value: 'resolution', label: 'Resolution' },
  { value: 'purchase_request', label: 'Purchase Request' },
  { value: 'purchase_order', label: 'Purchase Order' },
  { value: 'liquidation_report', label: 'Liquidation Report' },
  { value: 'abyip', label: 'ABYIP' },
  { value: 'cbydp', label: 'CBYDP' },
  { value: 'annual_budget', label: 'Annual Budget' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'compliance_report', label: 'Compliance Report' },
  { value: 'dilg_report', label: 'DILG Report' },
  { value: 'minutes', label: 'Minutes' },
  { value: 'ordinance', label: 'Ordinance' },
  { value: 'certificate', label: 'Certificate' },
  { value: 'other', label: 'Other' },
];

/*
 * Display names only. These MUST match the `name` values the API returns, or any code that maps or
 * compares against this list silently drops a municipality — the entry read 'Sta. Cruz' while the
 * database stores 'Santa Cruz'. Nothing but a unit test reads this today; it is kept in step so it
 * is safe for something to start reading it.
 */
export const MUNICIPALITIES = ['Boac', 'Gasan', 'Mogpog', 'Santa Cruz'];

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Roles a user may choose for themselves at registration. Must stay in step with
 * SELF_ASSIGNABLE_ROLES in backend/src/controllers/authController.js, which silently downgrades
 * anything outside this list to public_user.
 *
 * The register form previously offered every role except super_admin, so a registrant could
 * pick "Municipal SK Fed. Admin", be given public_user without any message, and land on the
 * public portal wondering where their dashboard went. Elevated roles are assigned by an admin
 * after the account exists.
 */
export const SELF_ASSIGNABLE_ROLES = [
  'sk_chairperson',
  'sk_treasurer',
  'sk_secretary',
  'sk_kagawad',
  'dilg_representative',
  // Registering as a youth also creates the registry record, so the form asks for a birth date
  // and gender when this is chosen. Listed first in the UI because it is now the common case.
  'youth',
  'public_user',
];

/**
 * The password rule the server actually enforces.
 *
 * User.js validates on save with this pattern, and it is stricter than the register route's own
 * validator, which checks only for an uppercase letter and a digit. Any form that sets a password
 * must state and check this one, or the user satisfies what they were shown and is then refused
 * by a raw Mongoose validation message naming a rule nobody mentioned.
 *
 * Kept in step with backend/src/models/User.js.
 */
export const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;
export const PASSWORD_RULE_TEXT =
  'At least 8 characters, with an uppercase letter, a number and a special character.';

/**
 * Messages the login page is willing to display from the `reason` query parameter.
 *
 * The parameter used to carry free text straight into a toast. It is only ever set by the API
 * client after a failed token refresh, but anyone could hand out a link like
 * `/login?reason=Account+locked,+call+0917...` and have an arbitrary message render in the app's
 * own error styling, on the real domain — a convincing prop for a phishing call. Codes are
 * resolved against this map and anything unrecognised is ignored.
 */
export const LOGIN_NOTICES = {
  session_expired: 'Your session has expired. Please sign in again.',
  account_inactive: 'Your account is no longer active. Contact an administrator.',
};

export const ADMIN_ROLES = ['super_admin', 'provincial_admin', 'municipal_admin'];
export const EDITOR_ROLES = [...ADMIN_ROLES, 'sk_chairperson', 'sk_secretary'];
export const FINANCE_ROLES = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer', 'dilg_representative'];
export const FINANCE_STAFF = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer'];
export const STAFF = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative'];
/*
 * Mirrors backend constants/roles.js. Opening Reports is a view; approving money is not, and the
 * two were one list — which is how DILG came to approve budgets by way of reading reports, and
 * why adding the Secretary to Reports would have handed them expense approval.
 */
export const REPORT_VIEWERS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'dilg_representative'];
export const FINANCE_APPROVERS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer'];
export const BUDGET_APPROVERS = [...ADMIN_ROLES];
// Account administration and the audit trail are super_admin only.
export const USER_ADMINS = ['super_admin'];
export const PROGRAM_EDITORS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_secretary'];
export const YOUTH_REGISTRARS = [...ADMIN_ROLES, 'sk_chairperson'];
export const YOUTH_EDITORS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_secretary', 'sk_kagawad'];
export const DOC_UPLOADERS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad'];
export const DOC_EDITORS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_secretary'];
