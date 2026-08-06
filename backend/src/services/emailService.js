const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Project currency convention: explicit ₱ prefix and BOTH fraction digit bounds. Without
// maximumFractionDigits, toLocaleString defaults it to 3, so ₱1,234.567 reaches the recipient.
// Never use { style: 'currency', currency: 'PHP' } — it renders "PHP" in some Node builds.
const peso = (amount) =>
  `₱${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount) || 0)}`;

// Explicit timeouts matter: nodemailer defaults to a ~2 minute connection timeout, so a host that
// blocks outbound SMTP (Render's free tier blocks 25/465/587) leaves the socket hanging that long
// and ties up a worker. Fail fast and let the caller's .catch() log it instead.
const createTransporter = () => nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: { user: process.env.SMTP_EMAIL, pass: process.env.SMTP_PASSWORD },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

// Resend's API documents the plain `Name <addr>` form; SMTP keeps the quoted form it already used.
const resendFrom = () => `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`;
const smtpFrom = () => `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`;

// Resend is an HTTP API, so it works on hosts that block outbound SMTP ports (Render's free tier
// blocks 25/465/587 — see the SMTP timeout note above). Used whenever RESEND_API_KEY is present;
// otherwise we fall back to SMTP so local dev against Gmail keeps working unchanged.
const useResend = () => Boolean(process.env.RESEND_API_KEY);

// Until a sending domain is verified, Resend only accepts the account owner's own address as a
// recipient. RESEND_TO redirects every message there so the flow can be demoed end to end.
// MUST be unset once a real domain is verified — while it is set, real users never receive mail.
const resolveRecipient = (to) => {
  const override = process.env.RESEND_TO;
  if (!override || override === to) return to;
  logger.warn(`RESEND_TO override active: mail for ${to} redirected to ${override}`);
  return override;
};

const sendViaResend = async ({ to, subject, html }) => {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: resendFrom(), to: [resolveRecipient(to)], subject, html }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    // Resend returns { name, message } on failure. Surface the message so the cause is visible
    // in logs — an unverified sending domain is by far the most common one.
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) detail = `${body.message} (HTTP ${res.status})`;
    } catch (_) {}
    throw new Error(`Resend rejected the message: ${detail}`);
  }
};

const sendViaSmtp = async ({ to, subject, html }) => {
  await createTransporter().sendMail({ from: smtpFrom(), to, subject, html });
};

const sendEmail = async ({ to, subject, html }) => {
  const transport = useResend() ? 'resend' : 'smtp';
  try {
    await (transport === 'resend' ? sendViaResend : sendViaSmtp)({ to, subject, html });
    logger.info(`Email sent to ${to} via ${transport}: ${subject}`);
  } catch (error) {
    logger.error(`Email failed to ${to} via ${transport}: ${error.message}`);
    throw error;
  }
};

/**
 * Log the effective mail configuration at boot. Misconfiguration here is otherwise invisible
 * until the first send fails, which is easy to miss when sends are fire-and-forget. Never logs
 * the API key itself.
 */
exports.logConfig = () => {
  const from = process.env.FROM_EMAIL || '(unset)';
  if (!useResend()) {
    logger.info(`Email transport: SMTP via ${process.env.SMTP_HOST || '(unset)'} as ${from}`);
    logger.warn('Email transport is SMTP — this does NOT work on hosts that block outbound SMTP (e.g. Render free). Set RESEND_API_KEY to use Resend.');
    return;
  }

  logger.info(`Email transport: Resend, sending as ${from}`);

  const domain = from.split('@')[1];
  if (!domain) {
    logger.error('FROM_EMAIL is unset or malformed — every Resend send will be rejected.');
  } else if (domain !== 'resend.dev') {
    logger.warn(`FROM_EMAIL uses domain "${domain}" — Resend rejects this unless the domain is verified at resend.com/domains. Use onboarding@resend.dev until one is verified.`);
  }

  if (process.env.RESEND_TO) {
    logger.warn(`RESEND_TO is set to ${process.env.RESEND_TO} — ALL outgoing mail is redirected there and real recipients receive nothing. Unset it once a sending domain is verified.`);
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
      <p style="color:#555">Approved Amount: <strong>${peso(budget.totalBudget)}</strong></p>
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
      <p style="color:#555">Amount: <strong>${peso(expense.amount)}</strong></p>
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
      <p style="color:#555">Total Amount: <strong>${peso(liquidation.totalAmount)}</strong></p>
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
