const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBudget, createProgram, authHeader } = require('./helpers');
const Budget = require('../models/Budget');
const Program = require('../models/Program');

jest.mock('../services/emailService', () => ({
  sendExpenseApproved: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const EXPENSE_PAYLOAD = (overrides = {}) => ({
  type: 'official_receipt',
  title: 'Office Supplies',
  amount: 5000,
  transactionDate: '2026-03-15',
  ...overrides,
});

describe('POST /api/expenses', () => {
  it('creates an expense and returns 201', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send(EXPENSE_PAYLOAD());
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Office Supplies');
  });

  it('returns 422 for invalid expense type', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send(EXPENSE_PAYLOAD({ type: 'invalid_type' }));
    expect(res.status).toBe(422);
  });

  it('returns 422 for zero amount', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send(EXPENSE_PAYLOAD({ amount: 0 }));
    expect(res.status).toBe(422);
  });

  it('returns 400 when amount exceeds remaining budget balance', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const budget = await createBudget(municipalityId, user._id, {
      totalBudget: 1000,
      remainingBalance: 1000,
    });

    const res = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send(EXPENSE_PAYLOAD({ amount: 1500, budget: budget._id.toString() }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/balance/i);
  });

  it('returns 400 when charging to a non-approved budget', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const budget = await createBudget(municipalityId, user._id, { status: 'draft' });

    const res = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send(EXPENSE_PAYLOAD({ budget: budget._id.toString() }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/approved/i);
  });

  it('returns 400 when expense exceeds program allocation', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const program = await createProgram(municipalityId, user._id);
    const budget = await createBudget(municipalityId, user._id, {
      totalBudget: 100000,
      remainingBalance: 100000,
      allocations: [{ category: 'Education', amount: 3000, program: program._id }],
    });

    const res = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send(EXPENSE_PAYLOAD({
        amount: 3001,
        budget: budget._id.toString(),
        program: program._id.toString(),
      }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/allocation/i);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/expenses').send(EXPENSE_PAYLOAD());
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/expenses/:id/approve', () => {
  it('blocks self-approval with 403', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });

    const createRes = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send(EXPENSE_PAYLOAD());
    expect(createRes.status).toBe(201);
    const id = createRes.body.data._id;

    const approveRes = await request(app)
      .patch(`/api/expenses/${id}/approve`)
      .set(authHeader(token));
    expect(approveRes.status).toBe(403);
    expect(approveRes.body.message).toMatch(/cannot approve/i);
  });

  it('approves an expense created by someone else', async () => {
    const { token: creatorToken, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: approverToken } = await createUser({
      role: 'municipal_admin',
      municipality: municipalityId,
    });

    const createRes = await request(app)
      .post('/api/expenses')
      .set(authHeader(creatorToken))
      .send(EXPENSE_PAYLOAD());
    const id = createRes.body.data._id;

    const res = await request(app)
      .patch(`/api/expenses/${id}/approve`)
      .set(authHeader(approverToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  it('updates budget disbursedAmount when expense has a direct budget link', async () => {
    const { token: creatorToken, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: approverToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const budget = await createBudget(municipalityId, user._id, { totalBudget: 100000, remainingBalance: 100000 });

    const createRes = await request(app)
      .post('/api/expenses')
      .set(authHeader(creatorToken))
      .send(EXPENSE_PAYLOAD({ amount: 5000, budget: budget._id.toString() }));
    const id = createRes.body.data._id;

    await request(app).patch(`/api/expenses/${id}/approve`).set(authHeader(approverToken));

    const updated = await Budget.findById(budget._id);
    expect(updated.disbursedAmount).toBe(5000);
    expect(updated.remainingBalance).toBe(95000);
  });

  it('cascades budget update via program.budgetRef when expense has no direct budget link', async () => {
    const { token: creatorToken, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: approverToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const budget = await createBudget(municipalityId, user._id, { totalBudget: 100000, remainingBalance: 100000 });
    const program = await createProgram(municipalityId, user._id, { budgetRef: budget._id });

    const createRes = await request(app)
      .post('/api/expenses')
      .set(authHeader(creatorToken))
      .send(EXPENSE_PAYLOAD({ amount: 8000, program: program._id.toString() }));
    const id = createRes.body.data._id;

    await request(app).patch(`/api/expenses/${id}/approve`).set(authHeader(approverToken));

    const updatedBudget = await Budget.findById(budget._id);
    const updatedProgram = await Program.findById(program._id);
    expect(updatedBudget.disbursedAmount).toBe(8000);
    expect(updatedBudget.remainingBalance).toBe(92000);
    expect(updatedProgram.actualExpenses).toBe(8000);
  });
});
