const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const User = require('../models/User');
const Notification = require('../models/Notification');

// A mail host that accepts the connection but never answers (Render's free tier blocks outbound
// SMTP, so nodemailer sits until its connection timeout). Registration must not wait on it.
const neverResolves = () => new Promise(() => {});

jest.mock('../services/emailService', () => ({
  sendEmailVerification: jest.fn(),
  sendPasswordReset: jest.fn().mockResolvedValue({}),
  sendApprovalNotification: jest.fn().mockResolvedValue({}),
  sendWelcomeEmail: jest.fn().mockResolvedValue({}),
}));
const emailService = require('../services/emailService');

jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const logger = require('../utils/logger');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

describe('email sending never blocks the HTTP response', () => {
  it('POST /register returns 201 even when the mail send hangs', async () => {
    emailService.sendEmailVerification.mockImplementation(neverResolves);

    const res = await request(app).post('/api/auth/register').send({
      firstName: 'Hang', lastName: 'Test', email: 'hang@example.com',
      password: 'Test@1234', role: 'public_user',
    });

    expect(res.status).toBe(201);
    expect(emailService.sendEmailVerification).toHaveBeenCalled();

    // The account and its verification token must still be persisted.
    const user = await User.findOne({ email: 'hang@example.com' }).select('+emailVerificationToken');
    expect(user).not.toBeNull();
    expect(user.isEmailVerified).toBe(false);
    expect(user.emailVerificationToken).toBeTruthy();
  });

  it('POST /register still returns 201 when the mail send rejects', async () => {
    emailService.sendEmailVerification.mockRejectedValue(new Error('ETIMEDOUT'));

    const res = await request(app).post('/api/auth/register').send({
      firstName: 'Reject', lastName: 'Test', email: 'reject@example.com',
      password: 'Test@1234', role: 'public_user',
    });

    expect(res.status).toBe(201);
    expect(await User.findOne({ email: 'reject@example.com' })).not.toBeNull();
  });

  /*
   * Not blocking is not the same as not caring. Login is gated on isEmailVerified, so a send that
   * fails leaves an account that can never be used while the API still says "check your email".
   * Before this, the controller's .catch(() => {}) discarded the failure entirely and the only
   * trace was a transport-level line that never mentioned the consequence.
   */
  it('logs which account was left unverified when the send rejects', async () => {
    emailService.sendEmailVerification.mockRejectedValue(new Error('ETIMEDOUT'));
    logger.warn.mockClear();

    await request(app).post('/api/auth/register').send({
      firstName: 'Silent', lastName: 'Failure', email: 'silent@example.com',
      password: 'Test@1234', role: 'public_user',
    });

    // The rejection is handled off the request path, so let the microtask queue drain.
    await new Promise((resolve) => setImmediate(resolve));

    const warning = logger.warn.mock.calls.map(([m]) => m).find((m) => m.includes('silent@example.com'));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/cannot log in/i);
  });

  it('POST /resend-verification returns 200 even when the mail send hangs', async () => {
    emailService.sendEmailVerification.mockResolvedValue({});
    await request(app).post('/api/auth/register').send({
      firstName: 'Resend', lastName: 'Test', email: 'resend@example.com',
      password: 'Test@1234', role: 'public_user',
    });

    emailService.sendEmailVerification.mockImplementation(neverResolves);
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'resend@example.com' });

    expect(res.status).toBe(200);
  });
});

/*
 * The approval notifications register() fans out to admins were created with insertMany, which
 * bypasses the pre-save hook that sets expiresAt — so the TTL index on that field had nothing to
 * act on and they accumulated permanently. Same class of bug the Notification.createWithExpiry
 * helper was written for.
 */
describe('admin approval notifications carry a TTL', () => {
  it('sets expiresAt on the notifications raised by a role that needs approval', async () => {
    emailService.sendEmailVerification.mockResolvedValue({});
    await User.create({
      firstName: 'Admin', lastName: 'User', email: 'admin@example.com',
      password: 'Test@1234', role: 'super_admin', isApproved: true, isEmailVerified: true,
    });

    const res = await request(app).post('/api/auth/register').send({
      firstName: 'Needs', lastName: 'Approval', email: 'kagawad@example.com',
      password: 'Test@1234', role: 'sk_kagawad',
    });
    expect(res.status).toBe(201);

    const notifications = await Notification.find({ type: 'approval_request' });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].expiresAt).toBeInstanceOf(Date);
    expect(notifications[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
