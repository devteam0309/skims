module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/tests/**/*.test.js'],
  forceExit: true,
  testTimeout: 30000,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/src/tests/'],

  /*
   * One in-memory MongoDB for the entire run, started here and stopped in globalTeardown.
   *
   * Each suite used to create its own inside `beforeAll`, so a full run started thirty-five
   * mongod processes. Past roughly twenty-five, the machine could no longer bring one up inside
   * Mongoose's 10s buffering window and whichever suite was unlucky failed on `buffering timed
   * out` in clearDB. The victim moved between runs and always passed alone — red that looks
   * exactly like a regression in whatever you last touched, and it cost three full runs in a
   * single session before being fixed properly.
   *
   * Suites are isolated by database name per worker (see src/tests/setup.js), not by having a
   * server each.
   */
  globalSetup: '<rootDir>/src/tests/globalSetup.js',
  globalTeardown: '<rootDir>/src/tests/globalTeardown.js',

  /*
   * Now that startup is paid once, parallel is both safe and much faster. `npm test` still passes
   * --runInBand, which overrides this and is what CI uses — kept because serial output is far
   * easier to read when something genuinely fails.
   */
  maxWorkers: '50%',
};
