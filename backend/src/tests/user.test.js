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

describe('GET /api/users', () => {
  it('returns 200 and user list for municipal_admin', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).get('/api/users').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
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

  it('municipal_admin only sees users from own municipality', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    await createUser({ role: 'sk_chairperson', municipality: municipalityId });
    await createUser({ role: 'sk_chairperson' }); // different municipality

    const res = await request(app).get('/api/users').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2); // admin + chairperson in same mun
  });
});

describe('GET /api/users/pending', () => {
  it('returns pending users', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    await createUser({ role: 'sk_chairperson', municipality: municipalityId, isApproved: false });

    const res = await request(app).get('/api/users/pending').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('municipal_admin only sees pending users from own municipality', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    await createUser({ role: 'sk_chairperson', municipality: municipalityId, isApproved: false });
    await createUser({ role: 'sk_chairperson', isApproved: false }); // other municipality

    const res = await request(app).get('/api/users/pending').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 403 for sk_chairperson', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).get('/api/users/pending').set(authHeader(token));
    expect(res.status).toBe(403);
  });
});

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
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { user: pending } = await createUser({
      role: 'sk_chairperson',
      municipality: municipalityId,
      isApproved: false,
    });

    const res = await request(app).put(`/api/users/${pending._id}/approve`).set(authHeader(token));
    expect(res.status).toBe(200);
    const updated = await User.findById(pending._id);
    expect(updated.isApproved).toBe(true);
  });

  it('returns 404 for non-existent user', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).put('/api/users/000000000000000000000000/approve').set(authHeader(token));
    expect(res.status).toBe(404);
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
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { user: pending } = await createUser({
      role: 'sk_chairperson',
      municipality: municipalityId,
      isApproved: false,
    });

    const res = await request(app)
      .put(`/api/users/${pending._id}/reject`)
      .set(authHeader(token))
      .send({ reason: 'Incomplete requirements' });
    expect(res.status).toBe(200);
    const updated = await User.findById(pending._id);
    expect(updated.isActive).toBe(false);
  });

  it('returns 404 for non-existent user', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).put('/api/users/000000000000000000000000/reject').set(authHeader(token));
    expect(res.status).toBe(404);
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

  it('provincial_admin cannot assign provincial_admin role (exceeds privilege)', async () => {
    const { token } = await createUser({ role: 'provincial_admin' });
    const { user: target } = await createUser({ role: 'sk_chairperson' });

    const res = await request(app)
      .put(`/api/users/${target._id}/role`)
      .set(authHeader(token))
      .send({ role: 'provincial_admin' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/cannot assign/i);
  });

  it('returns 403 for municipal_admin (not authorized for role assignment)', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const { user: target } = await createUser({ role: 'sk_chairperson' });

    const res = await request(app)
      .put(`/api/users/${target._id}/role`)
      .set(authHeader(token))
      .send({ role: 'sk_treasurer' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/users/:id/toggle-status', () => {
  it('toggles user isActive from true to false', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const { user: target } = await createUser({ role: 'sk_chairperson' });

    const res = await request(app)
      .put(`/api/users/${target._id}/toggle-status`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    const updated = await User.findById(target._id);
    expect(updated.isActive).toBe(false);
  });

  it('returns 404 for non-existent user', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app)
      .put('/api/users/000000000000000000000000/toggle-status')
      .set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/users/:id', () => {
  it('super_admin can soft-delete a user', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const { user: target } = await createUser({ role: 'sk_chairperson' });

    const res = await request(app).delete(`/api/users/${target._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    const deleted = await User.findById(target._id);
    expect(deleted.deletedAt).not.toBeNull();
  });

  it('returns 403 for municipal_admin (only super_admin can delete)', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const { user: target } = await createUser({ role: 'sk_chairperson' });

    const res = await request(app).delete(`/api/users/${target._id}`).set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent user', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const res = await request(app).delete('/api/users/000000000000000000000000').set(authHeader(token));
    expect(res.status).toBe(404);
  });
});
