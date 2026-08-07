module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/tests/**/*.test.js'],
  forceExit: true,
  testTimeout: 30000,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/src/tests/'],
  /*
   * Only affects running `jest` directly — `npm test` passes --runInBand, which overrides this
   * and is what CI uses. That path is deterministic and has not been seen to fail.
   *
   * It matters for the bare invocation because each suite stands up its own MongoMemoryServer
   * (see src/tests/setup.js), so concurrent mongod processes track the worker count. Left
   * uncapped that is CPUs-1, and past roughly twenty-five suites the machine can no longer bring
   * them all up inside Mongoose's 10s buffering window; suites then fail on `deleteMany()
   * buffering timed out` in clearDB — a resource limit, unrelated to anything under test, and
   * intermittent, which is the worst kind of red to chase.
   *
   * Four is a mitigation rather than a fix: uncapped and at '50%' (six here) it failed roughly
   * two runs in three, at four about one in six. Prefer `npm test`. The real fix is one shared
   * server across suites via globalSetup instead of one per suite, which is a larger change to
   * the harness than this branch should carry.
   */
  maxWorkers: 4,
};
