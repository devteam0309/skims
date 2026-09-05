const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');
const User = require('../models/User');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

/*
 * Each of these endpoints could be pointed at the caller and strip the caller's own access.
 * Recovering needs another administrator, or direct database surgery if the account was the last
 * super_admin. The UI withholds the controls on your own row, but the endpoints are reachable
 * directly, so the guard has to live here.
 */
describe('Admin endpoints refuse to act on the caller', () => {
  it('refuses a self role change, leaving the role intact', async () => {
    const { user, token } = await createUser({ role: 'super_admin' });

    const res = await request(app)
      .put(`/api/users/${user._id}/role`)
      .set(authHeader(token))
      .send({ role: 'dilg_representative' });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own role/i);

    const after = await User.findById(user._id);
    expect(after.role).toBe('super_admin');
  });

  it('refuses self deactivation, leaving the account active', async () => {
    const { user, token } = await createUser({ role: 'super_admin' });

    const res = await request(app)
      .put(`/api/users/${user._id}/toggle-status`)
      .set(authHeader(token));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own account/i);

    const after = await User.findById(user._id);
    expect(after.isActive).toBe(true);
  });

  it('refuses self deletion, leaving the account undeleted', async () => {
    const { user, token } = await createUser({ role: 'super_admin' });

    const res = await request(app)
      .delete(`/api/users/${user._id}`)
      .set(authHeader(token));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own account/i);

    const after = await User.findById(user._id);
    expect(after.deletedAt).toBeFalsy();
    expect(after.isActive).toBe(true);
  });
});

/*
 * The guard must not overreach: administering *other* accounts is the entire point of these
 * endpoints, so each case above is paired with the same call against a different user.
 */
describe('The same actions still work on other accounts', () => {
  it('allows changing another user role', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const { user: target } = await createUser({ role: 'sk_kagawad' });

    const res = await request(app)
      .put(`/api/users/${target._id}/role`)
      .set(authHeader(token))
      .send({ role: 'sk_treasurer' });

    expect(res.status).toBe(200);
    expect((await User.findById(target._id)).role).toBe('sk_treasurer');
  });

  it('allows deactivating another user', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const { user: target } = await createUser({ role: 'sk_kagawad' });

    const res = await request(app)
      .put(`/api/users/${target._id}/toggle-status`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect((await User.findById(target._id)).isActive).toBe(false);
  });

  it('allows deleting another user', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const { user: target } = await createUser({ role: 'sk_kagawad' });

    const res = await request(app)
      .delete(`/api/users/${target._id}`)
      .set(authHeader(token));

    expect(res.status).toBe(200);
    expect((await User.findById(target._id)).deletedAt).toBeTruthy();
  });
});
