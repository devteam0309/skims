const ADMINS = ['super_admin', 'provincial_admin', 'municipal_admin'];
const STAFF = [...ADMINS, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative'];
const EDITORS = [...ADMINS, 'sk_chairperson', 'sk_secretary'];
const YOUTH_REGISTRARS = [...ADMINS, 'sk_chairperson'];
const YOUTH_EDITORS = [...ADMINS, 'sk_chairperson', 'sk_secretary', 'sk_kagawad'];
const DOC_UPLOADERS = [...ADMINS, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad'];
const DOC_EDITORS = [...ADMINS, 'sk_chairperson', 'sk_secretary'];

/* --------------------------------------------------------------------------------------------- *
 * Municipality reach
 *
 * The two halves are deliberately NOT the same list.
 *
 * `municipal_admin` is in neither, despite the name: it is scoped like any SK officer. Assuming
 * otherwise has produced several cross-municipality defects and is the single most repeated
 * mistake in this codebase.
 *
 * `dilg_representative` reads across all four municipalities and writes in none. It is provincial
 * oversight with no municipality of its own, so under a single combined list it failed every
 * ownership check and saw nothing at all, anywhere. Separating read from write lets it observe the
 * whole province without gaining a single mutation.
 *
 * Anything that MUTATES must check CROSS_MUNICIPALITY_WRITE. Only reads may use the read list.
 * --------------------------------------------------------------------------------------------- */
const CROSS_MUNICIPALITY_READ = ['super_admin', 'provincial_admin', 'dilg_representative'];
const CROSS_MUNICIPALITY_WRITE = ['super_admin', 'provincial_admin'];

/* --------------------------------------------------------------------------------------------- *
 * Reading a report and approving money are different privileges, and now have different lists.
 *
 * They used to be one constant (`REPORTERS`) covering both, which is why `dilg_representative`
 * could approve budgets, expenses and liquidations purely as a side effect of being allowed to
 * open Reports — and why adding a role to Reports silently handed it financial authority.
 * --------------------------------------------------------------------------------------------- */
const REPORT_VIEWERS = [...ADMINS, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'dilg_representative'];

/* --------------------------------------------------------------------------------------------- *
 * Writing finance records and approving them are separate, and neither belongs to the same role.
 *
 * `FINANCE_EDITORS` replaces the old `FINANCE_STAFF`, which included `sk_chairperson`. The
 * chairperson is now VIEW-ONLY across Fund Management: they may read budgets, expenses and
 * liquidations through REPORT_VIEWERS and the ordinary list routes, and create, edit, delete or
 * approve none of them. The treasurer is the officer who records money; the municipal
 * administrator is the officer who reviews it.
 *
 * `FINANCE_APPROVERS` no longer contains the treasurer either. An officer must not approve the
 * record type they exist to create — the self-approval guard on `approveExpense` only ever stopped
 * them approving their OWN expense, which left one treasurer free to approve another's.
 *
 * The chairperson held both rights until this round and lost them deliberately. Restoring either
 * is one entry here, but it re-opens create-and-approve in a single pair of hands.
 * --------------------------------------------------------------------------------------------- */
const FINANCE_EDITORS = [...ADMINS, 'sk_treasurer'];
const FINANCE_APPROVERS = [...ADMINS];
const BUDGET_APPROVERS = [...ADMINS];

module.exports = {
  ADMINS, STAFF, EDITORS,
  YOUTH_REGISTRARS, YOUTH_EDITORS, DOC_UPLOADERS, DOC_EDITORS,
  CROSS_MUNICIPALITY_READ, CROSS_MUNICIPALITY_WRITE,
  REPORT_VIEWERS, FINANCE_EDITORS, FINANCE_APPROVERS, BUDGET_APPROVERS,
};
