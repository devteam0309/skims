const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const User = require('../models/User');

jest.mock('../services/emailService', () => ({
  sendEmailVerification: jest.fn().mockResolvedValue({}),
  sendPasswordReset: jest.fn().mockResolvedValue({}),
  sendApprovalNotification: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const PASSWORD = 'Test@1234';

const register = (email) =>
  request(app).post('/api/auth/register').send({
    firstName: 'Norm', lastName: 'Test', email, password: PASSWORD, role: 'dilg_representative',
  });

const login = (email) =>
  request(app).post('/api/auth/login').send({ email, password: PASSWORD });

/**
 * registerValidation applies normalizeEmail(), which strips Gmail dots/+tags and lowercases.
 * Every other email lookup must normalize identically or it will miss the stored record.
 * Regression: login used to omit it, so a Gmail user who typed dots could never sign in.
 */
describe('email normalization is consistent between register and lookup routes', () => {
  it('stores a dotted Gmail address in normalized form', async () => {
    const res = await register('john.doe@gmail.com');
    expect(res.status).toBe(201);

    const user = await User.findOne({ email: 'johndoe@gmail.com' });
    expect(user).not.toBeNull();
  });

  it('finds the account when logging in with the dotted address the user typed', async () => {
    await register('john.doe@gmail.com');

    // 403 (email not verified) proves the user was FOUND.
    // 401 (invalid credentials) would mean the lookup missed the record — the original bug.
    const res = await login('john.doe@gmail.com');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/verify your email/i);
  });

  it('finds the account when logging in with a +tagged address', async () => {
    await register('john.doe+skims@gmail.com');

    const res = await login('john.doe+skims@gmail.com');
    expect(res.status).toBe(403);
  });

  it('finds the account when logging in with different capitalisation', async () => {
    await register('Mixed.Case@Gmail.com');

    const res = await login('MIXED.CASE@GMAIL.COM');
    expect(res.status).toBe(403);
  });

  it('still rejects a genuinely unknown address with 401', async () => {
    await register('john.doe@gmail.com');

    const res = await login('someone.else@gmail.com');
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid credentials/i);
  });

  it('resend-verification matches a dotted address', async () => {
    await register('john.doe@gmail.com');
    const emailService = require('../services/emailService');
    emailService.sendEmailVerification.mockClear();

    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'john.doe@gmail.com' });

    expect(res.status).toBe(200);
    // The generic response is identical either way, so assert the send actually happened.
    expect(emailService.sendEmailVerification).toHaveBeenCalled();
  });

  it('forgot-password matches a dotted address', async () => {
    await register('john.doe@gmail.com');
    const emailService = require('../services/emailService');
    emailService.sendPasswordReset.mockClear();

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'john.doe@gmail.com' });

    expect(res.status).toBe(200);
    expect(emailService.sendPasswordReset).toHaveBeenCalled();
  });

  it('non-Gmail domains keep their dots', async () => {
    const res = await register('juan.cruz@boac.gov.ph');
    expect(res.status).toBe(201);

    // Dot-stripping is Gmail-specific; other domains must be left intact.
    expect(await User.findOne({ email: 'juan.cruz@boac.gov.ph' })).not.toBeNull();
    expect(await login('juan.cruz@boac.gov.ph')).toHaveProperty('status', 403);
  });
});
