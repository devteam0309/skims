require('dotenv').config();
const app = require('./src/app');
const connectDB = require('./src/config/database');
const logger = require('./src/utils/logger');
const cron = require('node-cron');
const notificationService = require('./src/services/notificationService');

connectDB();

cron.schedule('0 8 * * *', async () => {
  logger.info('Running daily deadline reminders...');
  await notificationService.sendDeadlineReminders();
});

cron.schedule('0 */6 * * *', async () => {
  logger.info('Running compliance check...');
  await notificationService.checkComplianceAlerts();
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  logger.info(`SKIMS API running in ${process.env.NODE_ENV} mode on port ${PORT}`);
});

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});

module.exports = app;
