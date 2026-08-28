const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createMunicipality, createBudget, createProgram, authHeader } = require('./helpers');
const Program = require('../models/Program');
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');

jest.mock('../services/emailService', () => ({
  sendExpenseApproved: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

/*
 * The approval workflow the review panel described: a program is submitted, cleared by an admin,
 * and the money it will consume is set aside against the municipality's budget at that moment.
 */
describe('program approval workflow', () => {
  it('creates programs in draft', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const program = await createProgram(municipalityId, user._id);
    expect(program.approvalStatus).toBe('draft');
  });

  it('submits a draft program for approval', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const program = await createProgram(municipalityId, user._id);

    const res = await request(app).patch(`/api/programs/${program._id}/submit`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('submitted');
    expect(res.body.data.submittedAt).toBeTruthy();
  });

  it('rejects a second submit of the same program (409)', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const program = await createProgram(municipalityId, user._id, { approvalStatus: 'submitted' });

    const res = await request(app).patch(`/api/programs/${program._id}/submit`).set(authHeader(token));
    expect(res.status).toBe(409);
  });

  // The panel's requirement: a missing budget must not stand in the way of the decision.
  it('approves a submitted program that has no budget at all', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: adminToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const program = await createProgram(municipalityId, user._id, {
      approvalStatus: 'submitted', budget: 0, budgetRef: null,
    });

    const res = await request(app).patch(`/api/programs/${program._id}/approve`).set(authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('approved');
    expect(res.body.data.committedAmount).toBe(0);
  });

  it('commits the program amount against the linked budget on approval', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: adminToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const budget = await createBudget(municipalityId, user._id); // 500,000 approved
    const program = await createProgram(municipalityId, user._id, {
      approvalStatus: 'submitted', budget: 120000, budgetRef: budget._id,
    });

    const res = await request(app).patch(`/api/programs/${program._id}/approve`).set(authHeader(adminToken));
    expect(res.status).toBe(200);

    const after = await Budget.findById(budget._id);
    expect(after.committedAmount).toBe(120000);
    // Committing is not spending — disbursed must not move until an expense is approved.
    expect(after.disbursedAmount).toBe(0);
    expect(after.availableBalance).toBe(380000);
  });

  it('refuses to commit more than the budget still has uncommitted', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: adminToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const budget = await createBudget(municipalityId, user._id, { committedAmount: 450000 });
    const program = await createProgram(municipalityId, user._id, {
      approvalStatus: 'submitted', budget: 120000, budgetRef: budget._id,
    });

    const res = await request(app).patch(`/api/programs/${program._id}/approve`).set(authHeader(adminToken));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/uncommitted/i);

    const untouched = await Program.findById(program._id);
    expect(untouched.approvalStatus).toBe('submitted');
  });

  it('blocks approving your own program', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const program = await createProgram(municipalityId, user._id, { approvalStatus: 'submitted' });

    const res = await request(app).patch(`/api/programs/${program._id}/approve`).set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('rejects a submitted program with a reason and commits nothing', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: adminToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const budget = await createBudget(municipalityId, user._id);
    const program = await createProgram(municipalityId, user._id, {
      approvalStatus: 'submitted', budget: 120000, budgetRef: budget._id,
    });

    const res = await request(app)
      .patch(`/api/programs/${program._id}/reject`)
      .set(authHeader(adminToken))
      .send({ reason: 'Duplicate of an existing program' });
    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('rejected');

    const after = await Budget.findById(budget._id);
    expect(after.committedAmount).toBe(0);
  });

  it('lets a rejected program be revised and resubmitted', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const program = await createProgram(municipalityId, user._id, { approvalStatus: 'rejected' });

    const res = await request(app).patch(`/api/programs/${program._id}/submit`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.approvalStatus).toBe('submitted');
  });

  it('will not let an admin approve a program from another municipality', async () => {
    const other = await createMunicipality();
    const { user } = await createUser({ role: 'sk_chairperson', municipality: other._id });
    const { token: adminToken } = await createUser({ role: 'municipal_admin' });
    const program = await createProgram(other._id, user._id, { approvalStatus: 'submitted' });

    const res = await request(app).patch(`/api/programs/${program._id}/approve`).set(authHeader(adminToken));
    expect(res.status).toBe(403);
  });
});

describe('commitments release as money is actually spent', () => {
  it('moves an approved expense out of committed and into disbursed', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: adminToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const budget = await createBudget(municipalityId, user._id);
    const program = await createProgram(municipalityId, user._id, {
      approvalStatus: 'submitted', budget: 120000, budgetRef: budget._id,
    });
    await request(app).patch(`/api/programs/${program._id}/approve`).set(authHeader(adminToken));

    const expense = await Expense.create({
      title: 'Venue rental',
      type: 'purchase_request',
      amount: 50000,
      category: 'supplies',
      municipality: municipalityId,
      program: program._id,
      budget: budget._id,
      transactionDate: new Date(),
      status: 'pending',
      createdBy: user._id,
    });

    const res = await request(app).patch(`/api/expenses/${expense._id}/approve`).set(authHeader(adminToken));
    expect(res.status).toBe(200);

    const after = await Budget.findById(budget._id);
    expect(after.disbursedAmount).toBe(50000);
    // 120,000 was committed; 50,000 of it has now genuinely been spent.
    expect(after.committedAmount).toBe(70000);
    // The same 50,000 must not be subtracted twice.
    expect(after.availableBalance).toBe(380000);
  });

  it('releases the commitment when an approved program is deleted', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token: adminToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const budget = await createBudget(municipalityId, user._id);
    const program = await createProgram(municipalityId, user._id, {
      approvalStatus: 'submitted', budget: 120000, budgetRef: budget._id,
    });
    await request(app).patch(`/api/programs/${program._id}/approve`).set(authHeader(adminToken));

    const res = await request(app).delete(`/api/programs/${program._id}`).set(authHeader(adminToken));
    expect(res.status).toBe(200);

    const after = await Budget.findById(budget._id);
    expect(after.committedAmount).toBe(0);
  });
});
