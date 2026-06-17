const Notification = require('../models/Notification');
const Program = require('../models/Program');
const Liquidation = require('../models/Liquidation');
const User = require('../models/User');
const logger = require('../utils/logger');

exports.createNotification = async ({ recipient, type, title, message, link, priority = 'medium', data }) => {
  try {
    return await Notification.create({ recipient, type, title, message, link, priority, data });
  } catch (error) {
    logger.error(`Notification creation failed: ${error.message}`);
  }
};

exports.sendDeadlineReminders = async () => {
  const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const today = new Date();

  const upcomingPrograms = await Program.find({
    endDate: { $gte: today, $lte: threeDaysFromNow },
    status: { $nin: ['completed', 'cancelled'] },
    deletedAt: null,
  }).populate('createdBy assignedOfficers');

  for (const program of upcomingPrograms) {
    const recipients = [program.createdBy, ...program.assignedOfficers].filter(Boolean);
    for (const user of recipients) {
      await Notification.create({
        recipient: user._id || user,
        type: 'deadline_reminder',
        title: 'Program Deadline Approaching',
        message: `Program "${program.title}" is due in ${Math.ceil((new Date(program.endDate) - today) / (1000 * 60 * 60 * 24))} day(s).`,
        link: `/programs/${program._id}`,
        priority: 'high',
      });
    }
  }

  const overdueLiquidations = await Liquidation.find({
    dueDate: { $lt: today },
    status: { $nin: ['approved'] },
    deletedAt: null,
  }).populate('submittedBy');

  for (const liq of overdueLiquidations) {
    if (liq.submittedBy) {
      await Notification.create({
        recipient: liq.submittedBy._id,
        type: 'liquidation_due',
        title: 'Overdue Liquidation Report',
        message: `Liquidation "${liq.referenceNumber}" is overdue. Please submit immediately.`,
        link: `/liquidations/${liq._id}`,
        priority: 'urgent',
      });
    }
  }

  logger.info(`Deadline reminders sent for ${upcomingPrograms.length} programs and ${overdueLiquidations.length} liquidations`);
};

exports.checkComplianceAlerts = async () => {
  const delayedPrograms = await Program.find({
    endDate: { $lt: new Date() },
    status: { $nin: ['completed', 'cancelled'] },
    deletedAt: null,
  }).populate('createdBy assignedOfficers municipality');

  for (const program of delayedPrograms) {
    if (program.status !== 'delayed') {
      program.status = 'delayed';
      await program.save();
    }
  }

  logger.info(`Compliance check: ${delayedPrograms.length} delayed programs updated`);
};
