const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBudget, createProgram, authHeader } = require('./helpers');

jest.mock('../services/emailService', () => ({
  sendLiquidationApproved: jest.fn().mockResolvedValue({}),
  sendLiquidationRejected: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const LIQ_PAYLOAD = (programId, overrides = {}) => ({
  title: 'Q1 Liquidation Report',
  program: programId,
  totalAmount: 50000,
  liquidatedAmount: 45000,
  remarks: 'Regular quarterly liquidation',
  ...overrides,
});

describe('POST /api/liquidations', () => {
  it('creates a draft liquidation and returns 201', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const program = await createProgram(municipalityId, user._id);

    const res = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.title).toBe('Q1 Liquidation Report');
  });

  it('auto-generates a reference number', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const program = await createProgram(municipalityId, user._id);

    const res = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    expect(res.status).toBe(201);
    expect(res.body.data.referenceNumber).toMatch(/^LIQ-\d{4}-\d{5}$/);
  });

  it('forces municipality from authenticated user (not request body)', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const program = await createProgram(municipalityId, user._id);

    const res = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send({ ...LIQ_PAYLOAD(program._id.toString()), municipality: 'fake-municipality-id' });
    expect(res.status).toBe(201);
    expect(res.body.data.municipality.toString()).toBe(municipalityId.toString());
  });

  it('returns 403 for unauthorized role', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_kagawad' });
    const program = await createProgram(municipalityId, user._id);

    const res = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/liquidations').send({ title: 'test' });
    expect(res.status).toBe(401);
  });
});

describe('Liquidation workflow: draft → submit → approve', () => {
  let token, municipalityId, userId;

  beforeEach(async () => {
    ({ token, municipalityId, user: { _id: userId } } = await createUser({ role: 'municipal_admin' }));
  });

  it('submits a draft liquidation', async () => {
    const program = await createProgram(municipalityId, userId);
    const create = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    const id = create.body.data._id;

    const res = await request(app).patch(`/api/liquidations/${id}/submit`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('submitted');
  });

  it('cannot submit a non-draft liquidation', async () => {
    const program = await createProgram(municipalityId, userId);
    const create = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    const id = create.body.data._id;
    await request(app).patch(`/api/liquidations/${id}/submit`).set(authHeader(token));

    const res = await request(app).patch(`/api/liquidations/${id}/submit`).set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('approves a submitted liquidation', async () => {
    const program = await createProgram(municipalityId, userId);
    const create = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    const id = create.body.data._id;
    await request(app).patch(`/api/liquidations/${id}/submit`).set(authHeader(token));

    const res = await request(app).patch(`/api/liquidations/${id}/approve`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  it('prevents double-approval with 409', async () => {
    const program = await createProgram(municipalityId, userId);
    const create = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    const id = create.body.data._id;
    await request(app).patch(`/api/liquidations/${id}/submit`).set(authHeader(token));
    await request(app).patch(`/api/liquidations/${id}/approve`).set(authHeader(token));

    const res = await request(app).patch(`/api/liquidations/${id}/approve`).set(authHeader(token));
    expect(res.status).toBe(409);
  });

  it('rejects a submitted liquidation', async () => {
    const program = await createProgram(municipalityId, userId);
    const create = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    const id = create.body.data._id;
    await request(app).patch(`/api/liquidations/${id}/submit`).set(authHeader(token));

    const res = await request(app)
      .patch(`/api/liquidations/${id}/reject`)
      .set(authHeader(token))
      .send({ reason: 'Missing supporting documents' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
  });
});

describe('Liquidation amount validation', () => {
  it('rejects liquidatedAmount > totalAmount', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const program = await createProgram(municipalityId, user._id);

    const res = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString(), { totalAmount: 10000, liquidatedAmount: 15000 }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/liquidations — municipality scoping', () => {
  it('municipal_admin only sees their own municipality liquidations', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: otherToken, user: otherUser, municipalityId: otherMunId } = await createUser({ role: 'municipal_admin' });

    const p1 = await createProgram(municipalityId, user._id);
    const p2 = await createProgram(otherMunId, otherUser._id);

    await request(app).post('/api/liquidations').set(authHeader(token)).send(LIQ_PAYLOAD(p1._id.toString()));
    await request(app).post('/api/liquidations').set(authHeader(otherToken)).send(LIQ_PAYLOAD(p2._id.toString()));

    const res = await request(app).get('/api/liquidations').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('DELETE /api/liquidations/:id', () => {
  it('admin can delete a draft liquidation', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const program = await createProgram(municipalityId, user._id);
    const create = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    const id = create.body.data._id;

    const res = await request(app).delete(`/api/liquidations/${id}`).set(authHeader(token));
    expect(res.status).toBe(200);
  });

  it('blocks deletion of approved liquidation', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const program = await createProgram(municipalityId, user._id);
    const create = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    const id = create.body.data._id;
    await request(app).patch(`/api/liquidations/${id}/submit`).set(authHeader(token));
    await request(app).patch(`/api/liquidations/${id}/approve`).set(authHeader(token));

    const res = await request(app).delete(`/api/liquidations/${id}`).set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-admin', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const program = await createProgram(municipalityId, user._id);
    const create = await request(app)
      .post('/api/liquidations')
      .set(authHeader(token))
      .send(LIQ_PAYLOAD(program._id.toString()));
    const id = create.body.data._id;

    const res = await request(app).delete(`/api/liquidations/${id}`).set(authHeader(token));
    expect(res.status).toBe(403);
  });
});
