/**
 * One-time migration: retire the `public_user` role.
 *
 * The role granted strictly less than being signed out — `/portal` and every `/api/public/*`
 * endpoint are open to anyone — so the accounts are deactivated rather than converted. Turning
 * them into `youth` would be wrong: a youth login is expected to have a matching YouthMember
 * registry record, and these have none.
 *
 * RUN THIS BEFORE DEPLOYING the enum change. Once `public_user` is removed from the ROLES enum,
 * any surviving document carrying it fails validation the next time anything saves it — a
 * landmine that only goes off when someone edits an old record.
 *
 * Deactivating rather than deleting keeps the audit trail intact: AuditLog rows reference these
 * users, and deleting the accounts would leave those entries pointing at nothing.
 *
 * Usage:
 *   node scripts/migrate-remove-public-user.js           # report only, changes nothing
 *   node scripts/migrate-remove-public-user.js --apply   # perform the migration
 */
require('dotenv').config();
const mongoose = require('mongoose');

const RETIRED_ROLE = 'public_user';

async function run() {
  const apply = process.argv.includes('--apply');

  await mongoose.connect(process.env.MONGO_URI);
  const users = mongoose.connection.db.collection('users');

  const affected = await users
    .find({ role: RETIRED_ROLE }, { projection: { email: 1, firstName: 1, lastName: 1, isActive: 1 } })
    .toArray();

  if (affected.length === 0) {
    console.log(`No accounts carry the ${RETIRED_ROLE} role. Nothing to migrate.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`${affected.length} account(s) carry the ${RETIRED_ROLE} role:`);
  affected.forEach((u) => console.log(`   ${u.email}  (${u.firstName} ${u.lastName})  active=${u.isActive !== false}`));

  if (!apply) {
    console.log('\nDry run — nothing changed. Re-run with --apply to migrate.');
    console.log('Each account will be deactivated and its role cleared, so it can no longer sign in.');
    console.log('The people behind them lose nothing: the portal never required an account.');
    await mongoose.disconnect();
    return;
  }

  /*
   * Written through the driver, not the model, deliberately — the model's enum no longer contains
   * the old value, so a Mongoose-level update would reject the very documents this exists to fix.
   */
  const result = await users.updateMany(
    { role: RETIRED_ROLE },
    {
      $set: {
        isActive: false,
        deactivatedReason: 'The public_user role was retired; the transparency portal needs no account.',
        deactivatedAt: new Date(),
      },
      $unset: { role: '' },
    },
  );

  console.log(`\nDeactivated ${result.modifiedCount} account(s) and cleared the retired role.`);
  console.log(`Note: these documents now have NO role. That is intentional — they cannot sign in,`);
  console.log(`and assigning one is a deliberate admin action rather than an automatic upgrade.`);

  const remaining = await users.countDocuments({ role: RETIRED_ROLE });
  if (remaining > 0) throw new Error(`${remaining} document(s) still carry ${RETIRED_ROLE} — migration incomplete`);
  console.log('Verified: no document carries the retired role.');

  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
