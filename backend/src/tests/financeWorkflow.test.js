/**
 * Fund Management authority, and the expense review workflow.
 *
 * Two rules are pinned here, both of which reverse an earlier arrangement deliberately:
 *
 *   1. `sk_chairperson` is VIEW-ONLY across Fund Management. They read budgets, expenses and
 *      liquidations and write none of them. They previously sat in `FINANCE_STAFF` (create) and
 *      `FINANCE_APPROVERS` (approve), so these assertions are the record of the change — not an
 *      accident of the guard lists.
 *   2. Creating and approving are separate hands. `sk_treasurer` records money and approves nothing;
 *      the administrator tiers review. The older self-approval guard remains as a second line for the
 *      admins, who can do both.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBudget, createProgram, authHeader } = require('./helpers');
const Expense = require('../models/Expense');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const EXPENSE = (overrides = {}) => ({
  type: 'purchase_request',
  title: 'Sports equipment',
  amount: 5000,
  transactionDate: '2026-03-15',
  ...overrides,
});

describe('SK Chairperson is view-only in Fund Management', () => {
  it('can read budgets, expenses and liquidations', async () => {
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token } = await createUser({ role: 'sk_chairperson', municipality: municipalityId });

    for (const path of ['/api/budgets', '/api/expenses', '/api/liquidations']) {
      const res = await request(app).get(path).set(authHeader(token));
      expect(res.status).toBe(200);
    }
  });

  it('cannot create a budget, an expense or a liquidation', async () => {
    const { user: admin, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token } = await createUser({ role: 'sk_chairperson', municipality: municipalityId });
    const program = await createProgram(municipalityId, admin._id);

    const budget = await request(app).post('/api/budgets').set(authHeader(token))
      .send({ title: 'FY 2027', fiscalYear: 2027, totalBudget: 100000 });
    expect(budget.status).toBe(403);

    const expense = await request(app).post('/api/expenses').set(authHeader(token)).send(EXPENSE());
    expect(expense.status).toBe(403);

    const liquidation = await request(app).post('/api/liquidations').set(authHeader(token))
      .send({ title: 'Q1 liquidation', program: program._id.toString(), totalAmount: 5000 });
    expect(liquidation.status).toBe(403);
  });

  it('cannot approve or reject an expense, a budget or a liquidation', async () => {
    const { user: admin, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: chairToken } = await createUser({ role: 'sk_chairperson', municipality: municipalityId });
    const { token: treasurerToken } = await createUser({ role: 'sk_treasurer', municipality: municipalityId });
    const budget = await createBudget(municipalityId, admin._id, { status: 'pending_approval' });

    const created = await request(app).post('/api/expenses').set(authHeader(treasurerToken)).send(EXPENSE());
    expect(created.status).toBe(201);
    const expenseId = created.body.data._id;

    const approve = await request(app).patch(`/api/expenses/${expenseId}/approve`).set(authHeader(chairToken));
    expect(approve.status).toBe(403);

    const reject = await request(app).patch(`/api/expenses/${expenseId}/reject`)
      .set(authHeader(chairToken)).send({ rejectionReason: 'Not needed' });
    expect(reject.status).toBe(403);

    const budgetApprove = await request(app).patch(`/api/budgets/${budget._id}/approve`).set(authHeader(chairToken));
    expect(budgetApprove.status).toBe(403);
  });
});

describe('SK Treasurer records money but never approves it', () => {
  it('can create and edit an expense', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const created = await request(app).post('/api/expenses').set(authHeader(token)).send(EXPENSE());
    expect(created.status).toBe(201);

    const edited = await request(app).put(`/api/expenses/${created.body.data._id}`)
      .set(authHeader(token)).send({ title: 'Sports equipment (revised)' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.title).toBe('Sports equipment (revised)');
  });

  it('cannot approve, reject or bulk-approve', async () => {
    const { user: admin, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: treasurerToken } = await createUser({ role: 'sk_treasurer', municipality: municipalityId });
    const other = await Expense.create({ ...EXPENSE(), transactionDate: new Date('2026-03-15'), municipality: municipalityId, createdBy: admin._id });

    const approve = await request(app).patch(`/api/expenses/${other._id}/approve`).set(authHeader(treasurerToken));
    expect(approve.status).toBe(403);

    const reject = await request(app).patch(`/api/expenses/${other._id}/reject`)
      .set(authHeader(treasurerToken)).send({ rejectionReason: 'No' });
    expect(reject.status).toBe(403);

    const bulk = await request(app).patch('/api/expenses/bulk-approve')
      .set(authHeader(treasurerToken)).send({ ids: [other._id.toString()] });
    expect(bulk.status).toBe(403);
  });
});

describe('Expense review workflow', () => {
  it('moves draft to pending on submit, and refuses to submit twice', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const created = await request(app).post('/api/expenses').set(authHeader(token))
      .send(EXPENSE({ saveAsDraft: true }));
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('draft');

    const submitted = await request(app).patch(`/api/expenses/${created.body.data._id}/submit`).set(authHeader(token));
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.status).toBe('pending');
    expect(submitted.body.data.submittedAt).toBeTruthy();

    // Atomic on the expected state, so a second click is told rather than silently repeated.
    const again = await request(app).patch(`/api/expenses/${created.body.data._id}/submit`).set(authHeader(token));
    expect(again.status).toBe(409);
  });

  it('defaults to pending, so records written before the draft state keep their meaning', async () => {
    const { token } = await createUser({ role: 'sk_treasurer' });
    const created = await request(app).post('/api/expenses').set(authHeader(token)).send(EXPENSE());
    expect(created.body.data.status).toBe('pending');
  });

  it('lets an administrator reject a pending expense with a reason', async () => {
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: treasurerToken, user: treasurer } = await createUser({ role: 'sk_treasurer', municipality: municipalityId });
    const { token: adminToken, user: admin } = await createUser({ role: 'municipal_admin', municipality: municipalityId });

    const created = await request(app).post('/api/expenses').set(authHeader(treasurerToken)).send(EXPENSE());
    const id = created.body.data._id;

    const res = await request(app).patch(`/api/expenses/${id}/reject`)
      .set(authHeader(adminToken))
      .send({ rejectionReason: 'Missing the supplier quotation' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
    expect(res.body.data.rejectionReason).toBe('Missing the supplier quotation');
    expect(res.body.data.rejectedBy.toString()).toBe(admin._id.toString());
    expect(res.body.data.rejectedAt).toBeTruthy();

    // Audited, with the before and after state.
    const log = await AuditLog.findOne({ action: 'REJECT', resource: 'expense', resourceId: id });
    expect(log).toBeTruthy();
    expect(log.newValues.status).toBe('rejected');
    expect(log.details.rejectionReason).toBe('Missing the supplier quotation');
    expect(log.municipality.toString()).toBe(municipalityId.toString());

    // And the treasurer is told, since they are the one who has to act on it.
    const note = await Notification.findOne({ recipient: treasurer._id, type: 'approval_rejected' });
    expect(note).toBeTruthy();
    expect(note.message).toMatch(/Missing the supplier quotation/);
  });

  it('requires a reason to reject', async () => {
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: treasurerToken } = await createUser({ role: 'sk_treasurer', municipality: municipalityId });
    const { token: adminToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });

    const created = await request(app).post('/api/expenses').set(authHeader(treasurerToken)).send(EXPENSE());
    const res = await request(app).patch(`/api/expenses/${created.body.data._id}/reject`)
      .set(authHeader(adminToken)).send({});
    expect(res.status).toBe(422);
  });

  it('cannot reject an already approved expense, so nothing appears approved and rejected at once', async () => {
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: treasurerToken } = await createUser({ role: 'sk_treasurer', municipality: municipalityId });
    const { token: adminToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });

    const created = await request(app).post('/api/expenses').set(authHeader(treasurerToken)).send(EXPENSE());
    const id = created.body.data._id;
    const approved = await request(app).patch(`/api/expenses/${id}/approve`).set(authHeader(adminToken));
    expect(approved.status).toBe(200);

    const res = await request(app).patch(`/api/expenses/${id}/reject`)
      .set(authHeader(adminToken)).send({ rejectionReason: 'Changed my mind' });
    expect(res.status).toBe(400);
  });

  it('lets a rejected expense be corrected and resubmitted, clearing the reason', async () => {
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: treasurerToken } = await createUser({ role: 'sk_treasurer', municipality: municipalityId });
    const { token: adminToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });

    const created = await request(app).post('/api/expenses').set(authHeader(treasurerToken)).send(EXPENSE());
    const id = created.body.data._id;
    await request(app).patch(`/api/expenses/${id}/reject`).set(authHeader(adminToken)).send({ rejectionReason: 'Fix the date' });

    const edited = await request(app).put(`/api/expenses/${id}`).set(authHeader(treasurerToken))
      .send({ transactionDate: '2026-03-20' });
    expect(edited.status).toBe(200);

    const resubmitted = await request(app).patch(`/api/expenses/${id}/submit`).set(authHeader(treasurerToken));
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.status).toBe('pending');
    expect(resubmitted.body.data.rejectionReason).toBeUndefined();
  });

  it('refuses to reject an expense in another municipality', async () => {
    const { user: foreignAdmin, municipalityId: foreignMunId } = await createUser({ role: 'municipal_admin' });
    const { token: adminToken } = await createUser({ role: 'municipal_admin' });
    const foreign = await Expense.create({
      ...EXPENSE(), transactionDate: new Date('2026-03-15'), municipality: foreignMunId, createdBy: foreignAdmin._id,
    });

    const res = await request(app).patch(`/api/expenses/${foreign._id}/reject`)
      .set(authHeader(adminToken)).send({ rejectionReason: 'Not mine to review' });
    expect(res.status).toBe(403);
  });
});

describe('Expense deletion respects municipality', () => {
  // This handler had no scope check at all, and DELETE is open to ADMINS — which includes the
  // municipality-scoped municipal_admin.
  it('refuses to delete an expense in another municipality', async () => {
    const { user: foreignAdmin, municipalityId: foreignMunId } = await createUser({ role: 'municipal_admin' });
    const { token } = await createUser({ role: 'municipal_admin' });
    const foreign = await Expense.create({
      ...EXPENSE(), transactionDate: new Date('2026-03-15'), municipality: foreignMunId, createdBy: foreignAdmin._id,
    });

    const res = await request(app).delete(`/api/expenses/${foreign._id}`).set(authHeader(token));
    expect(res.status).toBe(403);
    const still = await Expense.findById(foreign._id);
    expect(still.deletedAt).toBeNull();
  });
});
