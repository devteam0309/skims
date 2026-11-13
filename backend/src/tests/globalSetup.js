/**
 * Start ONE in-memory MongoDB for the whole run.
 *
 * Previously every suite called `MongoMemoryServer.create()` in its own `beforeAll`, so a full run
 * started one mongod per suite — thirty-five of them, serially, each with its own startup cost.
 * Past roughly twenty-five the machine could no longer bring one up inside Mongoose's 10s
 * buffering window, and whichever suite happened to be unlucky failed on `buffering timed out` in
 * clearDB. The suite that failed moved between runs and always passed when run alone, which is the
 * worst kind of red to chase: it looks like a regression in whatever you last touched.
 *
 * `--runInBand` reduced the odds but never removed them — it was hit three times in one session.
 *
 * It is a single-node REPLICA SET rather than a standalone server. Financial approvals run inside a
 * multi-document transaction (see utils/transaction.js), and MongoDB only supports transactions on
 * a replica set. Atlas — what production and local development both use — is one, so a standalone
 * test server would exercise only the fallback path and never the one that actually runs.
 *
 * The URI is handed to the workers through a global, and to the (separate) worker processes
 * through an environment variable, which is the only channel Jest guarantees between the two.
 */
const { MongoMemoryReplSet } = require('mongodb-memory-server');

module.exports = async () => {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await replSet.waitUntilRunning();

  // Read back in globalTeardown, which runs in this same process.
  global.__MONGOD__ = replSet;

  // Read by src/tests/setup.js inside each worker, which is a different process.
  process.env.MONGO_TEST_URI = replSet.getUri();
};
