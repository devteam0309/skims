const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');
const User = require('../models/User');

jest.mock('../services/emailService', () => ({
  sendEmailVerification: jest.fn().mockResolvedValue({}),
  sendPasswordReset: jest.fn().mockResolvedValue({}),
  sendApprovalNotification: jest.fn().mockResolvedValue({}),
  sendWelcomeEmail: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

describe('POST /api/auth/refresh', () => {
  it('issues a new access token using a valid refresh token cookie', async () => {
    await createUser({ email: 'refresh@example.com' });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'refresh@example.com', password: 'Test@1234' });
    expect(loginRes.status).toBe(200);

    const cookies = loginRes.headers['set-cookie'];
    const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();

    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', refreshCookie);
    expect(res.status).toBe(200);
    const newCookies = res.headers['set-cookie'];
    expect(newCookies.some((c) => c.startsWith('token='))).toBe(true);
  });

  it('returns 401 with no refresh token cookie', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a tampered refresh token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', 'refreshToken=tampered-token-value');
    expect(res.status).toBe(401);
  });

  it('rotates the refresh token on each use (old token invalidated)', async () => {
    await createUser({ email: 'rotate@example.com' });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rotate@example.com', password: 'Test@1234' });

    const cookies = loginRes.headers['set-cookie'];
    const originalRefreshCookie = cookies.find((c) => c.startsWith('refreshToken='));

    // First refresh — succeeds and returns a new refresh token
    const res1 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', originalRefreshCookie);
    expect(res1.status).toBe(200);

    // Try using the original refresh token again — should fail (rotated)
    const res2 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', originalRefreshCookie);
    expect(res2.status).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('logs out and clears both token cookies', async () => {
    const { token } = await createUser({ email: 'logout@example.com' });
    const res = await request(app).post('/api/auth/logout').set(authHeader(token));
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const expired = (c) => c.includes('Expires=Thu, 01 Jan 1970') || c.match(/Expires=.*1970/);
    expect(cookies.some((c) => c.startsWith('token=') && expired(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refreshToken=') && expired(c))).toBe(true);
  });

  it('returns 401 without auth token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/auth/me', () => {
  it('updates first and last name', async () => {
    const { token } = await createUser({ email: 'profile@example.com' });
    const res = await request(app)
      .put('/api/auth/me')
      .set(authHeader(token))
      .send({ firstName: 'Updated', lastName: 'Name' });
    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe('Updated');
    expect(res.body.data.lastName).toBe('Name');
  });

  it('ignores disallowed fields like email', async () => {
    const { token, user } = await createUser({ email: 'profile2@example.com' });
    const res = await request(app)
      .put('/api/auth/me')
      .set(authHeader(token))
      .send({ email: 'hacker@evil.com', firstName: 'Safe' });
    expect(res.status).toBe(200);
    const updated = await User.findById(user._id);
    expect(updated.email).toBe('profile2@example.com');
    expect(updated.firstName).toBe('Safe');
  });
});

describe('PUT /api/auth/password', () => {
  it('changes password with correct current password', async () => {
    const { token } = await createUser({ email: 'pw@example.com' });
    const res = await request(app)
      .put('/api/auth/password')
      .set(authHeader(token))
      .send({ currentPassword: 'Test@1234', newPassword: 'NewPass@5678' });
    expect(res.status).toBe(200);
  });

  it('returns 401 for wrong current password', async () => {
    const { token } = await createUser({ email: 'pw2@example.com' });
    const res = await request(app)
      .put('/api/auth/password')
      .set(authHeader(token))
      .send({ currentPassword: 'WrongPass1!', newPassword: 'NewPass@5678' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('always returns 200 regardless of whether email exists (prevents enumeration)', async () => {
    const res1 = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(res1.status).toBe(200);

    await createUser({ email: 'real@example.com' });
    const res2 = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'real@example.com' });
    expect(res2.status).toBe(200);

    expect(res1.body.message).toBe(res2.body.message);
  });
});

describe('POST /api/auth/verify-email/:token', () => {
  it('verifies email with a valid token', async () => {
    const user = await User.create({
      firstName: 'Verify',
      lastName: 'Me',
      email: 'verify@example.com',
      password: 'Test@1234',
      role: 'public_user',
      isApproved: true,
      isActive: true,
    });
    const rawToken = user.getEmailVerificationToken();
    await user.save({ validateBeforeSave: false });

    const res = await request(app).get(`/api/auth/verify-email/${rawToken}`);
    expect(res.status).toBe(200);

    const updated = await User.findById(user._id);
    expect(updated.isEmailVerified).toBe(true);
  });

  it('returns 400 for an invalid token', async () => {
    const res = await request(app).get('/api/auth/verify-email/invalidtoken123');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/resend-verification', () => {
  it('always returns 200 regardless of whether email exists (prevents enumeration)', async () => {
    const res1 = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'nobody2@example.com' });
    expect(res1.status).toBe(200);

    await User.create({
      firstName: 'Unverified',
      lastName: 'User',
      email: 'unverified2@example.com',
      password: 'Test@1234',
      role: 'public_user',
      isApproved: true,
      isActive: true,
      isEmailVerified: false,
    });

    const res2 = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'unverified2@example.com' });
    expect(res2.status).toBe(200);
    expect(res1.body.message).toBe(res2.body.message);
  });
});
