const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');
const Notification = require('../models/Notification');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const createNotification = async (recipientId, overrides = {}) => {
  return Notification.create({
    recipient: recipientId,
    type: 'system',
    title: 'Test Notification',
    message: 'This is a test notification.',
    ...overrides,
  });
};

describe('GET /api/notifications', () => {
  it('returns notifications for the authenticated user', async () => {
    const { token, user } = await createUser({ email: 'notif@example.com' });
    await createNotification(user._id);
    await createNotification(user._id, { title: 'Second Notification' });

    const res = await request(app).get('/api/notifications').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.unreadCount).toBe(2);
  });

  it('does not return other users notifications', async () => {
    const { token: t1, user: u1 } = await createUser({ email: 'n1@example.com' });
    const { user: u2 } = await createUser({ email: 'n2@example.com' });

    await createNotification(u1._id, { title: 'For User 1' });
    await createNotification(u2._id, { title: 'For User 2' });

    const res = await request(app).get('/api/notifications').set(authHeader(t1));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('For User 1');
  });

  it('filters by isRead=false', async () => {
    const { token, user } = await createUser({ email: 'notif2@example.com' });
    await createNotification(user._id, { isRead: true });
    await createNotification(user._id, { isRead: false });

    const res = await request(app).get('/api/notifications').set(authHeader(token)).query({ isRead: 'false' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].isRead).toBe(false);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/notifications/unread-count', () => {
  it('returns the unread count for the authenticated user', async () => {
    const { token, user } = await createUser({ email: 'unread@example.com' });
    await createNotification(user._id);
    await createNotification(user._id);
    await createNotification(user._id, { isRead: true });

    const res = await request(app).get('/api/notifications/unread-count').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);
  });
});

describe('PATCH /api/notifications/:id/read', () => {
  it('marks a notification as read', async () => {
    const { token, user } = await createUser({ email: 'markread@example.com' });
    const notif = await createNotification(user._id);

    const res = await request(app)
      .put(`/api/notifications/${notif._id}/read`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
  });

  it('returns 404 if notification belongs to another user', async () => {
    const { token: t1 } = await createUser({ email: 'owner@example.com' });
    const { token: t2, user: u2 } = await createUser({ email: 'other@example.com' });
    const notif = await createNotification(u2._id);

    const res = await request(app)
      .patch(`/api/notifications/${notif._id}/read`)
      .set(authHeader(t1));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/notifications/read-all', () => {
  it('marks all unread notifications as read', async () => {
    const { token, user } = await createUser({ email: 'readall@example.com' });
    await createNotification(user._id);
    await createNotification(user._id);

    const res = await request(app).put('/api/notifications/read-all').set(authHeader(token));
    expect(res.status).toBe(200);

    const unreadCount = await Notification.countDocuments({ recipient: user._id, isRead: false });
    expect(unreadCount).toBe(0);
  });
});

describe('DELETE /api/notifications/:id', () => {
  it('deletes own notification', async () => {
    const { token, user } = await createUser({ email: 'del@example.com' });
    const notif = await createNotification(user._id);

    const res = await request(app).delete(`/api/notifications/${notif._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
  });

  it('returns 404 when trying to delete another user notification', async () => {
    const { token: t1 } = await createUser({ email: 'del1@example.com' });
    const { user: u2 } = await createUser({ email: 'del2@example.com' });
    const notif = await createNotification(u2._id);

    const res = await request(app).delete(`/api/notifications/${notif._id}`).set(authHeader(t1));
    expect(res.status).toBe(404);
  });
});
