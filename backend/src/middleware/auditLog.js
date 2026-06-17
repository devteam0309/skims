const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

const createAuditLog = (action, resource) => async (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (data) {
    if (data && data.success) {
      AuditLog.create({
        user: req.user?._id,
        action,
        resource,
        resourceId: req.params?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        municipality: req.user?.municipality,
        status: 'success',
      }).catch((err) => logger.error(`Audit log error: ${err.message}`));
    }
    return originalJson(data);
  };
  next();
};

module.exports = createAuditLog;
