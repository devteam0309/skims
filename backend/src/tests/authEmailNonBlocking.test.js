const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const User = require('../models/User');

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
