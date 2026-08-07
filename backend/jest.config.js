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
   * cap (six workers here) failed roughly two runs in three; four is much better but is a
   * mitigation, not a fix — it has still been observed failing about one run in six, always with
   * the same buffering timeout and never with a real assertion failure.
   *
   * `npx jest --runInBand` is the deterministic option and has not been seen to fail; use it when
   * a green run actually matters. The real fix is one shared MongoMemoryServer across suites via
   * globalSetup instead of one per suite, which is a larger change to the harness than this
   * branch should carry.
   */
  maxWorkers: 4,
};
