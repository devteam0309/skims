const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  logger.error(`${err.message} - ${req.method} ${req.url} - IP: ${req.ip}`);

  /*
   * A cast failure means one of two very different things, and reporting both as 404 sent people
   * hunting for a deleted record when the real problem was a value they had just typed. An
   * uncastable `_id` is genuinely "no such record"; an uncastable *field* is a bad request, and
   * the response now names the field so the cause is visible rather than guessed at.
   *
   * This masked the programs create/edit failure completely: `budgetRef: ''` produced
   * "Resource not found", which reads as a missing program.
   */
  if (err.name === 'CastError') {
    if (err.path && err.path !== '_id') {
      return res.status(400).json({ success: false, message: `Invalid value for ${err.path}` });
    }
    return res.status(404).json({ success: false, message: 'Resource not found' });
  }

  // Mongoose duplicate key — do not echo the value to prevent user enumeration
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({ success: false, message: `${field} already exists` });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({ success: false, message: messages.join(', ') });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired' });
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'Server Error',
  });
};

module.exports = errorHandler;
