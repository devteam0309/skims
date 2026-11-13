/**
 * Run several writes as one unit.
 *
 * Approving money touches more than one document: the expense changes status, the budget it is
 * charged to is deducted, and the programme it belongs to records the spend. Done as separate
 * writes, a failure between them leaves an approved expense the budget never heard about — or a
 * deduction for an approval that did not happen. Inside a transaction they land together or not
 * at all.
 *
 * MongoDB supports transactions only on a replica set. Atlas is one, and so is the test server
 * (see tests/globalSetup.js). A standalone `mongod` — the docker-compose setup, for one — rejects
 * the first operation of a transaction with IllegalOperation before anything is written, so the
 * work is simply run again without a session. Callers write their steps so that order alone keeps
 * the data safe in that mode (claim the record's state first, deduct after, undo the claim if the
 * deduction is refused); the transaction then adds atomicity on top rather than being the only
 * line of defence.
 *
 * `work` receives the session (or null in the fallback) and must pass `{ session }` to every
 * operation it performs. Errors it throws abort the transaction and propagate unchanged.
 */
const mongoose = require('mongoose');

const transactionsUnsupported = (err) =>
  err?.code === 20 ||
  err?.codeName === 'IllegalOperation' ||
  /Transaction numbers are only allowed on a replica set member or mongos/i.test(err?.message || '');

const withTransaction = async (work) => {
  let session;
  try {
    session = await mongoose.startSession();
  } catch (err) {
    return work(null);
  }

  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    if (transactionsUnsupported(err)) return work(null);
    throw err;
  } finally {
    await session.endSession();
  }
};

/** `{ session }` when there is one, `{}` otherwise — so call sites read the same in both modes. */
const sessionOpts = (session) => (session ? { session } : {});

/** An error that carries the HTTP status a controller should answer with. */
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

module.exports = { withTransaction, sessionOpts, httpError, transactionsUnsupported };
