/*
 * What the search boxes actually match, and what they must not reach.
 *
 * Every list search is a case-insensitive SUBSTRING match on escaped input. Two of them were
 * `$text` instead, which matches whole indexed words only — "Resolut" found nothing that
 * "Resolution" found. Programmes was fixed after the panel reported it; documents was left behind
 * and is fixed here.
 *
 * The last block pins municipality reach for accounts that have none. `getDocuments` and
 * `getLiquidations` used an inline `!== super_admin && !== provincial_admin` pair rather than the
 * shared role lists, which excluded dilg_representative from the province-wide reads it is
 * supposed to have — a DILG account saw an empty Documents page.
 *
 * It also asserts the other direction: a scoped account whose municipality is missing must read
 * nothing. That already held (Mongoose 8 treats an `undefined` filter value as null rather than
 * dropping the key), so this is a guard against a future change to that behaviour or to the
 * scoping code, not a fix for a live hole.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const jwt = require('jsonwebtoken');
const { createUser, createMunicipality, createBudget, authHeader } = require('./helpers');
const Document = require('../models/Document');
const User = require('../models/User');

/*
 * A user whose `municipality` key is ABSENT, not null — createUser() always supplies the key, so
 * it cannot express this case.
 *
 * Absent reads back as `undefined`, which is the value the scoping code actually sees for the
 * seeded super_admin, provincial_admin and DILG accounts. Verified against Mongoose 8: a filter
 * value of `undefined` matches the same as `null` — nothing — rather than being dropped from the
 * query. Worth pinning precisely because that is subtle and version-dependent.
 */
const createUserWithoutMunicipality = async (role) => {
  const user = await User.create({
    firstName: 'No', lastName: 'Municipality',
    email: `orphan-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'Test@1234', role, isEmailVerified: true, isActive: true, isApproved: true,
  });
  expect(user.municipality).toBeUndefined();
  const token = jwt.sign({ id: user._id, role },
    process.env.JWT_SECRET || 'skims-test-secret-key-for-testing-only', { expiresIn: '1h' });
  return { user, token };
};

jest.mock('../services/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue({}) }));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const makeDoc = (municipality, uploadedBy, over = {}) => Document.create({
  title: 'SK Resolution No. 001 - Series of 2026',
  description: 'Resolution adopting the Annual Barangay Youth Investment Program.',
  category: 'resolution',
  fileName: 'skims/documents/x', originalName: 'x.pdf',
  fileUrl: 'https://example.test/x.pdf', fileType: 'application/pdf', fileSize: 1024,
  municipality, uploadedBy, tags: ['abyip', 'planning'], ...over,
});

describe('documents: search matches partial terms', () => {
  it.each([
    ['Resolut', 'a prefix — the case $text could not serve'],
    ['resolution', 'a whole word, lower case'],
    ['SK Resolut', 'a phrase ending mid-word'],
    ['SERIES', 'different casing'],
  ])('finds the resolution by %s (%s)', async (term) => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_secretary' });
    await makeDoc(municipalityId, user._id);
    await makeDoc(municipalityId, user._id, { title: 'Coastal Clean-Up Report', description: 'Shoreline works.', tags: [] });

    const res = await request(app).get(`/api/documents?search=${encodeURIComponent(term)}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toMatch(/Resolution/);
  });

  it('matches the description and the tags too', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_secretary' });
    await makeDoc(municipalityId, user._id);

    const byDescription = await request(app).get('/api/documents?search=Investment').set(authHeader(token));
    expect(byDescription.body.data).toHaveLength(1);

    const byTag = await request(app).get('/api/documents?search=abyip').set(authHeader(token));
    expect(byTag.body.data).toHaveLength(1);
  });

  it('treats regex metacharacters as literal text', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_secretary' });
    await makeDoc(municipalityId, user._id);

    const res = await request(app).get('/api/documents?search=.*').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('never reaches another municipality', async () => {
    const a = await createUser({ role: 'sk_secretary' });
    const b = await createUser({ role: 'sk_secretary' });
    await makeDoc(a.municipalityId, a.user._id);
    await makeDoc(b.municipalityId, b.user._id);

    const res = await request(app).get('/api/documents?search=Resolut').set(authHeader(a.token));
    expect(res.body.data).toHaveLength(1);
  });
});

describe('budgets: search covers the fiscal year, not just the title', () => {
  const seed = async (mun, by) => {
    await createBudget(mun, by, { title: 'SK Annual Budget', fiscalYear: 2026 });
    await createBudget(mun, by, { title: 'Supplemental Budget', fiscalYear: 2027 });
  };

  it('finds a budget by its fiscal year', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    await seed(municipalityId, user._id);

    const res = await request(app).get('/api/budgets?search=2027').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].fiscalYear).toBe(2027);
  });

  it('still finds a budget by a fragment of its title', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    await seed(municipalityId, user._id);

    const res = await request(app).get('/api/budgets?search=Supplement').set(authHeader(token));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Supplemental Budget');
  });

  // A four-digit term is compared numerically ALONGSIDE the text match, not instead of it.
  it('does not lose title matches when the term looks like a year', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    await createBudget(municipalityId, user._id, { title: 'Budget for 2026 programmes', fiscalYear: 2030 });

    const res = await request(app).get('/api/budgets?search=2026').set(authHeader(token));
    expect(res.body.data).toHaveLength(1);
  });
});

/* --------------------------------------------------------------------------------------------- *
 * Municipality reach for accounts that have none: scoped roles see nothing, DILG sees everything.
 * --------------------------------------------------------------------------------------------- */
describe('a scoped account with no municipality reads nothing', () => {
  const seedTwoMunicipalities = async () => {
    const a = await createUser({ role: 'sk_secretary' });
    const b = await createUser({ role: 'sk_secretary' });
    await makeDoc(a.municipalityId, a.user._id);
    await makeDoc(b.municipalityId, b.user._id, { title: 'Another Resolution' });
    return { a, b };
  };

  it.each(['sk_secretary', 'sk_chairperson', 'sk_treasurer', 'sk_kagawad', 'municipal_admin'])(
    'returns an empty document list for a %s whose municipality is missing',
    async (role) => {
      await seedTwoMunicipalities();
      const orphan = await createUserWithoutMunicipality(role);

      const res = await request(app).get('/api/documents').set(authHeader(orphan.token));
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    },
  );

  it('stays empty when the same account searches', async () => {
    await seedTwoMunicipalities();
    const orphan = await createUserWithoutMunicipality('sk_secretary');

    const res = await request(app).get('/api/documents?search=Resolut').set(authHeader(orphan.token));
    expect(res.body.data).toHaveLength(0);
  });

  // The counterpart: DILG has no municipality either, and is province-wide by design.
  it('but dilg_representative still sees every municipality', async () => {
    await seedTwoMunicipalities();
    const dilg = await createUserWithoutMunicipality('dilg_representative');

    const res = await request(app).get('/api/documents').set(authHeader(dilg.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('and dilg_representative can search across them', async () => {
    await seedTwoMunicipalities();
    const dilg = await createUserWithoutMunicipality('dilg_representative');

    const res = await request(app).get('/api/documents?search=Resolut').set(authHeader(dilg.token));
    expect(res.body.data).toHaveLength(2);
  });

  it('and sees liquidations across municipalities, which the old check denied it', async () => {
    const dilg = await createUserWithoutMunicipality('dilg_representative');
    const res = await request(app).get('/api/liquidations').set(authHeader(dilg.token));
    expect(res.status).toBe(200);
  });
});
