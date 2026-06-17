const request = require('supertest');
const mongoose = require('mongoose');
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

const EXPENSE = (overrides = {}) => ({
  type: 'official_receipt',
  title: 'Supplies',
  amount: 1000,
  transactionDate: '2026-03-15',
  ...overrides,
});

const createExpenseAs = async (token, overrides = {}) => {
  const res = await request(app).post('/api/expenses').set(authHeader(token)).send(EXPENSE(overrides));
  expect(res.status).toBe(201);
  return res.body.data._id;
};

describe('PATCH /api/expenses/bulk-approve', () => {
  it('approves multiple eligible expenses created by another user', async () => {
    const { token: creator, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: approver } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const id1 = await createExpenseAs(creator);
    const id2 = await createExpenseAs(creator);

    const res = await request(app)
      .patch('/api/expenses/bulk-approve')
      .set(authHeader(approver))
      .send({ ids: [id1, id2] });

    expect(res.status).toBe(200);
    expect(res.body.data.approved).toBe(2);
    expect(res.body.data.skipped).toBe(0);
  });

  it('skips self-created expenses (cannot approve your own)', async () => {
    const { token: creator, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: approver } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const ownId = await createExpenseAs(approver); // approver created this one
    const otherId = await createExpenseAs(creator);

    const res = await request(app)
      .patch('/api/expenses/bulk-approve')
      .set(authHeader(approver))
      .send({ ids: [ownId, otherId] });

    expect(res.status).toBe(200);
    expect(res.body.data.approved).toBe(1);
    expect(res.body.data.skipped).toBe(1);
  });

  it('skips already-approved expenses', async () => {
    const { token: creator, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: approver } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const id1 = await createExpenseAs(creator);
    const id2 = await createExpenseAs(creator);
    await request(app).patch(`/api/expenses/${id1}/approve`).set(authHeader(approver));

    const res = await request(app)
      .patch('/api/expenses/bulk-approve')
      .set(authHeader(approver))
      .send({ ids: [id1, id2] });

    expect(res.status).toBe(200);
    expect(res.body.data.approved).toBe(1);
  });

  it('does not approve expenses from another municipality', async () => {
    const { token: otherCreator } = await createUser({ role: 'sk_treasurer' });
    const otherId = await createExpenseAs(otherCreator);
    const { token: approver } = await createUser({ role: 'municipal_admin' });

    const res = await request(app)
      .patch('/api/expenses/bulk-approve')
      .set(authHeader(approver))
      .send({ ids: [otherId] });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no eligible/i);
  });

  it('aggregates budget disbursement across approved expenses', async () => {
    const { token: creator, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: approver } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const budget = await createBudget(municipalityId, user._id, { totalBudget: 100000, remainingBalance: 100000 });
    const id1 = await createExpenseAs(creator, { amount: 1000, budget: budget._id.toString() });
    const id2 = await createExpenseAs(creator, { amount: 2500, budget: budget._id.toString() });

    const res = await request(app)
      .patch('/api/expenses/bulk-approve')
      .set(authHeader(approver))
      .send({ ids: [id1, id2] });
    expect(res.status).toBe(200);

    const updated = await Budget.findById(budget._id);
    expect(updated.disbursedAmount).toBe(3500);
    expect(updated.remainingBalance).toBe(96500);
  });

  it('increments program actualExpenses across approved expenses', async () => {
    const { token: creator, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: approver } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const program = await createProgram(municipalityId, user._id);
    const id1 = await createExpenseAs(creator, { amount: 1500, program: program._id.toString() });
    const id2 = await createExpenseAs(creator, { amount: 500, program: program._id.toString() });

    await request(app)
      .patch('/api/expenses/bulk-approve')
      .set(authHeader(approver))
      .send({ ids: [id1, id2] });

    const updated = await Program.findById(program._id);
    expect(updated.actualExpenses).toBe(2000);
  });

  it('returns 400 for an empty ids array', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).patch('/api/expenses/bulk-approve').set(authHeader(token)).send({ ids: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when more than 50 ids are submitted', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const ids = Array.from({ length: 51 }, () => new mongoose.Types.ObjectId().toString());
    const res = await request(app).patch('/api/expenses/bulk-approve').set(authHeader(token)).send({ ids });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/50/);
  });

  it('returns 403 for a role without approval rights (sk_kagawad)', async () => {
    const { token } = await createUser({ role: 'sk_kagawad' });
    const res = await request(app)
      .patch('/api/expenses/bulk-approve')
      .set(authHeader(token))
      .send({ ids: [new mongoose.Types.ObjectId().toString()] });
    expect(res.status).toBe(403);
  });
});
