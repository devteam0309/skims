const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const createTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: { user: process.env.SMTP_EMAIL, pass: process.env.SMTP_PASSWORD },
});

const sendEmail = async ({ to, subject, html }) => {
  const transporter = createTransporter();
  const mailOptions = {
    from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
    to,
    subject,
    html,
  };
  try {
    await transporter.sendMail(mailOptions);
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (error) {
    logger.error(`Email failed to ${to}: ${error.message}`);
    throw error;
  }
};

exports.sendEmailVerification = async (user, token) => {
  const url = `${process.env.CLIENT_URL}/verify-email/${token}`;
  await sendEmail({
    to: user.email,
    subject: 'SKIMS — Verify Your Email Address',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f8f9fa;padding:40px 20px">
        <div style="background:#1e3a5f;padding:30px;text-align:center;border-radius:8px 8px 0 0">
          <h1 style="color:#f5c518;margin:0;font-size:24px">SKIMS</h1>
          <p style="color:#ffffff;margin:5px 0;font-size:12px">Sangguniang Kabataan Integrated Management System</p>
        </div>
        <div style="background:#ffffff;padding:30px;border-radius:0 0 8px 8px">
          <h2 style="color:#1e3a5f">Hello, ${esc(user.firstName)}!</h2>
          <p style="color:#555">Please verify your email address to activate your SKIMS account.</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${url}" style="background:#1e3a5f;color:#f5c518;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:16px">Verify Email Address</a>
          </div>
          <p style="color:#888;font-size:12px">This link expires in 24 hours. If you did not register, ignore this email.</p>
        </div>
      </div>
    `,
  });
};

exports.sendPasswordReset = async (user, token) => {
  const url = `${process.env.CLIENT_URL}/reset-password/${token}`;
  await sendEmail({
    to: user.email,
    subject: 'SKIMS — Password Reset Request',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1e3a5f;padding:30px;text-align:center">
          <h1 style="color:#f5c518;margin:0">SKIMS</h1>
        </div>
        <div style="padding:30px;background:#fff">
          <h2>Password Reset Request</h2>
          <p>Hello ${esc(user.firstName)}, click below to reset your password. This link expires in 10 minutes.</p>
          <div style="text-align:center;margin:30px 0">
            <a href="${url}" style="background:#1e3a5f;color:#f5c518;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold">Reset Password</a>
          </div>
          <p style="color:#888;font-size:12px">If you did not request this, please ignore and secure your account.</p>
        </div>
      </div>
    `,
  });
};

const header = `<div style="background:#1e3a5f;padding:24px;text-align:center"><h1 style="color:#f5c518;margin:0;font-size:22px">SKIMS</h1><p style="color:#fff;margin:4px 0;font-size:11px">Sangguniang Kabataan Integrated Management System</p></div>`;
const wrap = (body) => `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">${header}<div style="padding:30px;background:#fff">${body}</div></div>`;
const btn = (url, label) => `<div style="text-align:center;margin:28px 0"><a href="${url}" style="background:#1e3a5f;color:#f5c518;padding:13px 28px;text-decoration:none;border-radius:6px;font-weight:bold">${label}</a></div>`;

exports.sendApprovalNotification = async (user) => {
  await sendEmail({
    to: user.email,
    subject: 'SKIMS — Your Account Has Been Approved',
    html: wrap(`
      <h2 style="color:#1e3a5f">Account Approved!</h2>
      <p>Hello ${esc(user.firstName)}, your SKIMS account has been approved. You can now log in.</p>
      ${btn(`${process.env.CLIENT_URL}/login`, 'Login Now')}
    `),
  });
};

exports.sendBudgetApproved = async (user, budget) => {
  await sendEmail({
    to: user.email,
    subject: `SKIMS — Budget Approved: ${budget.title}`,
    html: wrap(`
      <h2 style="color:#1e3a5f">Budget Approved</h2>
      <p>Hello ${esc(user.firstName)}, your budget <strong>${esc(budget.title)}</strong> (FY ${budget.fiscalYear}) has been approved.</p>
      <p style="color:#555">Approved Amount: <strong>₱${Number(budget.totalBudget || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></p>
      ${btn(`${process.env.CLIENT_URL}/budgets`, 'View Budget')}
    `),
  });
};

exports.sendBudgetRejected = async (user, budget, reason) => {
  await sendEmail({
    to: user.email,
    subject: `SKIMS — Budget Rejected: ${budget.title}`,
    html: wrap(`
      <h2 style="color:#c0392b">Budget Rejected</h2>
      <p>Hello ${esc(user.firstName)}, your budget <strong>${esc(budget.title)}</strong> (FY ${budget.fiscalYear}) has been rejected.</p>
      ${reason ? `<p style="color:#555">Reason: <em>${esc(reason)}</em></p>` : ''}
      ${btn(`${process.env.CLIENT_URL}/budgets`, 'View Budgets')}
    `),
  });
};

exports.sendExpenseApproved = async (user, expense) => {
  await sendEmail({
    to: user.email,
    subject: `SKIMS — Expense Approved: ${expense.referenceNumber}`,
    html: wrap(`
      <h2 style="color:#1e3a5f">Expense Approved</h2>
      <p>Hello ${esc(user.firstName)}, your expense <strong>${esc(expense.title)}</strong> (${esc(expense.referenceNumber)}) has been approved.</p>
      <p style="color:#555">Amount: <strong>₱${Number(expense.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></p>
      ${btn(`${process.env.CLIENT_URL}/expenses`, 'View Expenses')}
    `),
  });
};

exports.sendLiquidationApproved = async (user, liquidation) => {
  await sendEmail({
    to: user.email,
    subject: `SKIMS — Liquidation Approved: ${liquidation.referenceNumber}`,
    html: wrap(`
      <h2 style="color:#1e3a5f">Liquidation Report Approved</h2>
      <p>Hello ${esc(user.firstName)}, your liquidation report <strong>${esc(liquidation.title)}</strong> (${esc(liquidation.referenceNumber)}) has been approved.</p>
      <p style="color:#555">Total Amount: <strong>₱${Number(liquidation.totalAmount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></p>
      ${btn(`${process.env.CLIENT_URL}/liquidations`, 'View Liquidations')}
    `),
  });
};

exports.sendLiquidationRejected = async (user, liquidation, reason) => {
  await sendEmail({
    to: user.email,
    subject: `SKIMS — Liquidation Rejected: ${liquidation.referenceNumber}`,
    html: wrap(`
      <h2 style="color:#c0392b">Liquidation Report Rejected</h2>
      <p>Hello ${esc(user.firstName)}, your liquidation report <strong>${esc(liquidation.title)}</strong> (${esc(liquidation.referenceNumber)}) has been rejected.</p>
      ${reason ? `<p style="color:#555">Reason: <em>${esc(reason)}</em></p>` : ''}
      ${btn(`${process.env.CLIENT_URL}/liquidations`, 'View Liquidations')}
    `),
  });
};
