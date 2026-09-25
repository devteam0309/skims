/**
 * Barangay-level isolation.
 *
 * Municipality isolation already has its own suite. This one covers the dimension added in this
 * round: an SK officer whose account names a barangay operates inside it, and cannot reach another
 * barangay's records by any route — list, direct id, query parameter, or request body.
 *
 * The semantics being pinned (see utils/scope.js) are deliberately not "barangay or nothing":
 * a record with NO barangay is municipality-level and stays visible, because every record that
 * existed before this change has none. Both halves of that are asserted, because a future change
 * that tightened it would blank the pages of every officer in the system.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBarangay, createProgram, authHeader } = require('./helpers');
const YouthMember = require('../models/YouthMember');
const Expense = require('../models/Expense');
const Document = require('../models/Document');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

/** A municipality with two barangays, and a chairperson bound to the first. */
const twoBarangayTown = async (role = 'sk_chairperson') => {
  const { user: admin, municipalityId } = await createUser({ role: 'municipal_admin' });
  const mine = await createBarangay(municipalityId);
  const theirs = await createBarangay(municipalityId);
  const { user, token } = await createUser({ role, municipality: municipalityId, barangay: mine._id });
  return { admin, municipalityId, mine, theirs, user, token };
};

const makeYouth = (municipality, barangay, overrides = {}) => YouthMember.create({
  firstName: 'Ana',
  lastName: `Cruz${Math.random().toString(36).slice(2, 6)}`,
  birthDate: new Date('2005-05-05'),
  gender: 'female',
  municipality,
  barangay,
  ...overrides,
});

const makeExpense = (municipality, createdBy, barangay, overrides = {}) => Expense.create({
  type: 'purchase_request',
  title: 'Supplies',
  amount: 1000,
  transactionDate: new Date('2026-03-01'),
  municipality,
  barangay,
  createdBy,
  ...overrides,
});

const makeDocument = (municipality, uploadedBy, barangay) => Document.create({
  title: 'Minutes',
  category: 'minutes',
  fileName: `skims/documents/${Math.random().toString(36).slice(2)}`,
  originalName: 'minutes.pdf',
  fileUrl: 'https://res.cloudinary.com/test/raw/upload/minutes',
  fileType: 'application/pdf',
  municipality,
  barangay,
  uploadedBy,
});

describe('Youth Registry — barangay scope', () => {
  it('lists own barangay and municipality-level members, never another barangay', async () => {
    const { admin, municipalityId, mine, theirs, token } = await twoBarangayTown();
    await makeYouth(municipalityId, mine._id, { firstName: 'Mine' });
    await makeYouth(municipalityId, theirs._id, { firstName: 'Theirs' });
    await makeYouth(municipalityId, undefined, { firstName: 'Unassigned' });

    const res = await request(app).get('/api/youth').set(authHeader(token));
    expect(res.status).toBe(200);
    const names = res.body.data.map((m) => m.firstName).sort();
    // The unassigned member is municipality-level, so it stays in view; the other barangay's does not.
    expect(names).toEqual(['Mine', 'Unassigned']);
    expect(admin).toBeDefined();
  });

  it('ignores ?barangay= pointing at another barangay rather than obeying it', async () => {
    const { municipalityId, mine, theirs, token } = await twoBarangayTown();
    await makeYouth(municipalityId, mine._id, { firstName: 'Mine' });
    await makeYouth(municipalityId, theirs._id, { firstName: 'Theirs' });

    const res = await request(app).get(`/api/youth?barangay=${theirs._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].firstName).toBe('Mine');
  });

  it('refuses a member of another barangay requested directly by id', async () => {
    const { municipalityId, theirs, token } = await twoBarangayTown();
    const member = await makeYouth(municipalityId, theirs._id);

    const res = await request(app).get(`/api/youth/${member._id}`).set(authHeader(token));
    expect(res.status).toBe(403);
  });

  /*
   * The barangay in the body is OVERWRITTEN, not refused — the same contract this module already
   * applies to `municipality` (see auditFixes and panelRound2026-09, which pin that). Either way the
   * record cannot land outside the caller's scope, which is the property being protected.
   */
  it('files a new member into the officer own barangay whatever the body says', async () => {
    const { mine, theirs, token } = await twoBarangayTown();

    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send({
        firstName: 'Jose',
        lastName: 'Santos',
        birthDate: '2006-02-02',
        gender: 'male',
        barangay: theirs._id.toString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.barangay.toString()).toBe(mine._id.toString());

    // And with no barangay named at all, it still lands in their own.
    const ok = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send({ firstName: 'Ana', lastName: 'Lim', birthDate: '2006-02-02', gender: 'female' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.barangay.toString()).toBe(mine._id.toString());
  });

  it('refuses to update or delete a member in another barangay', async () => {
    const { municipalityId, theirs, token } = await twoBarangayTown();
    const member = await makeYouth(municipalityId, theirs._id);

    const update = await request(app)
      .put(`/api/youth/${member._id}`)
      .set(authHeader(token))
      .send({ occupation: 'student' });
    expect(update.status).toBe(403);

    const del = await request(app).delete(`/api/youth/${member._id}`).set(authHeader(token));
    expect(del.status).toBe(403);
  });

  it('leaves a municipal_admin unrestricted by barangay within its municipality', async () => {
    const { admin, municipalityId, mine, theirs } = await twoBarangayTown();
    const { token: adminToken } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    await makeYouth(municipalityId, mine._id);
    await makeYouth(municipalityId, theirs._id);

    const res = await request(app).get('/api/youth').set(authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(admin).toBeDefined();
  });
});

describe('Programs — barangay scope', () => {
  it('lists own barangay plus municipality-wide programmes', async () => {
    const { admin, municipalityId, mine, theirs, token } = await twoBarangayTown();
    await createProgram(municipalityId, admin._id, { title: 'Mine', barangay: mine._id });
    await createProgram(municipalityId, admin._id, { title: 'Theirs', barangay: theirs._id });
    await createProgram(municipalityId, admin._id, { title: 'Municipality-wide' });

    const res = await request(app).get('/api/programs').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.map((p) => p.title).sort()).toEqual(['Mine', 'Municipality-wide']);
  });

  it('refuses a programme in another barangay by id, and refuses to edit it', async () => {
    const { admin, municipalityId, theirs, token } = await twoBarangayTown();
    const program = await createProgram(municipalityId, admin._id, { barangay: theirs._id });

    const read = await request(app).get(`/api/programs/${program._id}`).set(authHeader(token));
    expect(read.status).toBe(403);

    const write = await request(app)
      .put(`/api/programs/${program._id}`)
      .set(authHeader(token))
      .send({ title: 'Renamed' });
    expect(write.status).toBe(403);
  });

  it('targets a new programme at the officer own barangay', async () => {
    const { mine, token } = await twoBarangayTown();
    const res = await request(app)
      .post('/api/programs')
      .set(authHeader(token))
      .send({
        title: 'Barangay Clean-up',
        description: 'A clean-up drive for the barangay',
        category: 'environment',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        targetParticipants: 30,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.barangay.toString()).toBe(mine._id.toString());
  });

  it('rejects a barangay from another municipality on create', async () => {
    const { token: adminToken } = await createUser({ role: 'municipal_admin' });
    const { municipalityId: otherMunId } = await createUser({ role: 'municipal_admin' });
    const foreign = await createBarangay(otherMunId);

    const res = await request(app)
      .post('/api/programs')
      .set(authHeader(adminToken))
      .send({
        title: 'Cross-boundary programme',
        description: 'Targets a barangay in another municipality',
        category: 'governance',
        startDate: '2026-04-01',
        endDate: '2026-04-30',
        targetParticipants: 30,
        barangay: foreign._id.toString(),
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong to this municipality/i);
  });
});

describe('Expenses and Documents — barangay scope', () => {
  it('hides another barangay expenses from the list and by id', async () => {
    const { admin, municipalityId, mine, theirs, token } = await twoBarangayTown('sk_treasurer');
    await makeExpense(municipalityId, admin._id, mine._id, { title: 'Mine' });
    const foreign = await makeExpense(municipalityId, admin._id, theirs._id, { title: 'Theirs' });

    const list = await request(app).get('/api/expenses').set(authHeader(token));
    expect(list.status).toBe(200);
    expect(list.body.data.map((e) => e.title)).toEqual(['Mine']);

    const byId = await request(app).get(`/api/expenses/${foreign._id}`).set(authHeader(token));
    expect(byId.status).toBe(403);
  });

  it('refuses an expense linked to a programme in another barangay', async () => {
    const { admin, municipalityId, theirs, token } = await twoBarangayTown('sk_treasurer');
    const foreignProgram = await createProgram(municipalityId, admin._id, { barangay: theirs._id });

    const res = await request(app)
      .post('/api/expenses')
      .set(authHeader(token))
      .send({
        type: 'purchase_request',
        title: 'Charged to another barangay programme',
        amount: 500,
        transactionDate: '2026-03-01',
        program: foreignProgram._id.toString(),
      });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/another municipality or barangay/i);
  });

  it('hides another barangay documents from the list', async () => {
    const { admin, municipalityId, mine, theirs, token } = await twoBarangayTown();
    await makeDocument(municipalityId, admin._id, mine._id);
    await makeDocument(municipalityId, admin._id, theirs._id);
    await makeDocument(municipalityId, admin._id, undefined);

    const res = await request(app).get('/api/documents').set(authHeader(token));
    expect(res.status).toBe(200);
    // Own barangay plus the municipality-level document: two of the three.
    expect(res.body.data).toHaveLength(2);
  });

  it('scopes document stats, which previously counted the whole province', async () => {
    const { admin, municipalityId, mine, token } = await twoBarangayTown();
    const { user: otherAdmin, municipalityId: otherMunId } = await createUser({ role: 'municipal_admin' });
    await makeDocument(municipalityId, admin._id, mine._id);
    await makeDocument(otherMunId, otherAdmin._id, undefined);

    const res = await request(app).get('/api/documents/stats').set(authHeader(token));
    expect(res.status).toBe(200);
    const counted = res.body.data.byCategory.reduce((sum, c) => sum + c.count, 0);
    expect(counted).toBe(1);
    expect(res.body.data.recent).toHaveLength(1);
  });
});

describe('Accounts with no barangay keep municipality-wide scope', () => {
  it('shows a chairperson without a barangay every member in their municipality', async () => {
    const { user: admin, municipalityId } = await createUser({ role: 'municipal_admin' });
    const a = await createBarangay(municipalityId);
    const b = await createBarangay(municipalityId);
    // No barangay on the account — the state every existing SK account is in.
    const { token } = await createUser({ role: 'sk_chairperson', municipality: municipalityId });
    await makeYouth(municipalityId, a._id);
    await makeYouth(municipalityId, b._id);
    expect(admin).toBeDefined();

    const res = await request(app).get('/api/youth').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});
