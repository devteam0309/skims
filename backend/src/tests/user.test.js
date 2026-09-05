const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');
const User = require('../models/User');

jest.mock('../services/emailService', () => ({
  sendApprovalNotification: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

/*
 * Account administration is super_admin only.
 *
 * These cases used to act as municipal_admin, which was accurate until the panel asked for User
 * Management to be taken away from the provincial and municipal tiers. The suite is rewritten
 * rather than relaxed: every operation is now exercised as super_admin, and each one carries an
 * explicit case proving the other two admin roles are refused. Without the second half, narrowing
 * the guard and silently widening it again would both keep this file green.
 */
const ADMIN_TIERS_NOW_DENIED = ['provincial_admin', 'municipal_admin'];

describe('GET /api/users', () => {
  it('returns 200 and a user list for super_admin', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const res = await request(app).get('/api/users').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it.each(ADMIN_TIERS_NOW_DENIED)('returns 403 for %s', async (role) => {
    const { token } = await createUser({ role });
    const res = await request(app).get('/api/users').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns 403 for sk_chairperson (not an admin)', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).get('/api/users').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('super_admin sees users across every municipality', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const { municipalityId } = await createUser({ role: 'sk_chairperson' });
    await createUser({ role: 'sk_treasurer', municipality: municipalityId });
    await createUser({ role: 'sk_chairperson' }); // a different municipality

    const res = await request(app).get('/api/users').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4); // the super_admin plus all three
  });
});

describe('GET /api/users/pending', () => {
  it('returns pending users for super_admin', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    await createUser({ role: 'sk_chairperson', isApproved: false });

    const res = await request(app).get('/api/users/pending').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('super_admin sees pending users from every municipality', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    await createUser({ role: 'sk_chairperson', isApproved: false });
    await createUser({ role: 'sk_chairperson', isApproved: false }); // other municipality

    const res = await request(app).get('/api/users/pending').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it.each(ADMIN_TIERS_NOW_DENIED)('returns 403 for %s', async (role) => {
    const { token } = await createUser({ role });
    const res = await request(app).get('/api/users/pending').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns 403 for sk_chairperson', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).get('/api/users/pending').set(authHeader(token));
    expect(res.status).toBe(403);
  });
});

/*
 * GET /:id is deliberately NOT super-admin-only: it backs profile views for every signed-in user
 * and stays municipality-scoped in the controller. Narrowing the management routes must not
 * quietly take it with them.
 */
describe('GET /api/users/:id', () => {
  it('returns a user by ID', async () => {
    const { token, user } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).get(`/api/users/${user._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(user._id.toString());
  });

  it('returns 404 for non-existent user', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).get('/api/users/000000000000000000000000').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('blocks cross-municipality access for non-admin', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const { user: otherUser } = await createUser({ role: 'sk_chairperson' }); // different municipality
    const res = await request(app).get(`/api/users/${otherUser._id}`).set(authHeader(token));
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/users/:id/approve', () => {
  it('approves a pending user and sets isApproved to true', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const { user: pending } = await createUser({ role: 'sk_chairperson', isApproved: false });

    const res = await request(app).put(`/api/users/${pending._id}/approve`).set(authHeader(token));
    expect(res.status).toBe(200);
    const updated = await User.findById(pending._id);
    expect(updated.isApproved).toBe(true);
  });

  it('returns 404 for non-existent user', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const res = await request(app).put('/api/users/000000000000000000000000/approve').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it.each(ADMIN_TIERS_NOW_DENIED)('returns 403 for %s', async (role) => {
    const { token } = await createUser({ role });
    const { user: pending } = await createUser({ role: 'sk_chairperson', isApproved: false });
    const res = await request(app).put(`/api/users/${pending._id}/approve`).set(authHeader(token));
    expect(res.status).toBe(403);
    const untouched = await User.findById(pending._id);
    expect(untouched.isApproved).toBe(false);
  });

  it('returns 403 for sk_chairperson (not an admin)', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { user: pending } = await createUser({
      role: 'sk_treasurer',
      municipality: municipalityId,
      isApproved: false,
    });
    const res = await request(app).put(`/api/users/${pending._id}/approve`).set(authHeader(token));
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/users/:id/reject', () => {
  it('rejects a user and deactivates their account', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const { user: pending } = await createUser({ role: 'sk_chairperson', isApproved: false });

    const res = await request(app)
      .put(`/api/users/${pending._id}/reject`)
      .set(authHeader(token))
      .send({ reason: 'Incomplete requirements' });
    expect(res.status).toBe(200);
    const updated = await User.findById(pending._id);
    expect(updated.isActive).toBe(false);
  });

  it('returns 404 for non-existent user', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const res = await request(app).put('/api/users/000000000000000000000000/reject').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it.each(ADMIN_TIERS_NOW_DENIED)('returns 403 for %s', async (role) => {
    const { token } = await createUser({ role });
    const { user: pending } = await createUser({ role: 'sk_chairperson', isApproved: false });
    const res = await request(app)
      .put(`/api/users/${pending._id}/reject`)
      .set(authHeader(token))
      .send({ reason: 'nope' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/users/:id/role', () => {
  it('super_admin can assign a role to any user', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const { user: target } = await createUser({ role: 'sk_chairperson' });

    const res = await request(app)
      .put(`/api/users/${target._id}/role`)
      .set(authHeader(token))
      .send({ role: 'sk_treasurer' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('sk_treasurer');
  });

  /*
   * provincial_admin used to reach this route and be stopped by the ASSIGNABLE_ROLES hierarchy
   * inside the controller. It is now refused at the route, so the rejection is a flat 403 rather
   * than a "cannot assign that role" message. The hierarchy check stays in place behind it.
   */
  it.each(ADMIN_TIERS_NOW_DENIED)('returns 403 for %s', async (role) => {
    const { token } = await createUser({ role });
    const { user: target } = await createUser({ role: 'sk_chairperson' });

    const res = await request(app)
      .put(`/api/users/${target._id}/role`)
      .set(authHeader(token))
      .send({ role: 'sk_treasurer' });
    expect(res.status).toBe(403);
    const untouched = await User.findById(target._id);
    expect(untouched.role).toBe('sk_chairperson');
  });
});

describe('PUT /api/users/:id/toggle-status', () => {
  it('toggles user isActive from true to false', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const { user: target } = await createUser({ role: 'sk_chairperson' });

    const res = await request(app)
      .put(`/api/users/${target._id}/toggle-status`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    const updated = await User.findById(target._id);
    expect(updated.isActive).toBe(false);
  });

  it('returns 404 for non-existent user', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const res = await request(app)
      .put('/api/users/000000000000000000000000/toggle-status')
      .set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it.each(ADMIN_TIERS_NOW_DENIED)('returns 403 for %s', async (role) => {
    const { token } = await createUser({ role });
    const { user: target } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .put(`/api/users/${target._id}/toggle-status`)
      .set(authHeader(token));
    expect(res.status).toBe(403);
    const untouched = await User.findById(target._id);
    expect(untouched.isActive).toBe(true);
  });
});

describe('GET /api/audit-logs', () => {
  it('is reachable by super_admin', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const res = await request(app).get('/api/audit-logs').set(authHeader(token));
    expect(res.status).toBe(200);
  });

  it.each(ADMIN_TIERS_NOW_DENIED)('returns 403 for %s', async (role) => {
    const { token } = await createUser({ role });
    const res = await request(app).get('/api/audit-logs').set(authHeader(token));
    expect(res.status).toBe(403);
  });
});
