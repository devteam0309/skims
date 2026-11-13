/*
 * `sk_kagawad` was removed from the system in the October 2026 panel round. The panel asked for it
 * to be dropped from registration, and the live database held no account with the role, so it is
 * gone from the enum and from every group below rather than lingering as a value nothing assigns.
 * `scripts/migrate-barangay-finance.js` reports any account still carrying it before this ships.
 */
const ADMINS = ['super_admin', 'provincial_admin', 'municipal_admin'];
const STAFF = [...ADMINS, 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'dilg_representative'];
const EDITORS = [...ADMINS, 'sk_chairperson', 'sk_secretary'];
const YOUTH_REGISTRARS = [...ADMINS, 'sk_chairperson'];
const YOUTH_EDITORS = [...ADMINS, 'sk_chairperson', 'sk_secretary'];
const DOC_UPLOADERS = [...ADMINS, 'sk_chairperson', 'sk_treasurer', 'sk_secretary'];
const DOC_EDITORS = [...ADMINS, 'sk_chairperson', 'sk_secretary'];

/*
 * The three SK offices a barangay has exactly one of.
 *
 * A barangay has one chairperson, one treasurer and one secretary, so each (barangay, office) pair
 * is a seat that at most one account may hold — enforced by a unique index on `User.seatKey`, not
 * only by the check registration makes first. Pending applications hold the seat too, so two
 * applicants cannot both claim it while waiting for review; a rejected, deactivated or deleted
 * account releases it.
 */
const SEAT_ROLES = ['sk_chairperson', 'sk_treasurer', 'sk_secretary'];

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

/*
 * Who reads the per-barangay financial performance view: the officers who review barangay money,
 * plus DILG's province-wide oversight. Barangay officers see their own figures on the ordinary
 * budget pages; a table comparing every barangay is the municipality's tool, not theirs.
 */
const FINANCE_MONITORS = [...ADMINS, 'dilg_representative'];

/*
 * Registration.
 *
 * `municipal_admin` became self-registrable at the panel's request — it was the role the register
 * form was "missing". It is safe to offer only because every non-youth registration waits for a
 * super_admin to approve it, and the approval refuses an applicant who uploaded no identity or
 * residency document (see VERIFICATION_REQUIRED_ROLES). `provincial_admin` and `super_admin`
 * remain assignable only by an existing administrator.
 */
const SELF_ASSIGNABLE_ROLES = ['sk_chairperson', 'sk_treasurer', 'sk_secretary', 'municipal_admin', 'dilg_representative', 'youth'];

/*
 * Applicants who must prove who they are before a super_admin may let them in. Every
 * self-registering role except `youth`, which approves itself and is vetted through its registry
 * record instead.
 */
const VERIFICATION_REQUIRED_ROLES = SELF_ASSIGNABLE_ROLES.filter((r) => r !== 'youth');

/*
 * Kinds of supporting document an applicant may attach, as the panel listed them. Stored with each
 * upload so the approver knows what they are looking at before opening it.
 */
const VERIFICATION_DOCUMENT_TYPES = ['government_id', 'kk_id', 'proof_of_residency'];

/*
 * Rank used to decide who may change an announcement someone else wrote: an account may manage
 * announcements issued by a strictly LOWER authority within its reach, and its own. A barangay
 * officer therefore cannot touch what the municipal, provincial or DILG level published.
 */
const AUTHORITY_RANK = {
  super_admin: 5,
  provincial_admin: 4,
  dilg_representative: 4,
  municipal_admin: 3,
  sk_chairperson: 1,
  sk_secretary: 1,
  sk_treasurer: 1,
  youth: 0,
};

module.exports = {
  ADMINS, STAFF, EDITORS,
  YOUTH_REGISTRARS, YOUTH_EDITORS, DOC_UPLOADERS, DOC_EDITORS,
  SEAT_ROLES,
  CROSS_MUNICIPALITY_READ, CROSS_MUNICIPALITY_WRITE,
  REPORT_VIEWERS, FINANCE_EDITORS, FINANCE_APPROVERS, BUDGET_APPROVERS, FINANCE_MONITORS,
  SELF_ASSIGNABLE_ROLES, VERIFICATION_REQUIRED_ROLES, VERIFICATION_DOCUMENT_TYPES,
  AUTHORITY_RANK,
};
