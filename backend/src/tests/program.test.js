const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const PROGRAM_PAYLOAD = (municipalityId, overrides = {}) => ({
  title: 'Youth Leadership Summit 2026',
  description: 'A program to develop leadership skills among SK youth members in the municipality.',
  category: 'education',
  budget: 150000,
  startDate: '2026-03-01',
  endDate: '2026-03-15',
  targetParticipants: 100,
  municipality: municipalityId,
  ...overrides,
});

describe('POST /api/programs', () => {
  it('creates a program and returns 201', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/programs')
      .set(authHeader(token))
      .send(PROGRAM_PAYLOAD(municipalityId));
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Youth Leadership Summit 2026');
    expect(res.body.data.status).toBe('planned');
  });

  it('returns 422 for missing required fields', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/programs')
      .set(authHeader(token))
      .send({ title: 'Test', municipality: municipalityId });
    expect(res.status).toBe(422);
  });

  it('returns 403 for sk_treasurer (not in EDITORS)', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/programs')
      .set(authHeader(token))
      .send(PROGRAM_PAYLOAD(municipalityId));
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/programs').send({ title: 'test' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/programs — municipality scoping', () => {
  it('sk_chairperson only sees their own municipality programs', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: otherToken, municipalityId: otherMunId } = await createUser({ role: 'sk_chairperson' });

    await request(app).post('/api/programs').set(authHeader(token)).send(PROGRAM_PAYLOAD(municipalityId));
    await request(app).post('/api/programs').set(authHeader(otherToken)).send(PROGRAM_PAYLOAD(otherMunId));

    const res = await request(app).get('/api/programs').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const munId = res.body.data[0].municipality?._id || res.body.data[0].municipality;
    expect(munId.toString()).toBe(municipalityId.toString());
  });

  it('provincial_admin sees all municipalities programs', async () => {
    const { token: chair1Token, municipalityId: mun1 } = await createUser({ role: 'sk_chairperson' });
    const { token: chair2Token, municipalityId: mun2 } = await createUser({ role: 'sk_chairperson' });
    const { token: provToken } = await createUser({ role: 'provincial_admin' });

    await request(app).post('/api/programs').set(authHeader(chair1Token)).send(PROGRAM_PAYLOAD(mun1));
    await request(app).post('/api/programs').set(authHeader(chair2Token)).send(PROGRAM_PAYLOAD(mun2));

    const res = await request(app).get('/api/programs').set(authHeader(provToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });
});

describe('GET /api/programs/:id', () => {
  it('returns a program by ID', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/programs').set(authHeader(token)).send(PROGRAM_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    const res = await request(app).get(`/api/programs/${id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(id);
  });

  it('blocks cross-municipality access', async () => {
    const { token: ownerToken, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: otherToken } = await createUser({ role: 'sk_chairperson' });

    const create = await request(app).post('/api/programs').set(authHeader(ownerToken)).send(PROGRAM_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    const res = await request(app).get(`/api/programs/${id}`).set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent program', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).get('/api/programs/000000000000000000000000').set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/programs/:id', () => {
  it('updates a program title', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/programs').set(authHeader(token)).send(PROGRAM_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/programs/${id}`)
      .set(authHeader(token))
      .send({ title: 'Updated Leadership Summit 2026' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated Leadership Summit 2026');
  });

  it('blocks cross-municipality update', async () => {
    const { token: ownerToken, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: otherToken } = await createUser({ role: 'sk_chairperson' });

    const create = await request(app).post('/api/programs').set(authHeader(ownerToken)).send(PROGRAM_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/programs/${id}`)
      .set(authHeader(otherToken))
      .send({ title: 'Hacked Title' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/programs/:id/status', () => {
  it('updates program status', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/programs').set(authHeader(token)).send(PROGRAM_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    const res = await request(app)
      .patch(`/api/programs/${id}/status`)
      .set(authHeader(token))
      .send({ status: 'ongoing' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ongoing');
  });
});

describe('POST /api/programs/:id/milestones', () => {
  it('adds a milestone to a program', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/programs').set(authHeader(token)).send(PROGRAM_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    const res = await request(app)
      .post(`/api/programs/${id}/milestones`)
      .set(authHeader(token))
      .send({ title: 'Venue booking', targetDate: '2026-02-15' });
    expect(res.status).toBe(200);
    expect(res.body.data.milestones).toHaveLength(1);
    expect(res.body.data.milestones[0].title).toBe('Venue booking');
  });

  it('blocks cross-municipality milestone addition', async () => {
    const { token: ownerToken, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: otherToken } = await createUser({ role: 'sk_chairperson' });

    const create = await request(app).post('/api/programs').set(authHeader(ownerToken)).send(PROGRAM_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    const res = await request(app)
      .post(`/api/programs/${id}/milestones`)
      .set(authHeader(otherToken))
      .send({ title: 'Injected milestone' });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/programs/:id', () => {
  it('admin can delete a program', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    const create = await request(app).post('/api/programs').set(authHeader(token)).send(PROGRAM_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    const res = await request(app).delete(`/api/programs/${id}`).set(authHeader(token));
    expect(res.status).toBe(200);
  });

  it('returns 403 for sk_chairperson (not in ADMINS)', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/programs').set(authHeader(token)).send(PROGRAM_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    const res = await request(app).delete(`/api/programs/${id}`).set(authHeader(token));
    expect(res.status).toBe(403);
  });
});
