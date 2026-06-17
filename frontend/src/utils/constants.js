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
  public_user: 'Public User',
};

export const PROGRAM_STATUS_COLORS = {
  planned: 'bg-blue-100 text-blue-700',
  ongoing: 'bg-green-100 text-green-700',
  delayed: 'bg-red-100 text-red-700',
  completed: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-yellow-100 text-yellow-700',
};

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
  { value: 'other', label: 'Other' },
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

export const MUNICIPALITIES = ['Boac', 'Buenavista', 'Gasan', 'Mogpog', 'Sta. Cruz', 'Torrijos'];

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const ADMIN_ROLES = ['super_admin', 'provincial_admin', 'municipal_admin'];
export const EDITOR_ROLES = [...ADMIN_ROLES, 'sk_chairperson', 'sk_secretary'];
export const FINANCE_ROLES = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer', 'dilg_representative'];
export const FINANCE_STAFF = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer'];
export const STAFF = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative'];
export const REPORTERS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer', 'dilg_representative'];
export const PROGRAM_EDITORS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_secretary'];
export const YOUTH_EDITORS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_secretary', 'sk_kagawad'];
export const DOC_UPLOADERS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad'];
export const DOC_EDITORS = [...ADMIN_ROLES, 'sk_chairperson', 'sk_secretary'];
