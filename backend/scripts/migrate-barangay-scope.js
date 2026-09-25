/**
 * Migration report for barangay-scoped SK accounts.
 *
 * Dry-run by default. `--apply` only ever writes what an explicit mapping file tells it to.
 *
 *   node scripts/migrate-barangay-scope.js                      # report only
 *   node scripts/migrate-barangay-scope.js --map=brgy.json       # report, with the mapping resolved
 *   node scripts/migrate-barangay-scope.js --map=brgy.json --apply
 *   node scripts/migrate-barangay-scope.js --map=brgy.json --reassign --apply   # also MOVE assigned ones
 *
 * ## Why this does not assign anything on its own
 *
 * No SK account has ever had a barangay: the field existed on User and nothing set it. There is no
 * fact in the database from which the right barangay can be derived — an email domain names a
 * municipality at best, and `Barangay.skChairperson` is unpopulated too. Guessing would silently
 * confine a real officer to the wrong barangay, which is worse than leaving them municipality-wide:
 * they would see a registry that looks complete and is not.
 *
 * So unassigned accounts are reported as migration exceptions for a human to resolve, and the
 * application is built to work either way — an account with no barangay keeps municipality-wide
 * scope, exactly as it has until now (see utils/scope.js).
 *
 * ## The mapping file
 *
 * A JSON object of email → barangay name, which is what an SK federation secretary can actually
 * produce from their own records:
 *
 *   { "juan@boac.gov.ph": "Agot", "maria@boac.gov.ph": "Agot" }
 *
 * Each barangay is resolved WITHIN the user's own municipality, so a name that exists in two
 * municipalities cannot be mis-assigned, and a name that does not exist there is reported rather
 * than created.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Barangay = require('../src/models/Barangay');
const Municipality = require('../src/models/Municipality');
const { BARANGAY_BOUND_ROLES } = require('../src/utils/scope');

const APPLY = process.argv.includes('--apply');
/*
 * By default an account that already has a barangay is left alone, so re-running the script is safe
 * and never silently moves somebody. `--reassign` opts into correcting one — which the first pass
 * over real accounts needs more often than not, because the barangay an officer actually serves is
 * usually learned after the first guess, not before it.
 */
const REASSIGN = process.argv.includes('--reassign');
const mapArg = process.argv.find((a) => a.startsWith('--map='));

const loadMapping = () => {
  if (!mapArg) return null;
  const file = path.resolve(mapArg.slice('--map='.length));
  if (!fs.existsSync(file)) {
    console.error(`Mapping file not found: ${file}`);
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Normalised, because the mapping is typed by hand and User.email is stored lowercase.
    return Object.fromEntries(Object.entries(parsed).map(([email, brgy]) => [email.trim().toLowerCase(), String(brgy).trim()]));
  } catch (err) {
    console.error(`Mapping file is not valid JSON: ${err.message}`);
    process.exit(1);
  }
};

const run = async () => {
  const mapping = loadMapping();

  await mongoose.connect(process.env.MONGO_URI);
  const dbName = mongoose.connection.name;
  console.log(`\nConnected to "${dbName}"`);
  console.log(APPLY ? 'Mode: APPLY (writes)' : 'Mode: dry run (no writes)');

  const accounts = await User.find({ role: { $in: BARANGAY_BOUND_ROLES }, deletedAt: null })
    .select('firstName lastName email role municipality barangay')
    .populate('municipality', 'name')
    .populate('barangay', 'name')
    .lean();

  const assigned = accounts.filter((u) => u.barangay);
  const unassigned = accounts.filter((u) => !u.barangay);

  console.log(`\nBarangay-bound accounts: ${accounts.length}`);
  console.log(`  already assigned : ${assigned.length}`);
  console.log(`  unassigned       : ${unassigned.length}`);

  /*
   * With --reassign, an already-assigned account named in the mapping is considered too. One NOT
   * named is still left alone — the flag widens what the mapping may change, it does not turn the
   * mapping into the complete picture of who serves where.
   */
  const named = (u) => mapping && mapping[u.email] !== undefined && mapping[u.email] !== '';
  const movable = REASSIGN ? assigned.filter(named) : [];
  const untouched = assigned.filter((u) => !movable.includes(u));

  if (untouched.length > 0) {
    console.log(`\nAlready assigned (left untouched${REASSIGN ? ' — not named in the mapping' : ''}):`);
    untouched.forEach((u) => {
      console.log(`  ${u.email.padEnd(34)} ${u.role.padEnd(16)} ${u.municipality?.name || '—'} / ${u.barangay.name}`);
    });
  }

  if (REASSIGN && movable.length > 0) {
    console.log(`\nUp for reassignment (--reassign): ${movable.length}`);
  }

  // Resolve each candidate against the mapping, within its own municipality.
  const planned = [];
  const exceptions = [];

  for (const user of [...unassigned, ...movable]) {
    const municipalityName = user.municipality?.name || null;

    if (!user.municipality) {
      exceptions.push({ user, reason: 'no municipality on the account — assign one first' });
      continue;
    }

    const wanted = mapping ? mapping[user.email] : undefined;
    if (!wanted) {
      exceptions.push({ user, reason: mapping ? 'not named in the mapping file' : 'no mapping file supplied' });
      continue;
    }

    // Already where the mapping wants it: nothing to do, and worth saying so rather than
    // reporting a write that changes nothing.
    if (user.barangay && user.barangay.name?.toLowerCase() === wanted.toLowerCase()) {
      exceptions.push({ user, reason: `already in ${user.barangay.name} — unchanged` });
      continue;
    }

    const barangay = await Barangay.findOne({
      municipality: user.municipality._id,
      // Exact name, case-insensitive: "San Miguel" and "san miguel" are the same barangay, and the
      // unique index is on (name, municipality) so there can be only one match.
      name: new RegExp(`^${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    }).select('_id name');

    if (!barangay) {
      exceptions.push({ user, reason: `"${wanted}" is not a barangay of ${municipalityName}` });
      continue;
    }

    planned.push({ user, barangay });
  }

  if (planned.length > 0) {
    console.log(`\nTo assign (${planned.length}):`);
    planned.forEach(({ user, barangay }) => {
      // A move states what it is moving FROM. "→ Boac / Binunga" alone hides whether anything changed.
      const from = user.barangay ? `${user.barangay.name} → ` : '';
      console.log(`  ${user.email.padEnd(34)} ${user.municipality.name} / ${from}${barangay.name}`);
    });
  }

  if (exceptions.length > 0) {
    console.log(`\n⚠️  Migration exceptions (${exceptions.length}) — NOT assigned, and nothing is guessed:`);
    // The municipality is printed because it is what the mapping is filled in against: a barangay
    // name is only meaningful inside one, and that is where this resolves it.
    exceptions.forEach(({ user, reason }) => {
      const where = user.municipality?.name || 'no municipality';
      console.log(`  ${user.email.padEnd(34)} ${user.role.padEnd(16)} ${where.padEnd(12)} ${reason}`);
    });
    console.log('\n  These accounts keep municipality-wide scope, which is how they behave today.');
    console.log('  Assign them from Users → Assign barangay, or add them to the mapping file.');
  }

  if (APPLY && planned.length > 0) {
    let written = 0;
    for (const { user, barangay } of planned) {
      await User.updateOne({ _id: user._id }, { $set: { barangay: barangay._id } });
      written += 1;
    }
    console.log(`\n✅ Assigned ${written} account${written === 1 ? '' : 's'}.`);
  } else if (planned.length > 0) {
    console.log('\nDry run — nothing written. Re-run with --apply to assign the rows above.');
  }

  /*
   * Records are deliberately NOT back-filled. A programme, youth member, expense or document with no
   * barangay is a municipality-level record and stays readable by the whole municipality; inventing
   * a barangay for it would move real data into a scope somebody chose at random.
   */
  const municipalities = await Municipality.countDocuments({});
  const barangays = await Barangay.countDocuments({});
  console.log(`\nReference data: ${municipalities} municipalities, ${barangays} barangays.`);
  console.log('Existing records are left with no barangay on purpose — they stay municipality-level.\n');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('\nMigration failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
