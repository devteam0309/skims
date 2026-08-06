const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createMunicipality, createBudget, authHeader } = require('./helpers');
const AuditLog = require('../models/AuditLog');
const Budget = require('../models/Budget');

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

// `protect` populates req.user.municipality, so a budget whose municipality was forced from the
// token comes back as a populated object, while an explicitly-supplied one comes back as an id.
const munId = (m) => (typeof m === 'string' ? m : m?._id?.toString());

describe('POST /api/budgets — municipality cannot be set from the request body', () => {
  it('ignores a body municipality for a municipal_admin and forces their own', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    const foreign = await createMunicipality();

    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(newBudget({ municipality: foreign._id.toString() }));

    expect(res.status).toBe(201);
    expect(munId(res.body.data.municipality)).toBe(municipalityId.toString());
    expect(munId(res.body.data.municipality)).not.toBe(foreign._id.toString());
  });

  it('ignores a body municipality for an sk_treasurer too', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const foreign = await createMunicipality();

    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(newBudget({ municipality: foreign._id.toString() }));

    expect(res.status).toBe(201);
    expect(munId(res.body.data.municipality)).toBe(municipalityId.toString());
  });

  it('allows a super_admin to target another municipality explicitly', async () => {
    const target = await createMunicipality();
    const { token } = await createUser({ role: 'super_admin' });

    const res = await request(app)
      .post('/api/budgets')
      .set(authHeader(token))
      .send(newBudget({ municipality: target._id.toString() }));

    expect(res.status).toBe(201);
    expect(munId(res.body.data.municipality)).toBe(target._id.toString());
  });
});

describe('budget AuditLog entries carry the budget\'s municipality', () => {
  const auditFor = async (resourceId, action) =>
    AuditLog.findOne({ resource: 'budget', resourceId, action });

  it('CREATE logs the municipality', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).post('/api/budgets').set(authHeader(token)).send(newBudget());

    const log = await auditFor(res.body.data._id, 'CREATE');
    expect(log).not.toBeNull();
    expect(log.municipality?.toString()).toBe(municipalityId.toString());
  });

  it('UPDATE logs the municipality', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'draft' });

    await request(app).put(`/api/budgets/${budget._id}`).set(authHeader(token)).send({ title: 'Revised' });

    const log = await auditFor(budget._id, 'UPDATE');
    expect(log.municipality?.toString()).toBe(municipalityId.toString());
  });

  it('SUBMIT logs the municipality', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'draft' });

    await request(app).patch(`/api/budgets/${budget._id}/submit`).set(authHeader(token));

    const log = await auditFor(budget._id, 'SUBMIT');
    expect(log.municipality?.toString()).toBe(municipalityId.toString());
  });

  it('APPROVE logs the municipality', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'pending_approval' });

    await request(app).patch(`/api/budgets/${budget._id}/approve`).set(authHeader(token));

    const log = await auditFor(budget._id, 'APPROVE');
    expect(log.municipality?.toString()).toBe(municipalityId.toString());
  });

  it('REJECT logs the municipality', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'pending_approval' });

    await request(app).patch(`/api/budgets/${budget._id}/reject`).set(authHeader(token)).send({ reason: 'Insufficient detail' });

    const log = await auditFor(budget._id, 'REJECT');
    expect(log.municipality?.toString()).toBe(municipalityId.toString());
  });

  it('REOPEN logs the municipality', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(municipalityId, user._id, { status: 'rejected' });

    await request(app).patch(`/api/budgets/${budget._id}/reopen`).set(authHeader(token));

    const log = await auditFor(budget._id, 'REOPEN');
    expect(log.municipality?.toString()).toBe(municipalityId.toString());
  });

  it('DELETE logs the budget\'s municipality, not the acting super_admin\'s (who has none)', async () => {
    const owner = await createUser({ role: 'municipal_admin' });
    const budget = await createBudget(owner.municipalityId, owner.user._id, { status: 'draft' });
    // A super_admin belongs to a different municipality than the budget they are deleting.
    const { token: adminToken } = await createUser({ role: 'super_admin' });

    const res = await request(app).delete(`/api/budgets/${budget._id}`).set(authHeader(adminToken));
    expect(res.status).toBe(200);

    const log = await auditFor(budget._id, 'DELETE');
    expect(log.municipality?.toString()).toBe(owner.municipalityId.toString());

    const deleted = await Budget.findById(budget._id);
    expect(deleted.deletedAt).not.toBeNull();
  });
});
