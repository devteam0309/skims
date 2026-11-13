/**
 * Barangay finance, October 2026 panel round (items 5.1, 6.x, 7.2–7.5, 8).
 *
 * Boac's municipal budget is ₱500,000. Agot and Maligaya each get an allocation carved out of it.
 * Agot's treasurer records expenses against Agot's allocation only; Boac's municipal administrator
 * reviews them; nothing is deducted until approval, and nothing is ever deducted twice.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const {
  createUser, createMunicipality, createBarangay, createBudget, createProgram, authHeader, multipart, PDF,
} = require('./helpers');
const Budget = require('../models/Budget');
const Expense = require('../models/Expense');
const Liquidation = require('../models/Liquidation');
const AuditLog = require('../models/AuditLog');

jest.mock('../services/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue({}) }));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const world = async ({ agotAllocation = 100000 } = {}) => {
  const boac = await createMunicipality({ name: 'Boac', code: 'BOA' });
  const gasan = await createMunicipality({ name: 'Gasan', code: 'GAS' });
  const agot = await createBarangay(boac._id, { name: 'Agot' });
  const maligaya = await createBarangay(boac._id, { name: 'Maligaya' });
  const w = {
    boac, gasan, agot, maligaya,
    admin: await createUser({ role: 'municipal_admin', municipality: boac._id }),
    admin2: await createUser({ role: 'municipal_admin', municipality: boac._id }),
    chair: await createUser({ role: 'sk_chairperson', municipality: boac._id, barangay: agot._id }),
    treasurer: await createUser({ role: 'sk_treasurer', municipality: boac._id, barangay: agot._id }),
    secretary: await createUser({ role: 'sk_secretary', municipality: boac._id, barangay: agot._id }),
    maligayaChair: await createUser({ role: 'sk_chairperson', municipality: boac._id, barangay: maligaya._id }),
    maligayaTreasurer: await createUser({ role: 'sk_treasurer', municipality: boac._id, barangay: maligaya._id }),
    gasanAdmin: await createUser({ role: 'municipal_admin', municipality: gasan._id }),
    dilg: await createUser({ role: 'dilg_representative', municipality: null }),
  };
  w.pool = await createBudget(boac._id, w.admin.user._id, { title: 'SK Boac 2026', totalBudget: 500000, remainingBalance: 500000 });
  w.agotBudget = await createBudget(boac._id, w.admin.user._id, { title: 'Agot 2026', barangay: agot._id, totalBudget: agotAllocation, remainingBalance: agotAllocation });
  w.maligayaBudget = await createBudget(boac._id, w.admin.user._id, { title: 'Maligaya 2026', barangay: maligaya._id, totalBudget: 50000, remainingBalance: 50000 });
  return w;
};

const EXPENSE = (extra = {}) => ({
  type: 'official_receipt', title: 'Clean-up supplies', amount: 5000, transactionDate: '2026-03-10', ...extra,
});
const postExpense = (token, body, opts) => multipart(request(app).post('/api/expenses').set(authHeader(token)), body, opts);
const approve = (token, id) => request(app).patch(`/api/expenses/${id}/approve`).set(authHeader(token));
const budgetOf = async (id) => Budget.findById(id).lean();

describe('per-barangay budgets (6.1, 6.2, 7.2)', () => {
  it('shows each barangay only its own allocation — never the municipal total or a neighbour\'s', async () => {
    const w = await world();
    for (const officer of [w.chair, w.treasurer, w.secretary]) {
      const res = await request(app).get('/api/budgets').set(authHeader(officer.token));
      expect(res.body.data.map((b) => b.title)).toEqual(['Agot 2026']);
    }
    expect((await request(app).get(`/api/budgets/${w.pool._id}`).set(authHeader(w.treasurer.token))).status).toBe(403);
    expect((await request(app).get(`/api/budgets/${w.maligayaBudget._id}`).set(authHeader(w.chair.token))).status).toBe(403);

    const admin = await request(app).get('/api/budgets').set(authHeader(w.admin.token));
    expect(admin.body.data.map((b) => b.title).sort()).toEqual(['Agot 2026', 'Maligaya 2026', 'SK Boac 2026']);
    const oneBarangay = await request(app).get(`/api/budgets?barangay=${w.maligaya._id}`).set(authHeader(w.admin.token));
    expect(oneBarangay.body.data.map((b) => b.title)).toEqual(['Maligaya 2026']);
    const byName = await request(app).get('/api/budgets?search=agot').set(authHeader(w.admin.token));
    expect(byName.body.data.map((b) => b.title)).toEqual(['Agot 2026']);
    expect((await request(app).get('/api/budgets').set(authHeader(w.gasanAdmin.token))).body.data).toHaveLength(0);
  });

  it('counts the municipal total once, not plus every allocation', async () => {
    const w = await world();
    const res = await request(app).get('/api/budgets/summary').set(authHeader(w.admin.token));
    expect(res.body.data).toMatchObject({ totalBudget: 500000, allocatedToBarangays: 150000 });
    const mine = await request(app).get('/api/budgets/summary').set(authHeader(w.treasurer.token));
    expect(mine.body.data.totalBudget).toBe(100000);
  });

  it('files a treasurer\'s budget under their barangay and refuses a second one for the same year', async () => {
    const w = await world();
    const draft = await request(app).post('/api/budgets').set(authHeader(w.maligayaTreasurer.token))
      .send({ title: 'Maligaya 2027', fiscalYear: 2027, totalBudget: 60000, barangay: String(w.agot._id) });
    expect(draft.status).toBe(201);
    expect(draft.body.data.barangay.toString()).toBe(w.maligaya._id.toString());

    const again = await request(app).post('/api/budgets').set(authHeader(w.maligayaTreasurer.token))
      .send({ title: 'Maligaya 2027 again', fiscalYear: 2027, totalBudget: 1 });
    expect(again.status).toBe(409);
  });

  it('approves an allocation only if it fits what the municipal budget has left', async () => {
    const w = await world();
    const big = await Budget.create({ title: 'Too big', fiscalYear: 2026, municipality: w.boac._id, barangay: (await createBarangay(w.boac._id))._id, totalBudget: 400000, status: 'pending_approval', createdBy: w.admin.user._id });
    const res = await request(app).patch(`/api/budgets/${big._id}/approve`).set(authHeader(w.admin2.token));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exceeds what the municipal budget has left/);
    expect((await budgetOf(big._id)).status).toBe('pending_approval');

    const fits = await Budget.create({ title: 'Fits', fiscalYear: 2026, municipality: w.boac._id, barangay: (await createBarangay(w.boac._id))._id, totalBudget: 350000, status: 'pending_approval', createdBy: w.admin.user._id });
    expect((await request(app).patch(`/api/budgets/${fits._id}/approve`).set(authHeader(w.admin2.token))).status).toBe(200);
  });

  it('never lets two allocations approved at once overdraw the municipal budget', async () => {
    const w = await world();
    const make = async () => Budget.create({ title: 'Race', fiscalYear: 2026, municipality: w.boac._id, barangay: (await createBarangay(w.boac._id))._id, totalBudget: 300000, status: 'pending_approval', createdBy: w.admin.user._id });
    const [a, b] = [await make(), await make()];
    const results = await Promise.all([
      request(app).patch(`/api/budgets/${a._id}/approve`).set(authHeader(w.admin2.token)),
      request(app).patch(`/api/budgets/${b._id}/approve`).set(authHeader(w.admin.token)),
    ]);
    // Each fits alone (350,000 is left); together they would not.
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect(await Budget.countDocuments({ title: 'Race', status: 'approved' })).toBe(1);
  });

  it('requires an approved municipal budget before any allocation is approved', async () => {
    const w = await world();
    await Budget.updateOne({ _id: w.pool._id }, { status: 'draft' });
    const alloc = await Budget.create({ title: 'Early', fiscalYear: 2026, municipality: w.boac._id, barangay: (await createBarangay(w.boac._id))._id, totalBudget: 1000, status: 'pending_approval', createdBy: w.admin.user._id });
    const res = await request(app).patch(`/api/budgets/${alloc._id}/approve`).set(authHeader(w.admin2.token));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/municipal budget/);
  });
});

describe('expenses need proof, and are charged only to their own barangay (7.4, 6.2)', () => {
  it('refuses an expense submitted for review without proof; a draft may wait for it', async () => {
    const w = await world();
    const bare = await postExpense(w.treasurer.token, EXPENSE({ budget: String(w.agotBudget._id) }), { receipts: 0 });
    expect(bare.status).toBe(400);
    expect(bare.body.message).toMatch(/supporting document/i);

    const draft = await postExpense(w.treasurer.token, EXPENSE({ saveAsDraft: true, budget: String(w.agotBudget._id) }), { receipts: 0 });
    expect(draft.status).toBe(201);
    expect(draft.body.data.status).toBe('draft');
    const id = draft.body.data._id;
    expect((await request(app).patch(`/api/expenses/${id}/submit`).set(authHeader(w.treasurer.token))).status).toBe(400);

    const attached = await request(app).post(`/api/expenses/${id}/attachments`).set(authHeader(w.treasurer.token))
      .field('documentTypes', 'Sales Invoice').attach('attachments', PDF, { filename: 'SI-0042.pdf', contentType: 'application/pdf' });
    expect(attached.status).toBe(200);
    expect(attached.body.data.attachments[0]).toMatchObject({ documentType: 'sales_invoice', originalName: 'SI-0042.pdf' });
    expect((await request(app).patch(`/api/expenses/${id}/submit`).set(authHeader(w.treasurer.token))).status).toBe(200);
  });

  it('files the expense under the treasurer\'s barangay and refuses the municipal or a neighbour\'s budget', async () => {
    const w = await world();
    const ok = await postExpense(w.treasurer.token, EXPENSE({ budget: String(w.agotBudget._id) }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.barangay.toString()).toBe(w.agot._id.toString());
    expect(ok.body.data.attachments[0].fileUrl).toBeUndefined();

    const intoPool = await postExpense(w.treasurer.token, EXPENSE({ budget: String(w.pool._id) }));
    expect(intoPool.status).toBe(400);
    expect(intoPool.body.message).toMatch(/own budget allocation/);
    const intoNeighbour = await postExpense(w.treasurer.token, EXPENSE({ budget: String(w.maligayaBudget._id) }));
    expect(intoNeighbour.status).toBe(400);
    const tampered = await postExpense(w.treasurer.token, EXPENSE({ barangay: String(w.maligaya._id) }));
    expect(tampered.status).toBe(403);
  });

  it('refuses an amount beyond what is left in the barangay\'s allocation', async () => {
    const w = await world({ agotAllocation: 10000 });
    const res = await postExpense(w.treasurer.token, EXPENSE({ amount: 12000, budget: String(w.agotBudget._id) }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/remaining budget balance \(₱10,000\.00\)/);
  });

  it('shows the barangay\'s three officers the same expenses and keeps Maligaya out (1.4, 6.1)', async () => {
    const w = await world();
    const { body: { data: exp } } = await postExpense(w.treasurer.token, EXPENSE({ budget: String(w.agotBudget._id) }));
    for (const officer of [w.chair, w.treasurer, w.secretary]) {
      const list = await request(app).get('/api/expenses').set(authHeader(officer.token));
      expect(list.body.data.map((e) => e._id)).toEqual([exp._id]);
    }
    expect((await request(app).get('/api/expenses').set(authHeader(w.maligayaChair.token))).body.data).toHaveLength(0);
    expect((await request(app).get(`/api/expenses/${exp._id}`).set(authHeader(w.maligayaChair.token))).status).toBe(403);
    const attId = exp.attachments[0]._id;
    expect((await request(app).get(`/api/expenses/${exp._id}/attachments/${attId}`).set(authHeader(w.maligayaChair.token))).status).toBe(403);
    expect((await request(app).get(`/api/expenses/${exp._id}/attachments/${attId}?inline=1`).set(authHeader(w.chair.token))).status).toBe(200);
  });

  it('keeps the municipality\'s own spending away from barangay officers, but not their own older records', async () => {
    const w = await world();
    await Expense.create({ ...EXPENSE({ title: 'Municipal spend' }), municipality: w.boac._id, createdBy: w.admin.user._id, transactionDate: new Date() });
    await Expense.create({ ...EXPENSE({ title: 'My older expense' }), municipality: w.boac._id, createdBy: w.treasurer.user._id, transactionDate: new Date() });
    const mine = await request(app).get('/api/expenses').set(authHeader(w.treasurer.token));
    expect(mine.body.data.map((e) => e.title)).toEqual(['My older expense']);
    const chairs = await request(app).get('/api/expenses').set(authHeader(w.chair.token));
    expect(chairs.body.data).toHaveLength(0);
  });
});

describe('review: approve, return, reject (7.5)', () => {
  it('gives the reviewer everything on one record: amount, date, purpose, programme, barangay, proof', async () => {
    const w = await world();
    const program = await createProgram(w.boac._id, w.chair.user._id, { title: 'Agot Clean-Up', barangay: w.agot._id });
    const { body: { data: exp } } = await postExpense(w.treasurer.token, EXPENSE({ description: 'Gloves and sacks', budget: String(w.agotBudget._id), program: String(program._id) }), { receipts: 2 });

    const res = await request(app).get(`/api/expenses/${exp._id}`).set(authHeader(w.admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ amount: 5000, description: 'Gloves and sacks', status: 'pending' });
    expect(res.body.data.barangay.name).toBe('Agot');
    expect(res.body.data.program.title).toBe('Agot Clean-Up');
    expect(res.body.data.budget.title).toBe('Agot 2026');
    expect(res.body.data.attachments).toHaveLength(2);
    const file = await request(app).get(`/api/expenses/${exp._id}/attachments/${res.body.data.attachments[1]._id}?inline=1`).set(authHeader(w.admin.token));
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toMatch(/^inline/);
  });

  it('deducts on approval only, exactly once, and records who approved and when', async () => {
    const w = await world();
    const { body: { data: exp } } = await postExpense(w.treasurer.token, EXPENSE({ amount: 4000, budget: String(w.agotBudget._id) }));
    expect((await budgetOf(w.agotBudget._id)).disbursedAmount).toBe(0);

    expect((await approve(w.treasurer.token, exp._id)).status).toBe(403);
    const ok = await approve(w.admin.token, exp._id);
    expect(ok.status).toBe(200);
    expect((await approve(w.admin2.token, exp._id)).status).toBe(400);

    const agot = await budgetOf(w.agotBudget._id);
    expect(agot).toMatchObject({ disbursedAmount: 4000, remainingBalance: 96000 });
    expect((await budgetOf(w.pool._id)).disbursedAmount).toBe(0);
    expect((await budgetOf(w.maligayaBudget._id)).disbursedAmount).toBe(0);

    const stored = await Expense.findById(exp._id);
    expect(stored.approvedBy.toString()).toBe(w.admin.user._id.toString());
    expect(stored.approvedAt).toBeTruthy();
    const log = await AuditLog.findOne({ resource: 'expense', action: 'APPROVE', resourceId: exp._id });
    expect(log.municipality.toString()).toBe(w.boac._id.toString());
  });

  it('deducts once however many reviewers approve at the same instant', async () => {
    const w = await world();
    const { body: { data: exp } } = await postExpense(w.treasurer.token, EXPENSE({ amount: 7000, budget: String(w.agotBudget._id) }));
    const results = await Promise.all([approve(w.admin.token, exp._id), approve(w.admin2.token, exp._id), approve(w.admin.token, exp._id)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect((await budgetOf(w.agotBudget._id)).disbursedAmount).toBe(7000);
  });

  it('refuses an approval that would overdraw the allocation, and leaves the expense pending', async () => {
    const w = await world({ agotAllocation: 10000 });
    const one = await postExpense(w.treasurer.token, EXPENSE({ amount: 6000, budget: String(w.agotBudget._id) }));
    const two = await postExpense(w.treasurer.token, EXPENSE({ amount: 6000, budget: String(w.agotBudget._id) }));
    expect((await approve(w.admin.token, one.body.data._id)).status).toBe(200);

    const over = await approve(w.admin.token, two.body.data._id);
    expect(over.status).toBe(400);
    expect(over.body.message).toMatch(/overdraw/);
    expect((await Expense.findById(two.body.data._id)).status).toBe('pending');
    expect((await budgetOf(w.agotBudget._id)).disbursedAmount).toBe(6000);
  });

  it('refuses to approve an expense that carries no proof', async () => {
    const w = await world();
    const legacy = await Expense.create({ ...EXPENSE(), transactionDate: new Date(), municipality: w.boac._id, barangay: w.agot._id, budget: w.agotBudget._id, createdBy: w.treasurer.user._id, status: 'pending' });
    const res = await approve(w.admin.token, legacy._id);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no supporting document/i);
  });

  it('returns for correction with remarks, takes the resubmission, and deducts only on the final approval', async () => {
    const w = await world();
    const { body: { data: exp } } = await postExpense(w.treasurer.token, EXPENSE({ amount: 3000, budget: String(w.agotBudget._id) }));
    expect((await request(app).patch(`/api/expenses/${exp._id}/return`).set(authHeader(w.admin.token)).send({})).status).toBe(422);
    const returned = await request(app).patch(`/api/expenses/${exp._id}/return`).set(authHeader(w.admin.token)).send({ returnReason: 'Attach the official receipt, not the quotation' });
    expect(returned.body.data).toMatchObject({ status: 'returned', returnReason: 'Attach the official receipt, not the quotation' });

    await request(app).post(`/api/expenses/${exp._id}/attachments`).set(authHeader(w.treasurer.token))
      .attach('attachments', PDF, { filename: 'OR-1.pdf', contentType: 'application/pdf' });
    expect((await request(app).patch(`/api/expenses/${exp._id}/submit`).set(authHeader(w.treasurer.token))).status).toBe(200);
    expect((await budgetOf(w.agotBudget._id)).disbursedAmount).toBe(0);
    expect((await approve(w.admin.token, exp._id)).status).toBe(200);
    expect((await budgetOf(w.agotBudget._id)).disbursedAmount).toBe(3000);
  });

  it('rejects with a reason as a final decision that moves no money', async () => {
    const w = await world();
    const { body: { data: exp } } = await postExpense(w.treasurer.token, EXPENSE({ budget: String(w.agotBudget._id) }));
    const res = await request(app).patch(`/api/expenses/${exp._id}/reject`).set(authHeader(w.admin.token)).send({ rejectionReason: 'Not an SK expense' });
    expect(res.body.data).toMatchObject({ status: 'rejected', rejectionReason: 'Not an SK expense' });
    expect((await approve(w.admin2.token, exp._id)).status).toBe(400);
    expect((await budgetOf(w.agotBudget._id)).disbursedAmount).toBe(0);
  });

  it('reverses an approval with a full refund, so re-approving deducts once, not twice', async () => {
    const w = await world();
    const { body: { data: exp } } = await postExpense(w.treasurer.token, EXPENSE({ amount: 2500, budget: String(w.agotBudget._id) }));
    await approve(w.admin.token, exp._id);
    expect((await budgetOf(w.agotBudget._id)).disbursedAmount).toBe(2500);

    const reversed = await request(app).patch(`/api/expenses/${exp._id}/reverse`).set(authHeader(w.admin.token)).send({ reason: 'Approved against the wrong receipt' });
    expect(reversed.status).toBe(200);
    expect(reversed.body.data.status).toBe('returned');
    expect((await budgetOf(w.agotBudget._id)).disbursedAmount).toBe(0);

    await request(app).patch(`/api/expenses/${exp._id}/submit`).set(authHeader(w.treasurer.token));
    await approve(w.admin2.token, exp._id);
    const agot = await budgetOf(w.agotBudget._id);
    expect(agot).toMatchObject({ disbursedAmount: 2500, remainingBalance: 97500 });
  });

  it('bulk-approves through the same rules: proof, authorship, scope — and deducts exactly', async () => {
    const w = await world();
    const a = await postExpense(w.treasurer.token, EXPENSE({ amount: 1000, budget: String(w.agotBudget._id) }));
    const b = await postExpense(w.treasurer.token, EXPENSE({ amount: 2000, budget: String(w.agotBudget._id) }));
    const noProof = await Expense.create({ ...EXPENSE(), transactionDate: new Date(), municipality: w.boac._id, barangay: w.agot._id, budget: w.agotBudget._id, createdBy: w.treasurer.user._id, status: 'pending' });
    const own = await postExpense(w.admin.token, EXPENSE({ amount: 500, budget: String(w.pool._id) }));

    const res = await request(app).patch('/api/expenses/bulk-approve').set(authHeader(w.admin.token))
      .send({ ids: [a.body.data._id, b.body.data._id, String(noProof._id), own.body.data._id] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ approved: 2, skipped: 2 });
    expect((await budgetOf(w.agotBudget._id)).disbursedAmount).toBe(3000);
    expect((await budgetOf(w.pool._id)).disbursedAmount).toBe(0);
  });
});

describe('finance recycle bins (6.3)', () => {
  it('bins and restores a draft budget; refuses an approved one; destroys only unreferenced ones', async () => {
    const w = await world();
    const draft = await request(app).post('/api/budgets').set(authHeader(w.treasurer.token)).send({ title: 'Agot 2027', fiscalYear: 2027, totalBudget: 80000 });
    const id = draft.body.data._id;

    expect((await request(app).delete(`/api/budgets/${w.agotBudget._id}`).set(authHeader(w.admin.token))).status).toBe(400);
    expect((await request(app).delete(`/api/budgets/${id}`).set(authHeader(w.maligayaTreasurer.token))).status).toBe(403);
    expect((await request(app).delete(`/api/budgets/${id}`).set(authHeader(w.treasurer.token))).status).toBe(200);

    const bin = await request(app).get('/api/budgets/recycle-bin').set(authHeader(w.chair.token));
    expect(bin.status).toBe(403); // the chairperson is view-only in finance
    const treasurerBin = await request(app).get('/api/budgets/recycle-bin').set(authHeader(w.treasurer.token));
    expect(treasurerBin.body.data.map((b) => b.title)).toEqual(['Agot 2027']);
    expect((await request(app).get('/api/budgets/recycle-bin').set(authHeader(w.maligayaTreasurer.token))).body.data).toHaveLength(0);

    // A replacement takes the slot; restoring the original is then refused.
    const replacement = await request(app).post('/api/budgets').set(authHeader(w.treasurer.token)).send({ title: 'Agot 2027 (v2)', fiscalYear: 2027, totalBudget: 90000 });
    expect(replacement.status).toBe(201);
    expect((await request(app).patch(`/api/budgets/${id}/restore`).set(authHeader(w.treasurer.token))).status).toBe(409);
    await request(app).delete(`/api/budgets/${replacement.body.data._id}`).set(authHeader(w.treasurer.token));
    const restored = await request(app).patch(`/api/budgets/${id}/restore`).set(authHeader(w.treasurer.token));
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ title: 'Agot 2027', totalBudget: 80000 });

    // Permanent deletion: administrators only, from the bin only.
    await request(app).delete(`/api/budgets/${id}`).set(authHeader(w.treasurer.token));
    expect((await request(app).delete(`/api/budgets/${id}/permanent`).set(authHeader(w.treasurer.token))).status).toBe(403);
    expect((await request(app).delete(`/api/budgets/${id}/permanent`).set(authHeader(w.admin.token))).status).toBe(200);
    expect(await Budget.findById(id)).toBeNull();
    expect(await AuditLog.countDocuments({ resource: 'budget', action: 'PERMANENT_DELETE', resourceId: id })).toBe(1);
  });

  it('will not destroy a binned budget that an expense still names', async () => {
    const w = await world();
    const draft = await Budget.create({ title: 'Referenced', fiscalYear: 2028, municipality: w.boac._id, barangay: w.agot._id, totalBudget: 1000, createdBy: w.admin.user._id, status: 'draft', deletedAt: new Date() });
    await Expense.create({ ...EXPENSE(), transactionDate: new Date(), municipality: w.boac._id, barangay: w.agot._id, budget: draft._id, createdBy: w.treasurer.user._id, status: 'draft' });
    const res = await request(app).delete(`/api/budgets/${draft._id}/permanent`).set(authHeader(w.admin.token));
    expect(res.status).toBe(409);
  });

  it('bins and restores expenses and liquidation reports with their attachments intact', async () => {
    const w = await world();
    const { body: { data: exp } } = await postExpense(w.treasurer.token, EXPENSE({ budget: String(w.agotBudget._id) }));
    expect((await request(app).delete(`/api/expenses/${exp._id}`).set(authHeader(w.treasurer.token))).status).toBe(200);
    const bin = await request(app).get('/api/expenses/recycle-bin').set(authHeader(w.treasurer.token));
    expect(bin.body.data.map((e) => e._id)).toEqual([exp._id]);
    expect((await request(app).get('/api/expenses/recycle-bin').set(authHeader(w.maligayaTreasurer.token))).body.data).toHaveLength(0);
    const restored = await request(app).patch(`/api/expenses/${exp._id}/restore`).set(authHeader(w.treasurer.token));
    expect(restored.body.data).toMatchObject({ status: 'pending' });
    expect(restored.body.data.attachments).toHaveLength(1);
  });
});

describe('liquidation reports with supporting attachments (6.4, 7.5)', () => {
  const program = (w) => createProgram(w.boac._id, w.chair.user._id, { title: 'Agot Clean-Up', barangay: w.agot._id });
  const fileReport = (token, body, receipts = 1) =>
    multipart(request(app).post('/api/liquidations').set(authHeader(token)), body, { receipts, field: 'documents' });

  it('refuses a report with no evidence, and files one with evidence under the barangay', async () => {
    const w = await world();
    const p = await program(w);
    const bare = await fileReport(w.treasurer.token, { title: 'Q1', program: String(p._id), totalAmount: 5000 }, 0);
    expect(bare.status).toBe(400);
    const ok = await fileReport(w.treasurer.token, { title: 'Q1', program: String(p._id), totalAmount: 5000, barangay: String(w.maligaya._id) });
    expect(ok.status).toBe(201);
    expect(ok.body.data.barangay.toString()).toBe(w.agot._id.toString());
    expect(ok.body.data.documents[0]).toMatchObject({ documentType: 'official_receipt' });
  });

  it('names only approved expenses of its own barangay, each in one live report at a time', async () => {
    const w = await world();
    const p = await program(w);
    const pending = await postExpense(w.treasurer.token, EXPENSE({ budget: String(w.agotBudget._id) }));
    const approved = await postExpense(w.treasurer.token, EXPENSE({ budget: String(w.agotBudget._id) }));
    await approve(w.admin.token, approved.body.data._id);
    const maligayaExp = await Expense.create({ ...EXPENSE(), transactionDate: new Date(), municipality: w.boac._id, barangay: w.maligaya._id, createdBy: w.maligayaTreasurer.user._id, status: 'approved' });

    expect((await fileReport(w.treasurer.token, { title: 'L', program: String(p._id), totalAmount: 5000, expenses: [pending.body.data._id] })).status).toBe(400);
    expect((await fileReport(w.treasurer.token, { title: 'L', program: String(p._id), totalAmount: 5000, expenses: [String(maligayaExp._id)] })).status).toBe(403);
    expect((await fileReport(w.treasurer.token, { title: 'L', program: String(p._id), totalAmount: 5000, expenses: [approved.body.data._id] })).status).toBe(201);
    expect((await fileReport(w.treasurer.token, { title: 'L2', program: String(p._id), totalAmount: 5000, expenses: [approved.body.data._id] })).status).toBe(409);
  });

  it('returns for more documents, resubmits, and on approval liquidates the expenses without deducting again', async () => {
    const w = await world();
    const p = await program(w);
    const exp = await postExpense(w.treasurer.token, EXPENSE({ amount: 5000, budget: String(w.agotBudget._id) }));
    await approve(w.admin.token, exp.body.data._id);
    const { body: { data: liq } } = await fileReport(w.treasurer.token, { title: 'Q1', program: String(p._id), totalAmount: 5000, liquidatedAmount: 5000, expenses: [exp.body.data._id] });
    await request(app).patch(`/api/liquidations/${liq._id}/submit`).set(authHeader(w.treasurer.token));

    // The reviewer inspects the report and its proof before deciding.
    const view = await request(app).get(`/api/liquidations/${liq._id}`).set(authHeader(w.admin.token));
    expect(view.body.data.barangay.name).toBe('Agot');
    expect(view.body.data.expenses[0].attachments).toHaveLength(1);
    const proof = await request(app).get(`/api/liquidations/${liq._id}/attachments/${view.body.data.documents[0]._id}?inline=1`).set(authHeader(w.admin.token));
    expect(proof.status).toBe(200);
    expect((await request(app).get(`/api/liquidations/${liq._id}`).set(authHeader(w.maligayaChair.token))).status).toBe(403);

    const returned = await request(app).patch(`/api/liquidations/${liq._id}/return`).set(authHeader(w.admin.token)).send({ reason: 'Add the acknowledgment receipt' });
    expect(returned.body.data).toMatchObject({ status: 'returned', returnReason: 'Add the acknowledgment receipt' });
    await request(app).post(`/api/liquidations/${liq._id}/attachments`).set(authHeader(w.treasurer.token))
      .field('documentTypes', 'acknowledgment_receipt').attach('documents', PDF, { filename: 'AR.pdf', contentType: 'application/pdf' });
    expect((await request(app).patch(`/api/liquidations/${liq._id}/submit`).set(authHeader(w.treasurer.token))).status).toBe(200);

    expect((await request(app).patch(`/api/liquidations/${liq._id}/approve`).set(authHeader(w.admin.token))).status).toBe(200);
    expect((await request(app).patch(`/api/liquidations/${liq._id}/approve`).set(authHeader(w.admin2.token))).status).toBe(409);
    expect((await Expense.findById(exp.body.data._id)).status).toBe('liquidated');
    expect((await budgetOf(w.agotBudget._id)).disbursedAmount).toBe(5000);
    expect((await Liquidation.findById(liq._id)).documents).toHaveLength(2);
  });

  it('rejects as final, with the reviewer recorded', async () => {
    const w = await world();
    const p = await program(w);
    const { body: { data: liq } } = await fileReport(w.treasurer.token, { title: 'Q1', program: String(p._id), totalAmount: 5000 });
    await request(app).patch(`/api/liquidations/${liq._id}/submit`).set(authHeader(w.treasurer.token));
    const res = await request(app).patch(`/api/liquidations/${liq._id}/reject`).set(authHeader(w.admin.token)).send({ reason: 'Receipts are for another activity' });
    expect(res.body.data).toMatchObject({ status: 'rejected', rejectionReason: 'Receipts are for another activity' });
    expect(res.body.data.rejectedBy.toString()).toBe(w.admin.user._id.toString());
    expect((await request(app).patch(`/api/liquidations/${liq._id}/submit`).set(authHeader(w.treasurer.token))).status).toBe(400);
  });
});

describe('municipal monitoring of barangay finances (7.3)', () => {
  it('reports each barangay from recorded transactions in their current state', async () => {
    const w = await world();
    const a = await postExpense(w.treasurer.token, EXPENSE({ amount: 3000, transactionDate: '2026-02-01', budget: String(w.agotBudget._id) }));
    await approve(w.admin.token, a.body.data._id);
    await postExpense(w.treasurer.token, EXPENSE({ amount: 1500, transactionDate: '2026-02-02', budget: String(w.agotBudget._id) }));
    const r = await postExpense(w.treasurer.token, EXPENSE({ amount: 900, transactionDate: '2026-02-03', budget: String(w.agotBudget._id) }));
    await request(app).patch(`/api/expenses/${r.body.data._id}/reject`).set(authHeader(w.admin.token)).send({ rejectionReason: 'No' });

    const res = await request(app).get('/api/budgets/barangay-performance?fiscalYear=2026').set(authHeader(w.admin.token));
    expect(res.status).toBe(200);
    const agot = res.body.data.barangays.find((b) => b.barangay.name === 'Agot');
    expect(agot).toMatchObject({
      allocated: 100000,
      approvedAllocation: 100000,
      utilized: 3000,
      remaining: 97000,
      unchargedApproved: 0,
      rejectedExpenses: 1,
    });
    expect(agot.approvedExpenses).toEqual({ count: 1, amount: 3000 });
    // Pending is reported, never counted as spent; rejected is excluded entirely.
    expect(agot.pendingExpenses).toEqual({ count: 1, amount: 1500 });
    const maligaya = res.body.data.barangays.find((b) => b.barangay.name === 'Maligaya');
    expect(maligaya).toMatchObject({ allocated: 50000, utilized: 0, remaining: 50000 });
    expect(res.body.data.municipalBudget).toMatchObject({ totalBudget: 500000, allocatedToBarangays: 150000, unallocated: 350000 });
    expect(res.body.data.totals).toMatchObject({ utilized: 3000, remaining: 497000 });
  });

  it('is for municipal reviewers and DILG — never a barangay officer, never another municipality', async () => {
    const w = await world();
    expect((await request(app).get('/api/budgets/barangay-performance').set(authHeader(w.treasurer.token))).status).toBe(403);
    expect((await request(app).get('/api/budgets/barangay-performance').set(authHeader(w.chair.token))).status).toBe(403);
    const gasan = await request(app).get(`/api/budgets/barangay-performance?municipality=${w.boac._id}`).set(authHeader(w.gasanAdmin.token));
    expect(gasan.body.data.barangays).toHaveLength(0); // its own municipality, whatever it asks for
    const dilg = await request(app).get(`/api/budgets/barangay-performance?municipality=${w.boac._id}`).set(authHeader(w.dilg.token));
    expect(dilg.body.data.barangays).toHaveLength(2);
  });
});

describe('reports download as PDF or Excel (5.1)', () => {
  it.each(['programs', 'financial', 'youth'])('produces the %s report as a real PDF and a real workbook', async (kind) => {
    const w = await world();
    await createProgram(w.boac._id, w.chair.user._id, { title: 'Agot Clean-Up', barangay: w.agot._id, implementationDate: new Date('2026-05-05') });
    const pdf = await request(app).get(`/api/reports/${kind}?format=pdf&fiscalYear=2026`).set(authHeader(w.admin.token))
      .buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.slice(0, 5).toString()).toBe('%PDF-');
    // The peso sign cannot be encoded by the built-in PDF fonts, so amounts read "PHP" — never " ±".
    expect(pdf.body.includes(Buffer.from([0x20, 0xb1]))).toBe(false);

    const xlsx = await request(app).get(`/api/reports/${kind}?format=excel&fiscalYear=2026`).set(authHeader(w.admin.token))
      .buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toMatch(/spreadsheetml/);
    expect(xlsx.body.slice(0, 2).toString()).toBe('PK'); // a zip container, i.e. a real .xlsx
  });
});
