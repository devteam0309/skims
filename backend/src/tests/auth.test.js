const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');

jest.mock('../services/emailService', () => ({
  sendEmailVerification: jest.fn().mockResolvedValue({}),
  sendPasswordReset: jest.fn().mockResolvedValue({}),
  sendApprovalNotification: jest.fn().mockResolvedValue({}),
  sendWelcomeEmail: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

describe('POST /api/auth/register', () => {
  it('creates a new user and returns 201', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@example.com', password: 'Test@1234', role: 'public_user' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('returns 422 for invalid email format', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ firstName: 'Juan', lastName: 'Cruz', email: 'not-an-email', password: 'Test@1234' });
    expect(res.status).toBe(422);
  });

  it('returns 422 for missing first name', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ lastName: 'Cruz', email: 'juan2@example.com', password: 'Test@1234' });
    expect(res.status).toBe(422);
  });

  it('returns 422 for weak password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ firstName: 'Juan', lastName: 'Cruz', email: 'juan3@example.com', password: 'password' });
    expect(res.status).toBe(422);
  });

  it('returns 400 for duplicate email', async () => {
    await createUser({ email: 'dup@example.com' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ firstName: 'Juan', lastName: 'Cruz', email: 'dup@example.com', password: 'Test@1234' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials and sets both access and refresh token cookies', async () => {
    await createUser({ email: 'login@example.com' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'Test@1234' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.startsWith('token='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
  });

  it('returns 401 for wrong password', async () => {
    await createUser({ email: 'wrongpw@example.com' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrongpw@example.com', password: 'WrongPass1!' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'Test@1234' });
    expect(res.status).toBe(401);
  });

  it('returns 422 for missing password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com' });
    expect(res.status).toBe(422);
  });

  it('returns 403 if email is not verified', async () => {
    await createUser({ email: 'unverified@example.com', isEmailVerified: false });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unverified@example.com', password: 'Test@1234' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns current user with valid token', async () => {
    const { user, token } = await createUser({ email: 'me@example.com' });
    const res = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('me@example.com');
    expect(res.body.data._id).toBe(user._id.toString());
  });

  it('returns 401 with a tampered token', async () => {
    const res = await request(app).get('/api/auth/me').set({ Authorization: 'Bearer tampered.token.here' });
    expect(res.status).toBe(401);
  });
});
