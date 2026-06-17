const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

describe('Liquidation route validation', () => {
  it('returns 422 when title is missing', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send({ totalAmount: 1000 });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/title/i);
  });

  it('returns 422 when totalAmount is not a number', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send({ title: 'Q1', totalAmount: 'lots' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/total amount/i);
  });

  it('returns 422 for a malformed :id param', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app).get('/api/liquidations/not-an-id').set(authHeader(token));
    expect(res.status).toBe(422);
  });
});

describe('Notification route validation', () => {
  it('returns 422 when deleting with a malformed :id', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).delete('/api/notifications/123').set(authHeader(token));
    expect(res.status).toBe(422);
  });

  it('returns 422 when marking read with a malformed :id', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).put('/api/notifications/xyz/read').set(authHeader(token));
    expect(res.status).toBe(422);
  });
});

describe('Document route validation', () => {
  it('returns 422 when uploading without a valid category (file attached, no cloudinary hit)', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/documents')
      .set(authHeader(token))
      .attach('file', Buffer.from('%PDF-1.4 test'), 'test.pdf')
      .field('title', 'Untitled');
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/category/i);
  });

  it('returns 422 for a malformed :id param', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).get('/api/documents/not-valid').set(authHeader(token));
    expect(res.status).toBe(422);
  });
});
