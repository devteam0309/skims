/**
 * Read-only pre-flight for `npm run seed`. Writes nothing, ever.
 *
 *   node scripts/preflight-seed.js
 *
 * ## Why this exists as a script
 *
 * `npm run seed` deletes eleven collections, and its guard only trips when `NODE_ENV=production` —
 * local development points at the shared Atlas cluster, so locally it is unguarded. The warning
 * "this wipes eleven collections" is not enough to say yes or no to, because it does not say whether
 * anything real is in there. That question has been answered by a hand-typed one-liner every time it
 * came up; getting it wrong once already cost five real mutations.
 *
 * So: what would be lost, named, before anyone decides.
 *
 * ## How "since the last seed" is established
 *
 * The seeder recreates every user, so the OLDEST user's `createdAt` is the moment the last seed ran.
 * Anything in the audit log after that timestamp happened afterwards — a real action by a real person.
 * `auditlogs` and `counters` are not in the seeder's delete list, which is why the audit trail can
 * still describe what a previous seed removed.
 */
require('dotenv').config();
const mongoose = require('mongoose');

/* Every collection the seeder empties, plus the two it leaves alone (marked). */
const COLLECTIONS = [
  'users', 'municipalities', 'barangays', 'programs', 'budgets', 'expenses',
  'liquidations', 'documents', 'youthmembers', 'announcements', 'notifications',
  'auditlogs', 'counters',
];
const SURVIVES_SEED = new Set(['auditlogs', 'counters']);

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  console.log(`\nConnected to "${mongoose.connection.name}" — READ ONLY, nothing is written.\n`);

  const oldest = await db.collection('users').find().sort({ createdAt: 1 }).limit(1).toArray();
  if (oldest.length === 0) {
    console.log('No users at all — the database looks empty. A seed would lose nothing.\n');
    await mongoose.disconnect();
    return;
  }

  const seededAt = oldest[0].createdAt;
  console.log(`Last seed, inferred from the oldest user: ${seededAt.toISOString()}`);

  const since = { createdAt: { $gt: seededAt } };

  /*
   * Logins are excluded. They are the bulk of the audit trail and losing the record of one costs
   * nothing; what matters is whether anybody CHANGED something.
   */
  const mutations = await db.collection('auditlogs')
    .aggregate([
      { $match: { ...since, action: { $ne: 'LOGIN' } } },
      { $group: { _id: { action: '$action', resource: '$resource' }, n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]).toArray();

  const total = mutations.reduce((sum, m) => sum + m.n, 0);
  console.log(`\nReal mutations since then: ${total}`);
  mutations.forEach((m) => {
    console.log(`   ${String(m.n).padStart(3)}  ${m._id.action} ${m._id.resource || ''}`);
  });

  // Accounts are the loss that cannot be reconstructed from an audit entry — a password is gone.
  const newAccounts = await db.collection('users')
    .find(since).project({ email: 1, role: 1, createdAt: 1, isApproved: 1 }).toArray();

  console.log(`\nAccounts registered since then: ${newAccounts.length}`);
  newAccounts.forEach((u) => {
    const seeded = u.email.endsWith('.gov.ph') || u.email.endsWith('@example.com');
    console.log(`   ${u.createdAt.toISOString().slice(0, 10)}  ${u.email.padEnd(34)} ${String(u.role).padEnd(16)}`
      + `${seeded ? 'looks seeded' : 'REAL REGISTRATION'}`);
  });

  console.log('\nCollection sizes (✱ = survives a seed):');
  for (const name of COLLECTIONS) {
    const count = await db.collection(name).countDocuments();
    console.log(`   ${SURVIVES_SEED.has(name) ? '✱' : ' '} ${name.padEnd(16)} ${count}`);
  }

  const risky = newAccounts.filter((u) => !(u.email.endsWith('.gov.ph') || u.email.endsWith('@example.com')));
  console.log('');
  if (total === 0 && risky.length === 0) {
    console.log('VERDICT: nothing real has happened since the last seed. A re-seed loses nothing.');
  } else {
    console.log('VERDICT: a re-seed would DESTROY the above.');
    if (risky.length > 0) {
      console.log(`   ${risky.length} account${risky.length === 1 ? '' : 's'} registered by a real person would be deleted,`);
      console.log('   including their password — an audit entry cannot bring those back.');
    }
    console.log('   Dump every collection first, and get an explicit yes from the owner.');
  }
  console.log('');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('\nPre-flight failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
