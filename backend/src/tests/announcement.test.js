const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const ANN_PAYLOAD = (overrides = {}) => ({
  title: 'Barangay Youth Assembly',
  content: 'All SK members are invited to attend the quarterly youth assembly.',
  type: 'event',
  isPublic: true,
  eventDate: '2026-07-15',
  eventLocation: 'Boac Municipal Hall',
  ...overrides,
});

describe('POST /api/announcements', () => {
  it('creates an announcement and returns 201 (sk_chairperson)', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/announcements')
      .set(authHeader(token))
      .send(ANN_PAYLOAD());
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Barangay Youth Assembly');
  });

  it('returns 403 for sk_treasurer (not in EDITORS)', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/announcements')
      .set(authHeader(token))
      .send(ANN_PAYLOAD());
    expect(res.status).toBe(403);
  });

  it('forces municipality from authenticated user for non-admin (ignores body municipality)', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/announcements')
      .set(authHeader(token))
      .send(ANN_PAYLOAD({ municipality: '000000000000000000000000' }));
    expect(res.status).toBe(201);
    expect(res.body.data.municipality?.toString()).toBe(municipalityId.toString());
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/announcements').send(ANN_PAYLOAD());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/announcements', () => {
  it('returns announcements list for authenticated user', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    await request(app).post('/api/announcements').set(authHeader(token)).send(ANN_PAYLOAD());

    const res = await request(app).get('/api/announcements').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('scopes announcements to own municipality for non-admin', async () => {
    const { token: t1 } = await createUser({ role: 'sk_chairperson' });
    const { token: t2 } = await createUser({ role: 'sk_chairperson' });

    await request(app).post('/api/announcements').set(authHeader(t1)).send(ANN_PAYLOAD({ title: 'Mun1 Event' }));
    await request(app).post('/api/announcements').set(authHeader(t2)).send(ANN_PAYLOAD({ title: 'Mun2 Event' }));

    const res = await request(app).get('/api/announcements').set(authHeader(t1));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Mun1 Event');
  });

  it('provincial_admin sees all announcements', async () => {
    const { token: t1 } = await createUser({ role: 'sk_chairperson' });
    const { token: t2 } = await createUser({ role: 'sk_chairperson' });
    const { token: provToken } = await createUser({ role: 'provincial_admin' });

    await request(app).post('/api/announcements').set(authHeader(t1)).send(ANN_PAYLOAD({ title: 'Mun1 Event' }));
    await request(app).post('/api/announcements').set(authHeader(t2)).send(ANN_PAYLOAD({ title: 'Mun2 Event' }));

    const res = await request(app).get('/api/announcements').set(authHeader(provToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /api/announcements/:id', () => {
  it('returns an announcement by ID', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/announcements').set(authHeader(token)).send(ANN_PAYLOAD());
    const id = create.body.data._id;

    const res = await request(app).get(`/api/announcements/${id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(id);
  });

  it('returns 404 for non-existent announcement', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).get('/api/announcements/000000000000000000000000').set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/announcements/:id', () => {
  it('updates an announcement title', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/announcements').set(authHeader(token)).send(ANN_PAYLOAD());
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/announcements/${id}`)
      .set(authHeader(token))
      .send({ title: 'Updated Assembly Title' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated Assembly Title');
  });

  it('blocks cross-municipality update', async () => {
    const { token: ownerToken } = await createUser({ role: 'sk_chairperson' });
    const { token: otherToken } = await createUser({ role: 'sk_chairperson' });

    const create = await request(app).post('/api/announcements').set(authHeader(ownerToken)).send(ANN_PAYLOAD());
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/announcements/${id}`)
      .set(authHeader(otherToken))
      .send({ title: 'Hacked Title' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/announcements/:id', () => {
  it('admin can soft-delete an announcement', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const create = await request(app).post('/api/announcements').set(authHeader(token)).send(ANN_PAYLOAD());
    const id = create.body.data._id;

    const res = await request(app).delete(`/api/announcements/${id}`).set(authHeader(token));
    expect(res.status).toBe(200);
  });

  it('sk_chairperson cannot delete (not in ADMINS)', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/announcements').set(authHeader(token)).send(ANN_PAYLOAD());
    const id = create.body.data._id;

    const res = await request(app).delete(`/api/announcements/${id}`).set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('deleted announcement no longer appears in list', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const create = await request(app).post('/api/announcements').set(authHeader(token)).send(ANN_PAYLOAD());
    const id = create.body.data._id;
    await request(app).delete(`/api/announcements/${id}`).set(authHeader(token));

    const res = await request(app).get('/api/announcements').set(authHeader(token));
    expect(res.body.data.find((a) => a._id === id)).toBeUndefined();
  });
});
