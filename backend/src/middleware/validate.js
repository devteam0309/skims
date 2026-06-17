const { validationResult } = require('express-validator');

const validate = (chains) => async (req, res, next) => {
  await Promise.all(chains.map((chain) => chain.run(req)));
  const errors = validationResult(req);
  if (errors.isEmpty()) return next();
  const first = errors.array()[0];
  return res.status(422).json({ success: false, message: first.msg, errors: errors.array() });
};

module.exports = validate;
