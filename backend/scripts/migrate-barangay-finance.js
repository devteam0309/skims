/**
 * Migration for the October 2026 panel round: per-barangay budgets, one SK seat per barangay, and
 * barangay-scoped finance.
 *
 * Dry-run by default — and genuinely read-only: Mongoose's automatic index builds are switched off
 * below, because merely connecting with the models loaded would otherwise build the new indexes on
 * the live database during what was meant to be a look.
 *
 *   node scripts/migrate-barangay-finance.js                         # report only
 *   node scripts/migrate-barangay-finance.js --apply                 # indexes + seat keys
 *   node scripts/migrate-barangay-finance.js --apply --backfill-barangays
 *
 * ## What --apply does
 *
 *   1. Drops the old `municipality_1_fiscalYear_1` unique index on budgets. It allowed ONE budget per
 *      municipality and year, so every barangay allocation would be refused with a duplicate-key
 *      error. Builds the replacement (one per municipality, barangay and year) and the seat index.
 *   2. Gives every SK chairperson, treasurer and secretary their `seatKey`. Where two active accounts
 *      claim the same barangay office, NEITHER is changed: both are listed for the super_admin to
 *      resolve (deactivate or reassign one), because guessing which officer is genuine is not a
 *      decision a script should make.
 *
 * ## What --backfill-barangays adds
 *
 * Expenses, liquidation reports and documents written before barangay scoping have no barangay. A
 * barangay officer still sees the ones they created (utils/scope.js `ownerField`), but the other
 * officers of the same barangay do not — the chairperson cannot see the treasurer's older expenses.
 * This files each such record under its creator's barangay, when the creator is a barangay officer
 * of the SAME municipality as the record. Records created by administrators stay municipality-level.
 * Budgets are never touched: an existing budget is the municipal budget.
 *
 * ## Before shipping
 *
 * `sk_kagawad` is no longer a role. Any account still holding it would fail validation on its next
 * save; the report lists them (there should be none — the live database had none on 2026-10-31).
 */
require('dotenv').config();
const mongoose = require('mongoose');

mongoose.set('autoIndex', false);
mongoose.set('autoCreate', false);

const User = require('../src/models/User');
const Budget = require('../src/models/Budget');
const Expense = require('../src/models/Expense');
const Liquidation = require('../src/models/Liquidation');
const DocumentModel = require('../src/models/Document');
require('../src/models/Barangay'); // registered for the populate below
const { SEAT_ROLES } = require('../src/constants/roles');

const APPLY = process.argv.includes('--apply');
const BACKFILL = process.argv.includes('--backfill-barangays');
const LEGACY_BUDGET_INDEX = 'municipality_1_fiscalYear_1';

const line = (s = '') => console.log(s);

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false, autoCreate: false });
  line(`\nConnected to "${mongoose.connection.name}"`);
  line(APPLY ? `Mode: APPLY${BACKFILL ? ' + barangay backfill' : ''} (writes)` : 'Mode: dry run (no writes)');

  // 0. Removed role ------------------------------------------------------------------------------
  const kagawads = await User.collection.find({ role: 'sk_kagawad' }).project({ email: 1, deletedAt: 1 }).toArray();
  line(`\n[roles] accounts still holding sk_kagawad: ${kagawads.length}`);
  kagawads.forEach((k) => line(`   - ${k.email}${k.deletedAt ? ' (deleted)' : ''}  -> assign another role or delete before deploying`));

  // 1. Budget index ------------------------------------------------------------------------------
  const budgetIndexes = await Budget.collection.indexes();
  const legacy = budgetIndexes.find((i) => i.name === LEGACY_BUDGET_INDEX);
  const replacement = budgetIndexes.find((i) => i.name === 'one_live_budget_per_scope_and_year');
  line(`\n[budgets] legacy one-budget-per-municipality index: ${legacy ? 'PRESENT (blocks barangay budgets)' : 'absent'}`);
  line(`[budgets] per-barangay unique index: ${replacement ? 'present' : 'missing'}`);
  const budgetCounts = await Budget.collection.aggregate([
    { $match: { deletedAt: null } },
    { $group: { _id: { $cond: [{ $eq: [{ $ifNull: ['$barangay', null] }, null] }, 'municipal', 'barangay'] }, n: { $sum: 1 } } },
  ]).toArray();
  line(`[budgets] live budgets: ${budgetCounts.map((c) => `${c.n} ${c._id}`).join(', ') || 'none'}`);
  if (APPLY) {
    if (legacy) {
      await Budget.collection.dropIndex(LEGACY_BUDGET_INDEX);
      line(`   dropped ${LEGACY_BUDGET_INDEX}`);
    }
    await Budget.createIndexes();
    line('   budget indexes ensured');
  }

  // 2. Seats -------------------------------------------------------------------------------------
  const officers = await User.find({ role: { $in: SEAT_ROLES }, deletedAt: null })
    .select('firstName lastName email role barangay municipality isActive isApproved seatKey')
    .populate('barangay', 'name')
    .lean();
  const wanted = new Map();
  for (const o of officers) {
    const key = User.seatKeyFor(o);
    if (!key) continue;
    wanted.set(key, [...(wanted.get(key) || []), o]);
  }
  const conflicts = [...wanted.entries()].filter(([, holders]) => holders.length > 1);
  const toSet = [...wanted.entries()].filter(([, holders]) => holders.length === 1)
    .map(([key, [o]]) => ({ o, key }))
    .filter(({ o, key }) => o.seatKey !== key);
  const noBarangay = officers.filter((o) => !o.barangay);
  line(`\n[seats] SK officers: ${officers.length} · seat keys to write: ${toSet.length} · conflicts: ${conflicts.length} · without a barangay: ${noBarangay.length}`);
  conflicts.forEach(([key, holders]) => {
    line(`   CONFLICT ${key} (${holders[0].barangay?.name || 'barangay'} / ${holders[0].role}):`);
    holders.forEach((h) => line(`     - ${h.email}  approved=${h.isApproved} active=${h.isActive}`));
  });
  noBarangay.forEach((o) => line(`   no barangay: ${o.email} (${o.role}) — municipality-wide until assigned`));
  if (APPLY) {
    const userIndexes = await User.collection.indexes();
    if (!userIndexes.find((i) => i.key?.seatKey)) {
      await User.collection.createIndex({ seatKey: 1 }, { unique: true, sparse: true });
      line('   created seatKey unique index');
    }
    for (const { o, key } of toSet) await User.collection.updateOne({ _id: o._id }, { $set: { seatKey: key } });
    line(`   wrote ${toSet.length} seat key(s); ${conflicts.length} conflict(s) left for the super_admin`);
  }

  // 3. Barangay backfill -------------------------------------------------------------------------
  const boundCreators = new Map(officers.filter((o) => o.barangay).map((o) => [o._id.toString(), o]));
  const plan = async (Model, label, ownerField) => {
    const rows = await Model.collection.find({ barangay: null, [ownerField]: { $in: [...boundCreators.keys()].map((id) => new mongoose.Types.ObjectId(id)) } })
      .project({ [ownerField]: 1, municipality: 1 }).toArray();
    const fixable = rows.filter((r) => {
      const creator = boundCreators.get(r[ownerField].toString());
      return creator && String(creator.municipality) === String(r.municipality);
    });
    line(`[backfill] ${label}: ${fixable.length} record(s) created by barangay officers with no barangay`);
    if (APPLY && BACKFILL) {
      for (const r of fixable) {
        await Model.collection.updateOne({ _id: r._id, barangay: null }, { $set: { barangay: boundCreators.get(r[ownerField].toString()).barangay._id } });
      }
      line(`   filed ${fixable.length} under their creator's barangay`);
    }
  };
  line('');
  await plan(Expense, 'expenses', 'createdBy');
  await plan(Liquidation, 'liquidations', 'submittedBy');
  await plan(DocumentModel, 'documents', 'uploadedBy');
  if (!BACKFILL) line('   (pass --apply --backfill-barangays to file them)');

  // 4. Information only ---------------------------------------------------------------------------
  const unproved = await Expense.collection.countDocuments({ deletedAt: null, status: { $in: ['pending', 'approved'] }, 'attachments.0': { $exists: false } });
  line(`\n[info] pending/approved expenses with no attachment: ${unproved} (pending ones cannot be approved until proof is added)`);
  const legacyRejected = await Expense.collection.countDocuments({ status: 'rejected' });
  line(`[info] expenses in 'rejected': ${legacyRejected} (before Oct 2026 this meant "returned"; review if non-zero)`);

  await mongoose.disconnect();
  line(APPLY ? '\nDone.' : '\nDry run complete — nothing was written.');
};

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
