module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/tests/**/*.test.js'],
  forceExit: true,
  testTimeout: 30000,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/src/tests/'],
  /*
   * Each suite stands up its own MongoMemoryServer (see src/tests/setup.js), so the number of
   * concurrent mongod processes is the number of Jest workers. Left uncapped that is CPUs-1 —
   * eleven here — and past roughly twenty-five suites the machine could no longer bring them all
   * up inside Mongoose's 10s buffering window. Suites then failed on `deleteMany() buffering
   * timed out` in clearDB: a resource limit, unrelated to anything under test, and reproducible
   * only sometimes, which is the worst kind of red build to chase.
   *
   * Capping workers bounds the concurrent servers instead of letting suite count decide. A '50%'
   * cap (six workers here) still failed roughly two runs in three; four is the first value that
   * ran clean three times consecutively, at a steady ~60s. The real fix is one shared server
   * across suites via globalSetup rather than one per suite, which is a larger change to the test
   * harness than this branch should carry.
   */
  maxWorkers: 4,
};
