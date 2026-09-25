/**
 * Read-only dump of every collection to JSON. Writes nothing to the database, ever.
 *
 *   node scripts/dump-collections.js                 # -> ../scratchpad/dump-<timestamp>/
 *   node scripts/dump-collections.js --out=../backups/pre-seed
 *
 * The companion to `preflight-seed.js`. That one answers "would a seed lose anything real?"; this
 * one is what makes the answer survivable. `npm run seed` deletes eleven collections, and locally
 * — pointed at the shared cluster — nothing stops it.
 *
 * The protocol, which has worked three times and was skipped once at a cost of five real mutations:
 *
 *   1. node scripts/preflight-seed.js      # what would be lost, named
 *   2. node scripts/dump-collections.js    # this
 *   3. npm run seed
 *   4. node scripts/audit-integrity.js     # expect 0 findings
 *
 * The dump holds password hashes and real people's email addresses. It is written outside the repo
 * tree by default and the scratchpad rule in .gitignore covers it — keep it that way.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const outArg = process.argv.find((a) => a.startsWith('--out='));

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // A timestamped directory, so two dumps on the same day cannot overwrite each other — the second
  // one is usually the one taken in a hurry.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(outArg ? outArg.slice('--out='.length) : `../scratchpad/dump-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\nConnected to "${mongoose.connection.name}" — READ ONLY.`);
  console.log(`Writing to ${outDir}\n`);

  // Every collection actually present, not a hardcoded list: a collection added later would
  // otherwise be silently left out of the backup that exists to be complete.
  const collections = (await db.listCollections().toArray()).map((c) => c.name).sort();

  let total = 0;
  const manifest = {};

  for (const name of collections) {
    const docs = await db.collection(name).find({}).toArray();
    const file = path.join(outDir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(docs, null, 2));
    manifest[name] = docs.length;
    total += docs.length;
    console.log(`   ${name.padEnd(18)} ${String(docs.length).padStart(5)}  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
  }

  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify({
    database: mongoose.connection.name,
    takenAt: new Date().toISOString(),
    collections: manifest,
    totalDocuments: total,
  }, null, 2));

  console.log(`\n${total} documents across ${collections.length} collections.`);
  console.log(`Restore is a mongoimport per file, or a small script — the JSON keeps its _id values.\n`);

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('\nDump failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
