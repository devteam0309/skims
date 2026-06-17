const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBudget, createProgram, authHeader } = require('./helpers');
const Expense = require('../models/Expense');

jest.mock('../services/emailService', () => ({
  sendExpenseApproved: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const EXPENSE = (overrides = {}) => ({
  type: 'official_receipt',
  title: 'Office Supplies',
  amount: 1000,
  transactionDate: '2026-03-15',
  ...overrides,
});

describe('Expense vendorName → vendor.name mapping', () => {
  it('maps the flat vendorName field onto vendor.name on create', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const res = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send(EXPENSE({ vendorName: 'Acme Trading' }));
    expect(res.status).toBe(201);
    expect(res.body.data.vendor.name).toBe('Acme Trading');
  });

  it('maps vendorName onto vendor.name on update', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const created = await request(app).post('/api/expenses').set(authHeader(token)).send(EXPENSE());
    const id = created.body.data._id;

    const res = await request(app)
      .put(`/api/expenses/${id}`)
      .set(authHeader(token))
      .send({ vendorName: 'Updated Vendor' });
    expect(res.status).toBe(200);

    const updated = await Expense.findById(id);
    expect(updated.vendor.name).toBe('Updated Vendor');
  });
});

describe('Expense category allocation enforcement', () => {
  it('returns 400 when an expense exceeds its category allocation', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const program = await createProgram(municipalityId, user._id); // category: 'education'
    const budget = await createBudget(municipalityId, user._id, {
      totalBudget: 100000,
      remainingBalance: 100000,
      // category-level allocation (no program field) — triggers the category branch
      allocations: [{ category: 'education', amount: 2000 }],
    });

    const res = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send(EXPENSE({ amount: 2001, budget: budget._id.toString(), program: program._id.toString() }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/category allocation/i);
  });
});

describe('Expense cross-municipality / status guards', () => {
  it('blocks creating an expense for another municipality (403)', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const otherMunId = new mongoose.Types.ObjectId().toString();
    const res = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send(EXPENSE({ municipality: otherMunId }));
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/another municipality/i);
  });

  it('blocks editing an approved expense (400)', async () => {
    const { token: creator, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: approver } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const created = await request(app).post('/api/expenses').set(authHeader(creator)).send(EXPENSE());
    const id = created.body.data._id;
    await request(app).patch(`/api/expenses/${id}/approve`).set(authHeader(approver));

    const res = await request(app).put(`/api/expenses/${id}`).set(authHeader(creator)).send({ title: 'Changed' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/approved or liquidated/i);
  });

  it('blocks deleting an approved expense (400)', async () => {
    const { token: creator, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: admin } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const created = await request(app).post('/api/expenses').set(authHeader(creator)).send(EXPENSE());
    const id = created.body.data._id;
    await request(app).patch(`/api/expenses/${id}/approve`).set(authHeader(admin));

    const res = await request(app).delete(`/api/expenses/${id}`).set(authHeader(admin));
    expect(res.status).toBe(400);
  });

  it('soft-deletes a pending expense (200)', async () => {
    const { token: creator, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const { token: admin } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const created = await request(app).post('/api/expenses').set(authHeader(creator)).send(EXPENSE());
    const id = created.body.data._id;

    const res = await request(app).delete(`/api/expenses/${id}`).set(authHeader(admin));
    expect(res.status).toBe(200);

    const deleted = await Expense.findById(id);
    expect(deleted.deletedAt).not.toBeNull();
  });
});
