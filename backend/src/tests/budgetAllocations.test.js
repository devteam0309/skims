const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBudget, authHeader } = require('./helpers');

jest.mock('../services/emailService', () => ({
  sendBudgetApproved: jest.fn().mockResolvedValue({}),
  sendBudgetRejected: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const newBudget = (overrides = {}) => ({
  title: 'FY Budget',
  fiscalYear: 2026,
  totalBudget: 1000000,
  ...overrides,
});

describe('POST /api/budgets — allocation validation', () => {
  it('rejects allocations totalling more than the budget (400)', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(newBudget({
        allocations: [
          { category: 'sports', amount: 700000 },
          { category: 'health', amount: 400000 },
        ],
      }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot exceed/i);
  });

  it('rejects duplicate categories regardless of casing (400)', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(newBudget({
        allocations: [
          { category: 'health', amount: 100000 },
          { category: 'Health', amount: 50000 },
        ],
      }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/duplicate/i);
  });

  it('rejects an allocation with no category (400)', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(newBudget({ allocations: [{ amount: 100000 }] }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/category/i);
  });

  it('rejects duplicate program allocations (400)', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const programId = new mongoose.Types.ObjectId();
    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(newBudget({
        allocations: [
          { category: 'sports', amount: 100000, program: programId },
          { category: 'sports', amount: 50000, program: programId },
        ],
      }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/program/i);
  });

  it('accepts valid allocations and persists them (201)', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(newBudget({
        allocations: [
          { category: 'sports', amount: 300000, description: 'Palaro' },
          { category: 'health', amount: 200000 },
        ],
      }));
    expect(res.status).toBe(201);
    expect(res.body.data.allocations).toHaveLength(2);
    expect(res.body.data.allocations[0].category).toBe('sports');
    expect(res.body.data.allocations[0].description).toBe('Palaro');
  });

  it('still accepts a budget with no allocations (201)', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).post('/api/budgets').set(authHeader(token)).send(newBudget());
    expect(res.status).toBe(201);
    expect(res.body.data.allocations).toHaveLength(0);
  });
});

describe('PUT /api/budgets/:id — allocation validation', () => {
  it('rejects an update whose allocations exceed the budget (400)', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'draft', totalBudget: 500000 });

    const res = await request(app)
      .put(`/api/budgets/${budget._id}`)
      .set(authHeader(token))
      .send({ allocations: [{ category: 'sports', amount: 600000 }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot exceed/i);
  });

  it('rejects lowering totalBudget below already-saved allocations (400)', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, {
      status: 'draft',
      totalBudget: 500000,
      allocations: [{ category: 'sports', amount: 400000 }],
    });

    const res = await request(app)
      .put(`/api/budgets/${budget._id}`)
      .set(authHeader(token))
      .send({ totalBudget: 300000 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot exceed/i);
  });

  it('rejects duplicate categories on update (400)', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'draft', totalBudget: 500000 });

    const res = await request(app)
      .put(`/api/budgets/${budget._id}`)
      .set(authHeader(token))
      .send({
        allocations: [
          { category: 'sports', amount: 100000 },
          { category: 'sports', amount: 100000 },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/duplicate/i);
  });

  it('accepts a valid allocation update (200)', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'draft', totalBudget: 500000 });

    const res = await request(app)
      .put(`/api/budgets/${budget._id}`)
      .set(authHeader(token))
      .send({ allocations: [{ category: 'education', amount: 250000 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.allocations).toHaveLength(1);
    expect(res.body.data.allocations[0].category).toBe('education');
  });

  it('allows raising totalBudget with existing allocations intact (200)', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, {
      status: 'draft',
      totalBudget: 500000,
      disbursedAmount: 0,
      allocations: [{ category: 'sports', amount: 400000 }],
    });

    const res = await request(app)
      .put(`/api/budgets/${budget._id}`)
      .set(authHeader(token))
      .send({ totalBudget: 900000 });
    expect(res.status).toBe(200);
    expect(res.body.data.remainingBalance).toBe(900000);
    expect(res.body.data.allocations).toHaveLength(1);
  });
});
