/*
 * The `public_user` role is retired.
 *
 * It granted strictly less than being signed out — `/portal` and every `/api/public/*` endpoint
 * are open to anyone — while doubling as the silent catch-all for any unrecognised role at
 * registration. That second job is what made it worth removing rather than merely ignoring: a
 * registrant could pick "Municipal SK Fed. Admin", be handed a different kind of account, and be
 * told nothing.
 *
 * These cases pin all three halves: the role cannot come back, an unusable role is an error
 * rather than a downgrade, and the portal still needs no account at all.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createMunicipality, authHeader } = require('./helpers');
const User = require('../models/User');

jest.mock('../services/emailService', () => new Proxy({}, {
  get: () => jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const registration = (extra = {}) => ({
  firstName: 'Test', lastName: 'Person',
  email: `person-${Math.random().toString(36).slice(2)}@example.com`,
  password: 'Test@1234',
  ...extra,
});

describe('the role itself is gone', () => {
  it('is not a valid value on the User model', async () => {
    const mun = await createMunicipality();
    await expect(User.create({
      firstName: 'Ghost', lastName: 'Account', email: 'ghost@example.com',
      password: 'Test@1234', role: 'public_user', municipality: mun._id,
    })).rejects.toThrow(/role/i);
  });

  // The default used to be public_user, so a document with no role at all quietly became one.
  it('refuses to create a user with no role rather than defaulting', async () => {
    const mun = await createMunicipality();
    await expect(User.create({
      firstName: 'Roleless', lastName: 'Account', email: 'roleless@example.com',
      password: 'Test@1234', municipality: mun._id,
    })).rejects.toThrow(/role/i);
  });
});

describe('registration rejects rather than downgrades', () => {
  it('refuses the retired role by name', async () => {
    const mun = await createMunicipality();
    const res = await request(app).post('/api/auth/register')
      .send(registration({ role: 'public_user', municipality: mun._id.toString() }));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await User.countDocuments({})).toBe(0);
  });

  /*
   * The bug this closes: both of these appear on the register form, neither is self-assignable,
   * and each used to produce a working public_user account with no message at all.
   */
  it.each(['provincial_admin', 'municipal_admin', 'super_admin'])(
    'refuses the elevated role %s instead of silently downgrading it',
    async (role) => {
      const mun = await createMunicipality();
      const res = await request(app).post('/api/auth/register')
        .send(registration({ role, municipality: mun._id.toString() }));

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(await User.countDocuments({})).toBe(0);
    },
  );

  it('refuses a registration that names no role', async () => {
    const mun = await createMunicipality();
    const res = await request(app).post('/api/auth/register')
      .send(registration({ municipality: mun._id.toString() }));

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await User.countDocuments({})).toBe(0);
  });

  it('still accepts a genuinely self-assignable role', async () => {
    const mun = await createMunicipality();
    const res = await request(app).post('/api/auth/register')
      .send(registration({ role: 'sk_kagawad', municipality: mun._id.toString() }));

    expect(res.status).toBe(201);
  });

  // Provincial oversight belongs to no single LGU, and the seeded account has none.
  it('accepts dilg_representative without a municipality', async () => {
    const res = await request(app).post('/api/auth/register')
      .send(registration({ role: 'dilg_representative' }));

    expect(res.status).toBe(201);
  });
});

describe('admins cannot reintroduce the role', () => {
  it('refuses to assign it to an existing account', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const { user: target } = await createUser({ role: 'sk_chairperson' });

    const res = await request(app).put(`/api/users/${target._id}/role`)
      .set(authHeader(token)).send({ role: 'public_user' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    const untouched = await User.findById(target._id);
    expect(untouched.role).toBe('sk_chairperson');
  });
});

/*
 * The reason removing the role costs nobody anything. If any of these started requiring auth,
 * the deletion would have taken something real away from the public.
 */
describe('the transparency portal still needs no account', () => {
  it.each([
    '/api/public/programs',
    '/api/public/announcements',
    '/api/public/budget',
    '/api/public/documents',
    '/api/public/municipalities',
    '/api/public/stats',
  ])('%s is reachable with no credentials', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
  });
});
