/**
 * Email change approval, and notification priority ordering.
 *
 * The single most important assertion in this file is the negative one: requesting a change does not
 * change `email`. The address is the login identifier and the destination for password resets, so an
 * unreviewed change is an account takeover with extra steps — by a borrowed session, or by a typo.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBarangay, authHeader } = require('./helpers');
const User = require('../models/User');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

// createUser hashes this via the model's pre-save hook.
const PASSWORD = 'Test@1234';

describe('POST /api/auth/me/email-change', () => {
  it('stores the request and leaves the active address untouched', async () => {
    const { token, user } = await createUser({ role: 'sk_chairperson' });

    const res = await request(app)
      .post('/api/auth/me/email-change')
      .set(authHeader(token))
      .send({ email: 'new.address@example.com', currentPassword: PASSWORD });

    expect(res.status).toBe(200);
    const stored = await User.findById(user._id);
    expect(stored.email).toBe(user.email);
    expect(stored.pendingEmail).toBe('new.address@example.com');
    expect(stored.pendingEmailRequestedAt).toBeTruthy();
  });

  it('still allows a login with the ORIGINAL address while the change is pending', async () => {
    const { token, user } = await createUser({ role: 'sk_chairperson' });
    await request(app).post('/api/auth/me/email-change').set(authHeader(token))
      .send({ email: 'new.address@example.com', currentPassword: PASSWORD });

    const old = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(old.status).toBe(200);

    // And not with the requested one, which is not yet an identity.
    const pending = await request(app).post('/api/auth/login').send({ email: 'new.address@example.com', password: PASSWORD });
    expect(pending.status).toBe(401);
  });

  it('requires the current password, so a borrowed session cannot start a takeover', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });

    const missing = await request(app).post('/api/auth/me/email-change').set(authHeader(token))
      .send({ email: 'new.address@example.com' });
    expect(missing.status).toBe(422);

    const wrong = await request(app).post('/api/auth/me/email-change').set(authHeader(token))
      .send({ email: 'new.address@example.com', currentPassword: 'Wrong@1234' });
    expect(wrong.status).toBe(401);
  });

  it('refuses an address already taken by another account or another pending request', async () => {
    const { user: other } = await createUser({ role: 'sk_treasurer' });
    const { token } = await createUser({ role: 'sk_chairperson' });

    const taken = await request(app).post('/api/auth/me/email-change').set(authHeader(token))
      .send({ email: other.email, currentPassword: PASSWORD });
    expect(taken.status).toBe(409);

    const { token: thirdToken } = await createUser({ role: 'sk_secretary' });
    await request(app).post('/api/auth/me/email-change').set(authHeader(thirdToken))
      .send({ email: 'contested@example.com', currentPassword: PASSWORD });

    const contested = await request(app).post('/api/auth/me/email-change').set(authHeader(token))
      .send({ email: 'contested@example.com', currentPassword: PASSWORD });
    expect(contested.status).toBe(409);
  });

  it('notifies super_admin only, since only super_admin can act on it', async () => {
    const { user: superAdmin } = await createUser({ role: 'super_admin', municipality: null });
    const { user: municipalAdmin } = await createUser({ role: 'municipal_admin' });
    const { token } = await createUser({ role: 'sk_chairperson' });

    await request(app).post('/api/auth/me/email-change').set(authHeader(token))
      .send({ email: 'new.address@example.com', currentPassword: PASSWORD });

    expect(await Notification.countDocuments({ recipient: superAdmin._id, type: 'approval_request' })).toBe(1);
    expect(await Notification.countDocuments({ recipient: municipalAdmin._id })).toBe(0);
  });

  it('records the request in the audit log', async () => {
    const { token, user } = await createUser({ role: 'sk_chairperson' });
    await request(app).post('/api/auth/me/email-change').set(authHeader(token))
      .send({ email: 'new.address@example.com', currentPassword: PASSWORD });

    const log = await AuditLog.findOne({ action: 'EMAIL_CHANGE_REQUEST', resourceId: user._id });
    expect(log).toBeTruthy();
    expect(log.oldValues.email).toBe(user.email);
    expect(log.newValues.pendingEmail).toBe('new.address@example.com');
  });

  it('can be withdrawn by the requester', async () => {
    const { token, user } = await createUser({ role: 'sk_chairperson' });
    await request(app).post('/api/auth/me/email-change').set(authHeader(token))
      .send({ email: 'new.address@example.com', currentPassword: PASSWORD });

    const res = await request(app).delete('/api/auth/me/email-change').set(authHeader(token));
    expect(res.status).toBe(200);
    expect((await User.findById(user._id)).pendingEmail).toBeNull();
  });

  it('is not reachable through the ordinary profile update', async () => {
    const { token, user } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).put('/api/auth/me').set(authHeader(token))
      .send({ firstName: 'Renamed', email: 'sneaky@example.com' });

    expect(res.status).toBe(200);
    const stored = await User.findById(user._id);
    expect(stored.firstName).toBe('Renamed');
    // `email` is not in the profile whitelist and never was.
    expect(stored.email).toBe(user.email);
  });
});

describe('Administrator decision on an email change', () => {
  const withPendingChange = async () => {
    const { token: adminToken } = await createUser({ role: 'super_admin', municipality: null });
    const { token, user } = await createUser({ role: 'sk_chairperson' });
    await request(app).post('/api/auth/me/email-change').set(authHeader(token))
      .send({ email: 'new.address@example.com', currentPassword: PASSWORD });
    return { adminToken, token, user };
  };

  it('lists the accounts awaiting a decision', async () => {
    const { adminToken, user } = await withPendingChange();
    const res = await request(app).get('/api/users/email-changes').set(authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]._id).toBe(user._id.toString());
    expect(res.body.data[0].pendingEmail).toBe('new.address@example.com');
  });

  it('makes the new address active on approval, and lets the user log in with it', async () => {
    const { adminToken, user } = await withPendingChange();

    const res = await request(app).put(`/api/users/${user._id}/email-change/approve`).set(authHeader(adminToken));
    expect(res.status).toBe(200);

    const stored = await User.findById(user._id);
    expect(stored.email).toBe('new.address@example.com');
    expect(stored.pendingEmail).toBeNull();

    const login = await request(app).post('/api/auth/login')
      .send({ email: 'new.address@example.com', password: PASSWORD });
    expect(login.status).toBe(200);

    const log = await AuditLog.findOne({ action: 'EMAIL_CHANGE_APPROVE', resourceId: user._id });
    expect(log.oldValues.email).toBe(user.email);
    expect(log.newValues.email).toBe('new.address@example.com');
  });

  it('keeps the existing address on rejection and records the reason', async () => {
    const { adminToken, user } = await withPendingChange();

    const res = await request(app).put(`/api/users/${user._id}/email-change/reject`)
      .set(authHeader(adminToken)).send({ reason: 'Use your official government address' });
    expect(res.status).toBe(200);

    const stored = await User.findById(user._id);
    expect(stored.email).toBe(user.email);
    expect(stored.pendingEmail).toBeNull();
    expect(stored.pendingEmailRejectionReason).toBe('Use your official government address');

    const note = await Notification.findOne({ recipient: user._id, type: 'approval_rejected' });
    expect(note.message).toMatch(/Use your official government address/);

    const log = await AuditLog.findOne({ action: 'EMAIL_CHANGE_REJECT', resourceId: user._id });
    expect(log.details.activeEmailUnchanged).toBe(user.email);
  });

  it('is closed to every role but super_admin', async () => {
    const { user } = await withPendingChange();
    for (const role of ['municipal_admin', 'provincial_admin', 'sk_chairperson']) {
      const { token } = await createUser({ role, municipality: role === 'provincial_admin' ? null : undefined });
      const res = await request(app).put(`/api/users/${user._id}/email-change/approve`).set(authHeader(token));
      expect(res.status).toBe(403);
    }
    expect((await User.findById(user._id)).pendingEmail).toBe('new.address@example.com');
  });

  it('refuses to approve when there is nothing pending', async () => {
    const { token: adminToken } = await createUser({ role: 'super_admin', municipality: null });
    const { user } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).put(`/api/users/${user._id}/email-change/approve`).set(authHeader(adminToken));
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/users/:id/barangay', () => {
  it('assigns a barangay in the user own municipality', async () => {
    const { token: adminToken } = await createUser({ role: 'super_admin', municipality: null });
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const barangay = await createBarangay(municipalityId);

    const res = await request(app).put(`/api/users/${user._id}/barangay`)
      .set(authHeader(adminToken)).send({ barangay: barangay._id.toString() });
    expect(res.status).toBe(200);
    expect((await User.findById(user._id)).barangay.toString()).toBe(barangay._id.toString());
  });

  it('refuses a barangay from another municipality', async () => {
    const { token: adminToken } = await createUser({ role: 'super_admin', municipality: null });
    const { user } = await createUser({ role: 'sk_chairperson' });
    const { municipalityId: otherMunId } = await createUser({ role: 'municipal_admin' });
    const foreign = await createBarangay(otherMunId);

    const res = await request(app).put(`/api/users/${user._id}/barangay`)
      .set(authHeader(adminToken)).send({ barangay: foreign._id.toString() });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong to this municipality/i);
    expect((await User.findById(user._id)).barangay).toBeUndefined();
  });

  it('clears the assignment when given no barangay', async () => {
    const { token: adminToken } = await createUser({ role: 'super_admin', municipality: null });
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    const barangay = await createBarangay(municipalityId);
    const { user } = await createUser({ role: 'sk_chairperson', municipality: municipalityId, barangay: barangay._id });

    const res = await request(app).put(`/api/users/${user._id}/barangay`).set(authHeader(adminToken)).send({ barangay: '' });
    expect(res.status).toBe(200);
    expect((await User.findById(user._id)).barangay).toBeUndefined();
  });

  it('is closed to every role but super_admin', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const barangay = await createBarangay(municipalityId);
    const { token } = await createUser({ role: 'municipal_admin', municipality: municipalityId });

    const res = await request(app).put(`/api/users/${user._id}/barangay`)
      .set(authHeader(token)).send({ barangay: barangay._id.toString() });
    expect(res.status).toBe(403);
  });
});

describe('Notification ordering', () => {
  it('returns the most urgent first, newest first within a priority', async () => {
    const { token, user } = await createUser({ role: 'sk_chairperson' });
    const base = Date.now();
    const make = (priority, minutesAgo, title) => Notification.create({
      recipient: user._id,
      type: 'system',
      title,
      message: title,
      priority,
      createdAt: new Date(base - minutesAgo * 60000),
    });

    // Deliberately inserted out of order, and with the urgent one OLDEST — under the previous
    // createdAt-only sort it sat at the bottom of the page.
    await make('urgent', 50, 'urgent-old');
    await make('low', 1, 'low-new');
    await make('medium', 10, 'medium-older');
    await make('high', 30, 'high-old');
    await make('medium', 5, 'medium-newer');

    const res = await request(app).get('/api/notifications').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.map((n) => n.title)).toEqual([
      'urgent-old', 'high-old', 'medium-newer', 'medium-older', 'low-new',
    ]);
  });

  it('keeps a strict timeline available for a caller that asks for one', async () => {
    const { token, user } = await createUser({ role: 'sk_chairperson' });
    await Notification.create({ recipient: user._id, type: 'system', title: 'urgent-old', message: 'x', priority: 'urgent', createdAt: new Date(Date.now() - 60000) });
    await Notification.create({ recipient: user._id, type: 'system', title: 'low-new', message: 'x', priority: 'low' });

    const res = await request(app).get('/api/notifications?sort=newest').set(authHeader(token));
    expect(res.body.data.map((n) => n.title)).toEqual(['low-new', 'urgent-old']);
  });

  it('still reports the unread count alongside the ordered page', async () => {
    const { token, user } = await createUser({ role: 'sk_chairperson' });
    await Notification.create({ recipient: user._id, type: 'system', title: 'a', message: 'x', priority: 'high' });
    await Notification.create({ recipient: user._id, type: 'system', title: 'b', message: 'x', priority: 'low', isRead: true });

    const res = await request(app).get('/api/notifications').set(authHeader(token));
    expect(res.body.meta.unreadCount).toBe(1);
    expect(res.body.meta.total).toBe(2);
  });

  it('never returns another user notifications', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const { user: other } = await createUser({ role: 'sk_treasurer' });
    await Notification.create({ recipient: other._id, type: 'system', title: 'theirs', message: 'x', priority: 'urgent' });

    const res = await request(app).get('/api/notifications').set(authHeader(token));
    expect(res.body.data).toHaveLength(0);
  });
});
