const ADMINS = ['super_admin', 'provincial_admin', 'municipal_admin'];
const FINANCE_STAFF = [...ADMINS, 'sk_chairperson', 'sk_treasurer'];
const STAFF = [...ADMINS, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative'];
const EDITORS = [...ADMINS, 'sk_chairperson', 'sk_secretary'];
const REPORTERS = [...ADMINS, 'sk_chairperson', 'sk_treasurer', 'dilg_representative'];
const YOUTH_REGISTRARS = [...ADMINS, 'sk_chairperson'];
const YOUTH_EDITORS = [...ADMINS, 'sk_chairperson', 'sk_secretary', 'sk_kagawad'];
const DOC_UPLOADERS = [...ADMINS, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad'];
const DOC_EDITORS = [...ADMINS, 'sk_chairperson', 'sk_secretary'];

module.exports = { ADMINS, FINANCE_STAFF, STAFF, EDITORS, REPORTERS, YOUTH_REGISTRARS, YOUTH_EDITORS, DOC_UPLOADERS, DOC_EDITORS };
