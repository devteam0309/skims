const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createMunicipality, authHeader } = require('./helpers');

jest.mock('../services/emailService', () => ({
  sendBudgetApproved: jest.fn().mockResolvedValue({}),
  sendBudgetRejected: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const BUDGET_PAYLOAD = (municipalityId) => ({
  title: 'FY 2026 Operating Budget',
  fiscalYear: 2026,
  totalBudget: 500000,
  municipality: municipalityId,
});

describe('POST /api/budgets', () => {
  it('creates a draft budget and returns 201', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(BUDGET_PAYLOAD(municipalityId));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
  });

  it('returns 422 for missing title', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send({ fiscalYear: 2026, totalBudget: 100000, municipality: municipalityId });
    expect(res.status).toBe(422);
  });

  it('returns 400 when allocations exceed totalBudget', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send({
        ...BUDGET_PAYLOAD(municipalityId),
        allocations: [
          { category: 'Health', amount: 300000 },
          { category: 'Education', amount: 300000 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceed/i);
  });

  it('returns 401 without auth token', async () => {
    const mun = await createMunicipality();
    const res = await request(app).post('/api/budgets').send(BUDGET_PAYLOAD(mun._id));
    expect(res.status).toBe(401);
  });
});

describe('Budget workflow: submit → approve → reject → reopen', () => {
  let token, municipalityId;

  beforeEach(async () => {
    ({ token, municipalityId } = await createUser({ role: 'municipal_admin' }));
  });

  it('submits a draft budget for approval', async () => {
    const create = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(BUDGET_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    const res = await request(app).patch(`/api/budgets/${id}/submit`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending_approval');
  });

  it('cannot submit a non-draft budget', async () => {
    const create = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(BUDGET_PAYLOAD(municipalityId));
    const id = create.body.data._id;

    await request(app).patch(`/api/budgets/${id}/submit`).set(authHeader(token));
    const res = await request(app).patch(`/api/budgets/${id}/submit`).set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('approves a pending budget', async () => {
    const create = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(BUDGET_PAYLOAD(municipalityId));
    const id = create.body.data._id;
    await request(app).patch(`/api/budgets/${id}/submit`).set(authHeader(token));

    const res = await request(app).patch(`/api/budgets/${id}/approve`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  it('prevents double-approval with 409', async () => {
    const create = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(BUDGET_PAYLOAD(municipalityId));
    const id = create.body.data._id;
    await request(app).patch(`/api/budgets/${id}/submit`).set(authHeader(token));
    await request(app).patch(`/api/budgets/${id}/approve`).set(authHeader(token));

    const res = await request(app).patch(`/api/budgets/${id}/approve`).set(authHeader(token));
    expect(res.status).toBe(409);
  });

  it('rejects a pending budget', async () => {
    const create = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(BUDGET_PAYLOAD(municipalityId));
    const id = create.body.data._id;
    await request(app).patch(`/api/budgets/${id}/submit`).set(authHeader(token));

    const res = await request(app)
      .patch(`/api/budgets/${id}/reject`)
      .set(authHeader(token))
      .send({ reason: 'Insufficient documentation' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
  });

  it('reopens a rejected budget back to draft', async () => {
    const create = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(BUDGET_PAYLOAD(municipalityId));
    const id = create.body.data._id;
    await request(app).patch(`/api/budgets/${id}/submit`).set(authHeader(token));
    await request(app).patch(`/api/budgets/${id}/reject`).set(authHeader(token)).send({ reason: 'Test' });

    const res = await request(app).patch(`/api/budgets/${id}/reopen`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');
  });
});

describe('GET /api/budgets — municipality scoping', () => {
  it('municipal_admin only sees their own municipality budgets', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: otherToken, municipalityId: otherMunId } = await createUser({ role: 'municipal_admin' });

    await request(app).post('/api/budgets').set(authHeader(token)).send(BUDGET_PAYLOAD(municipalityId));
    await request(app).post('/api/budgets').set(authHeader(otherToken)).send(BUDGET_PAYLOAD(otherMunId));

    const res = await request(app).get('/api/budgets').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].municipality._id || res.body.data[0].municipality).toBe(municipalityId.toString());
  });
});
