/**
 * One-time migration: mark all existing users as email-verified.
 * Run ONCE after deploying the isEmailVerified login gate to avoid
 * locking out users created before email verification was enforced.
 *
 * Usage: node scripts/migrate-email-verification.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const result = await mongoose.connection.db.collection('users').updateMany(
    { isEmailVerified: { $ne: true } },
    { $set: { isEmailVerified: true } }
  );
  console.log(`Updated ${result.modifiedCount} users → isEmailVerified: true`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
