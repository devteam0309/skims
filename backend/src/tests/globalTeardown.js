/**
 * Stop the shared in-memory MongoDB started by globalSetup.
 *
 * Runs in the same process as globalSetup, so the handle is still on `global`.
 */
module.exports = async () => {
  if (global.__MONGOD__) await global.__MONGOD__.stop();
};
