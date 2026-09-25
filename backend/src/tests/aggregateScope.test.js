/**
 * Barangay scope in the aggregate views: dashboard, monitoring, analytics, reports.
 *
 * The list pages were scoped first, which left the figures above them wider than the rows beneath —
 * a chairperson read their own barangay's programmes in the table and the municipality's totals in
 * the KPI row. These assertions pin the two together.
 *
 * Two shapes are pinned deliberately, not incidentally:
 *
 *   - collections that carry a barangay (programmes, expenses, documents, youth) narrow to it;
 *   - budgets and liquidations do NOT, because they are drawn per municipality and fiscal year.
 *     A barangay officer's expense lines are theirs while the budget behind them is the
 *     municipality's, which is the actual shape of SK funding.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBarangay, createBudget, createProgram, authHeader } = require('./helpers');
const Expense = require('../models/Expense');
const Document = require('../models/Document');
const YouthMember = require('../models/YouthMember');
const Liquidation = require('../models/Liquidation');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

/**
 * A municipality with two barangays and a chairperson bound to the first, plus one record of every
 * kind in each barangay and one belonging to no barangay at all.
 */
const town = async () => {
  const { user: admin, municipalityId } = await createUser({ role: 'municipal_admin' });
  const mine = await createBarangay(municipalityId);
  const theirs = await createBarangay(municipalityId);
  const { token } = await createUser({ role: 'sk_chairperson', municipality: municipalityId, barangay: mine._id });

  const programs = {
    mine: await createProgram(municipalityId, admin._id, { title: 'Mine', barangay: mine._id, status: 'delayed', budget: 1000, actualExpenses: 5000 }),
    theirs: await createProgram(municipalityId, admin._id, { title: 'Theirs', barangay: theirs._id, status: 'delayed', budget: 1000, actualExpenses: 5000 }),
    shared: await createProgram(municipalityId, admin._id, { title: 'Municipality-wide', status: 'ongoing' }),
  };

  const expense = (barangay, amount) => Expense.create({
    type: 'purchase_request',
    title: `Spend ${amount}`,
    amount,
    transactionDate: new Date(),
    status: 'approved',
    municipality: municipalityId,
    barangay,
    createdBy: admin._id,
  });
  await expense(mine._id, 1000);
  await expense(theirs._id, 7000);

  const document = (barangay) => Document.create({
    title: `Doc ${Math.random().toString(36).slice(2, 6)}`,
    category: 'minutes',
    fileName: `skims/documents/${Math.random().toString(36).slice(2)}`,
    originalName: 'doc.pdf',
    fileUrl: 'https://res.cloudinary.com/test/raw/upload/doc',
    fileType: 'application/pdf',
    municipality: municipalityId,
    barangay,
    uploadedBy: admin._id,
  });
  await document(mine._id);
  await document(theirs._id);

  const youth = (barangay, firstName) => YouthMember.create({
    firstName,
    lastName: 'Member',
    birthDate: new Date('2006-01-01'),
    gender: 'female',
    municipality: municipalityId,
    barangay,
  });
  await youth(mine._id, 'Mine');
  await youth(theirs._id, 'Theirs');

  // Municipality-level money: one budget, one liquidation. Neither model has a barangay.
  const budget = await createBudget(municipalityId, admin._id, { totalBudget: 500000, disbursedAmount: 8000, remainingBalance: 492000 });
  await Liquidation.create({
    title: 'Q1 liquidation',
    program: programs.shared._id,
    municipality: municipalityId,
    totalAmount: 8000,
    status: 'submitted',
    submittedBy: admin._id,
    dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return { admin, municipalityId, mine, theirs, token, programs, budget };
};

describe('Dashboard KPIs', () => {
  it('counts only the officer own barangay plus municipality-level records', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/dashboard').set(authHeader(token));
    expect(res.status).toBe(200);

    const { kpis } = res.body.data;
    // Mine + the municipality-wide programme: two of the three.
    expect(kpis.totalPrograms).toBe(2);
    expect(kpis.totalDocuments).toBe(1);
    expect(kpis.totalYouth).toBe(1);
    // Own barangay's spending only — the other barangay's ₱7,000 is not this officer's figure.
    expect(kpis.totalExpenses).toBe(1000);
  });

  it('keeps budget totals municipality-level, because budgets have no barangay', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/dashboard').set(authHeader(token));

    // The whole municipality's budget, deliberately: the money is drawn per municipality and fiscal
    // year. Narrowing on a field the collection does not have would have returned zero.
    expect(res.body.data.kpis.totalBudget).toBe(500000);
    expect(res.body.data.kpis.pendingLiquidations).toBe(1);
  });

  it('scopes the user count, which used to report the whole province', async () => {
    const { municipalityId, mine } = await town();
    // A second municipality with two more accounts; neither belongs on the first one's dashboard.
    await createUser({ role: 'municipal_admin' });
    await createUser({ role: 'sk_treasurer' });
    const { token } = await createUser({ role: 'sk_chairperson', municipality: municipalityId, barangay: mine._id });

    const res = await request(app).get('/api/dashboard').set(authHeader(token));
    // Staff serve a municipality, so this is municipality-scoped rather than barangay-scoped: the
    // admin, the first chairperson and this one.
    expect(res.body.data.kpis.totalUsers).toBe(3);
  });

  it('shows a municipal_admin the whole municipality', async () => {
    const { municipalityId } = await town();
    const { token } = await createUser({ role: 'municipal_admin', municipality: municipalityId });

    const res = await request(app).get('/api/dashboard').set(authHeader(token));
    expect(res.body.data.kpis.totalPrograms).toBe(3);
    expect(res.body.data.kpis.totalExpenses).toBe(8000);
  });

  it('fails closed for a scoped account with no municipality', async () => {
    await town();
    const { token } = await createUser({ role: 'sk_chairperson', municipality: null });

    const res = await request(app).get('/api/dashboard').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.kpis.totalPrograms).toBe(0);
    expect(res.body.data.kpis.totalExpenses).toBe(0);
    expect(res.body.data.kpis.totalBudget).toBe(0);
  });

  it('ignores a ?municipalityId pointing elsewhere', async () => {
    const { token } = await town();
    const { municipalityId: otherMunId, user: otherAdmin } = await createUser({ role: 'municipal_admin' });
    await createProgram(otherMunId, otherAdmin._id, { title: 'Elsewhere' });

    const res = await request(app).get(`/api/dashboard?municipalityId=${otherMunId}`).set(authHeader(token));
    expect(res.body.data.kpis.totalPrograms).toBe(2);
    expect(res.body.data.recentPrograms.map((p) => p.title).sort()).toEqual(['Mine', 'Municipality-wide']);
  });
});

describe('Monitoring', () => {
  it('scopes the delayed and over-budget panels to the barangay', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/monitoring/overview').set(authHeader(token));
    expect(res.status).toBe(200);

    expect(res.body.data.delayedPrograms.map((p) => p.title)).toEqual(['Mine']);
    expect(res.body.data.overBudgetPrograms.map((p) => p.title)).toEqual(['Mine']);
  });

  it('still surfaces the municipality-level liquidation due soon', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/monitoring/overview').set(authHeader(token));
    // Liquidations are municipality-level; a barangay filter would have hidden every one of them.
    expect(res.body.data.pendingLiquidations).toHaveLength(1);
  });

  it('scopes the compliance programme counts but not the liquidation count', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/monitoring/compliance').set(authHeader(token));
    expect(res.status).toBe(200);
    // One delayed programme in this barangay, not the two in the municipality.
    expect(res.body.data.overduePrograms).toBe(1);
  });

  it('scopes the timeline', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/monitoring/timeline').set(authHeader(token));
    expect(res.body.data.map((p) => p.title).sort()).toEqual(['Mine', 'Municipality-wide']);
  });

  it('leaves the municipality comparison a municipality comparison', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/monitoring/municipalities').set(authHeader(token));
    expect(res.status).toBe(200);
    /*
     * One row — their own municipality — carrying the MUNICIPALITY's programme counts, because the row
     * is labelled with the municipality's name. A barangay figure under that heading would be a wrong
     * number rather than a narrower one.
     *
     * Note this is /api/monitoring/municipalities, which is scoped to the caller's own municipality.
     * /api/dashboard/municipality-comparison is a different endpoint and province-wide by design —
     * it carries programme counts and completion rates only, never money.
     */
    expect(res.body.data).toHaveLength(1);
    const counted = res.body.data[0].programStats.reduce((sum, stat) => sum + stat.count, 0);
    expect(counted).toBe(3);
  });
});

describe('Analytics', () => {
  it('scopes fund utilisation to the barangay', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/analytics/fund-utilization').set(authHeader(token));
    expect(res.status).toBe(200);

    const total = res.body.data.reduce((sum, m) => sum + m.total, 0);
    expect(total).toBe(1000);
  });

  it('scopes programme success rates to the barangay', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/analytics/program-success').set(authHeader(token));
    const counted = res.body.data.reduce((sum, c) => sum + c.total, 0);
    expect(counted).toBe(2);
  });

  it('breaks youth engagement down by barangay as well as municipality', async () => {
    const { token, mine } = await town();
    const res = await request(app).get('/api/analytics/youth-engagement').set(authHeader(token));
    expect(res.status).toBe(200);

    const counted = res.body.data.byGender.reduce((sum, g) => sum + g.count, 0);
    expect(counted).toBe(1);

    /*
     * The barangay split is the comparison a scoped account can act on — its municipality chart is a
     * single bar labelled with its own name, which says nothing.
     */
    expect(res.body.data.byBarangay).toHaveLength(1);
    expect(res.body.data.byBarangay[0]._id).toBe(mine._id.toString());
  });

  it('shows a province-wide reader every barangay, and names members with none', async () => {
    const { municipalityId } = await town();
    await YouthMember.create({
      firstName: 'Unassigned', lastName: 'Member', birthDate: new Date('2006-01-01'), gender: 'male', municipality: municipalityId,
    });
    const { token } = await createUser({ role: 'provincial_admin', municipality: null });

    const res = await request(app).get('/api/analytics/youth-engagement').set(authHeader(token));
    expect(res.body.data.byBarangay).toHaveLength(3);
    expect(res.body.data.byBarangay.map((b) => b.name)).toContain('No barangay recorded');
  });
});

describe('Reports', () => {
  it('scopes the programme report', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/reports/programs').set(authHeader(token));
    expect(res.status).toBe(200);
    // The programme report returns the rows as `data` directly, unlike the financial one.
    expect(res.body.data.map((p) => p.title).sort()).toEqual(['Mine', 'Municipality-wide']);
  });

  it('scopes the youth report', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/reports/youth').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
  });

  it('scopes financial expenses to the barangay while the budget stays the municipality own', async () => {
    const { token } = await town();
    const res = await request(app).get('/api/reports/financial').set(authHeader(token));
    expect(res.status).toBe(200);

    expect(res.body.data.summary.totalExpenses).toBe(1000);
    // Not a mismatch: SK money is budgeted per municipality and spent per barangay, and the report
    // has to be able to state both without pretending the budget was the barangay's.
    expect(res.body.data.summary.totalBudget).toBe(500000);
  });

  it('gives a municipal_admin the municipality figures in the same report', async () => {
    const { municipalityId } = await town();
    const { token } = await createUser({ role: 'municipal_admin', municipality: municipalityId });

    const res = await request(app).get('/api/reports/financial').set(authHeader(token));
    expect(res.body.data.summary.totalExpenses).toBe(8000);
    expect(res.body.data.summary.totalBudget).toBe(500000);
  });
});
