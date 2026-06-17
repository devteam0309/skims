const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const dob = (yearsAgo) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  return d.toISOString().slice(0, 10);
};

const MEMBER_PAYLOAD = (overrides = {}) => ({
  firstName: 'Maria',
  lastName: 'Santos',
  birthDate: dob(20),
  gender: 'female',
  educationalAttainment: 'college',
  ...overrides,
});

describe('POST /api/youth', () => {
  it('registers a youth member and returns 201', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(MEMBER_PAYLOAD());
    expect(res.status).toBe(201);
    expect(res.body.data.firstName).toBe('Maria');
  });

  it('returns 422 for missing required fields', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send({ firstName: 'Maria', lastName: 'Santos' });
    expect(res.status).toBe(422);
  });

  it('returns 422 for invalid gender', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(MEMBER_PAYLOAD({ gender: 'unknown' }));
    expect(res.status).toBe(422);
  });

  it('returns 400 for age below 15', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(MEMBER_PAYLOAD({ birthDate: dob(10) }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/15/);
  });

  it('returns 400 for age above 30', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(MEMBER_PAYLOAD({ birthDate: dob(35) }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/30/);
  });

  it('returns 403 for sk_secretary (not in YOUTH_REGISTRARS)', async () => {
    const { token } = await createUser({ role: 'sk_secretary' });
    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(MEMBER_PAYLOAD());
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/youth').send(MEMBER_PAYLOAD());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/youth/duplicate-check', () => {
  it('returns exists: true when a matching member exists', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const bd = dob(20);
    await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(MEMBER_PAYLOAD({ birthDate: bd }));

    const res = await request(app)
      .get('/api/youth/duplicate-check')
      .set(authHeader(token))
      .query({ firstName: 'Maria', lastName: 'Santos', birthDate: bd });
    expect(res.status).toBe(200);
    expect(res.body.data.exists).toBe(true);
  });

  it('returns exists: false when no match exists', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .get('/api/youth/duplicate-check')
      .set(authHeader(token))
      .query({ firstName: 'Nobody', lastName: 'Here', birthDate: dob(20) });
    expect(res.status).toBe(200);
    expect(res.body.data.exists).toBe(false);
  });
});

describe('GET /api/youth — demographic filters', () => {
  let token;

  beforeEach(async () => {
    ({ token } = await createUser({ role: 'sk_chairperson' }));
    await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER_PAYLOAD({ gender: 'female', educationalAttainment: 'college' }));
    await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER_PAYLOAD({ firstName: 'Pedro', gender: 'male', educationalAttainment: 'high_school' }));
  });

  it('filters by gender', async () => {
    const res = await request(app).get('/api/youth').set(authHeader(token)).query({ gender: 'female' });
    expect(res.status).toBe(200);
    expect(res.body.data.every((m) => m.gender === 'female')).toBe(true);
  });

  it('filters by educationalAttainment', async () => {
    const res = await request(app).get('/api/youth').set(authHeader(token)).query({ educationalAttainment: 'college' });
    expect(res.status).toBe(200);
    expect(res.body.data.every((m) => m.educationalAttainment === 'college')).toBe(true);
  });

  it('isActive=false returns only inactive members (0 by default)', async () => {
    const res = await request(app).get('/api/youth').set(authHeader(token)).query({ isActive: 'false' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/youth — municipality scoping', () => {
  it('sk_chairperson only sees their own municipality members', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: otherToken } = await createUser({ role: 'sk_chairperson' });

    await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER_PAYLOAD());
    await request(app).post('/api/youth').set(authHeader(otherToken)).send(MEMBER_PAYLOAD({ firstName: 'Pedro' }));

    const res = await request(app).get('/api/youth').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].municipality._id || res.body.data[0].municipality).toBe(municipalityId.toString());
  });
});

describe('PUT /api/youth/:id', () => {
  it('updates a youth member', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER_PAYLOAD());
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/youth/${id}`)
      .set(authHeader(token))
      .send({ firstName: 'Maricel' });
    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe('Maricel');
  });

  it('sk_kagawad can update (in YOUTH_EDITORS)', async () => {
    const { token: chairToken, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: kagawadToken } = await createUser({ role: 'sk_kagawad', municipality: municipalityId });

    const create = await request(app).post('/api/youth').set(authHeader(chairToken)).send(MEMBER_PAYLOAD());
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/youth/${id}`)
      .set(authHeader(kagawadToken))
      .send({ firstName: 'Updated' });
    expect(res.status).toBe(200);
  });

  it('blocks cross-municipality update', async () => {
    const { token: chairToken } = await createUser({ role: 'sk_chairperson' });
    const { token: otherToken } = await createUser({ role: 'sk_chairperson' });

    const create = await request(app).post('/api/youth').set(authHeader(chairToken)).send(MEMBER_PAYLOAD());
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/youth/${id}`)
      .set(authHeader(otherToken))
      .send({ firstName: 'Hacked' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/youth/:id', () => {
  it('soft-deletes a member', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER_PAYLOAD());
    const id = create.body.data._id;

    const del = await request(app).delete(`/api/youth/${id}`).set(authHeader(token));
    expect(del.status).toBe(200);

    const get = await request(app).get(`/api/youth/${id}`).set(authHeader(token));
    expect(get.status).toBe(404);
  });

  it('blocks cross-municipality delete', async () => {
    const { token: chairToken } = await createUser({ role: 'sk_chairperson' });
    const { token: otherToken } = await createUser({ role: 'sk_chairperson' });

    const create = await request(app).post('/api/youth').set(authHeader(chairToken)).send(MEMBER_PAYLOAD());
    const id = create.body.data._id;

    const res = await request(app).delete(`/api/youth/${id}`).set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });
});
