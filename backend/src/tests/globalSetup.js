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
 * The URI is handed to the workers through a global, and to the (separate) worker processes
 * through an environment variable, which is the only channel Jest guarantees between the two.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');

module.exports = async () => {
  const mongod = await MongoMemoryServer.create();

  // Read back in globalTeardown, which runs in this same process.
  global.__MONGOD__ = mongod;

  // Read by src/tests/setup.js inside each worker, which is a different process.
  process.env.MONGO_TEST_URI = mongod.getUri();
};
