/**
 * Fire-and-forget email for a workflow event.
 *
 * Mail is a courtesy on top of the in-app notification and must never decide the response: a
 * transport failure, or a template that does not exist (several suites mock emailService with only
 * the functions they assert on), is swallowed here instead of turning a completed approval into a
 * 500 for an action that already happened.
 */
const emailService = require('../services/emailService');

const sendQuietly = (template, ...args) => {
  try {
    const send = emailService[template];
    if (typeof send !== 'function') return;
    Promise.resolve(send(...args)).catch(() => {});
  } catch {
    // Deliberately swallowed — see above.
  }
};

module.exports = { sendQuietly };
