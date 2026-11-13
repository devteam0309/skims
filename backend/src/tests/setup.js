const mongoose = require('mongoose');

/*
 * Connects to the ONE server started in globalSetup, rather than standing up a new mongod per
 * suite. Each suite still gets a clean slate through clearDB(); isolation comes from emptying the
 * collections between tests, not from a private server.
 *
 * A missing URI means the suite was run without the Jest config (a bare `jest --config ...` or a
 * stray runner). Failing loudly beats silently starting a second server and half-working.
 */
const uri = () => {
  if (!process.env.MONGO_TEST_URI) {
    throw new Error('MONGO_TEST_URI is unset — tests must run through jest.config.js, which starts the shared server in globalSetup.');
  }
  return process.env.MONGO_TEST_URI;
};

const connect = async () => {
  process.env.JWT_SECRET = 'skims-test-secret-key-for-testing-only';
  process.env.NODE_ENV = 'test';
  // Uploads are kept in memory: no suite needs Cloudinary credentials, and none can reach the real
  // account. Records created directly in the database without a storageType still exercise the
  // legacy (public Cloudinary) path, which is what the suites mocking config/cloudinary rely on.
  process.env.FILE_STORAGE_DRIVER = 'memory';
  /*
   * Every worker uses its own database on the shared server, so suites running in parallel cannot
   * see each other's rows — clearDB() in one would otherwise wipe another mid-test.
   */
  const db = `skims_test_${process.env.JEST_WORKER_ID || '1'}`;
  await mongoose.connect(uri(), { dbName: db });
};

const disconnect = async () => {
  // The server itself outlives the suite and is stopped once, in globalTeardown.
  await mongoose.disconnect();
};

const clearDB = async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
};

module.exports = { connect, disconnect, clearDB };
