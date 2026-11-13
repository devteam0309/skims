const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBudget, authHeader } = require('./helpers');
const Budget = require('../models/Budget');

jest.mock('../services/emailService', () => ({
  sendBudgetApproved: jest.fn().mockResolvedValue({}),
  sendBudgetRejected: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

describe('DELETE /api/budgets/:id', () => {
  it('blocks deleting an approved budget (400)', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'super_admin' });
    const budget = await createBudget(municipalityId, user._id); // status: approved
    const res = await request(app).delete(`/api/budgets/${budget._id}`).set(authHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/approved/i);

    const stillThere = await Budget.findById(budget._id);
    expect(stillThere.deletedAt).toBeNull();
  });

  it('soft-deletes a draft budget (200)', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'super_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'draft' });
    const res = await request(app).delete(`/api/budgets/${budget._id}`).set(authHeader(token));
    expect(res.status).toBe(200);

    const deleted = await Budget.findById(budget._id);
    expect(deleted.deletedAt).not.toBeNull();
  });

  /*
   * Deleting now moves a budget to the recycle bin (October 2026), so the officers who write budgets
   * may do it — within their own scope. A municipal administrator could not delete at all before.
   */
  it("lets a municipal_admin move its own municipality's draft budget to the recycle bin", async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'draft' });
    const res = await request(app).delete(`/api/budgets/${budget._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect((await Budget.findById(budget._id)).deletedAt).not.toBeNull();
  });

  it("returns 403 when a municipal_admin deletes another municipality's budget", async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: otherToken } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'draft' });
    const res = await request(app).delete(`/api/budgets/${budget._id}`).set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent budget', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const res = await request(app).delete(`/api/budgets/${new mongoose.Types.ObjectId()}`).set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/budgets/:id — guards & derived fields', () => {
  it('blocks editing an approved budget (400)', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id); // approved
    const res = await request(app)
      .put(`/api/budgets/${budget._id}`)
      .set(authHeader(token))
      .send({ title: 'Changed' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/approved/i);
  });

  it('recalculates remainingBalance when totalBudget changes', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, {
      status: 'draft',
      totalBudget: 500000,
      disbursedAmount: 0,
      remainingBalance: 500000,
    });
    const res = await request(app)
      .put(`/api/budgets/${budget._id}`)
      .set(authHeader(token))
      .send({ totalBudget: 600000 });
    expect(res.status).toBe(200);
    expect(res.body.data.remainingBalance).toBe(600000);
  });
});

describe('GET /api/budgets/:id — municipality scoping', () => {
  it('blocks viewing another municipality\'s budget (403)', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id);
    const { token: otherToken } = await createUser({ role: 'municipal_admin' });

    const res = await request(app).get(`/api/budgets/${budget._id}`).set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });
});
