/*
 * Regressions for the September 2026 panel round.
 *
 * Each block names the reported symptom, because several of these were reported as something other
 * than what they were — "Resource not found" for a cast failure, "no data" for a fail-closed
 * filter — and the symptom is what a future reader will be searching for.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createMunicipality, createBudget, authHeader } = require('./helpers');
const Program = require('../models/Program');
const YouthMember = require('../models/YouthMember');

jest.mock('../services/emailService', () => new Proxy({}, {
  get: () => jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const programBody = (extra = {}) => ({
  title: 'Youth Leadership Summit 2026',
  description: 'A leadership training programme for SK youth leaders across the municipality.',
  category: 'governance',
  budget: 50000,
  startDate: '2026-01-15',
  endDate: '2026-12-31',
  targetParticipants: 100,
  ...extra,
});

/* --------------------------------------------------------------------------------------------- *
 * Items 3 & 4 — "Unable to create a new program" / "Resource not found" when editing
 * --------------------------------------------------------------------------------------------- */
describe('programs: a blank optional reference must not fail the write', () => {
  it('creates a program when no budget is linked (budgetRef arrives as "")', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).post('/api/programs').set(authHeader(token))
      .send(programBody({ budgetRef: '', barangay: '' }));

    expect(res.status).toBe(201);
    expect(res.body.data.budgetRef).toBeFalsy();
  });

  it('saves an edit when no budget is linked', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const created = await request(app).post('/api/programs').set(authHeader(token)).send(programBody());
    expect(created.status).toBe(201);

    const res = await request(app).put(`/api/programs/${created.body.data._id}`).set(authHeader(token))
      .send({ ...programBody({ title: 'Youth Leadership Summit 2026 (revised)' }), budgetRef: '', barangay: '' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Youth Leadership Summit 2026 (revised)');
    expect(municipalityId).toBeDefined();
    expect(user._id).toBeDefined();
  });

  it('clears a linked budget rather than rejecting the update', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const budget = await createBudget(municipalityId, user._id, { status: 'approved' });

    const created = await request(app).post('/api/programs').set(authHeader(token))
      .send(programBody({ budgetRef: budget._id.toString() }));
    expect(created.status).toBe(201);
    expect(created.body.data.budgetRef).toBeTruthy();

    const res = await request(app).put(`/api/programs/${created.body.data._id}`).set(authHeader(token))
      .send({ budgetRef: '' });
    expect(res.status).toBe(200);

    const after = await Program.findById(created.body.data._id);
    expect(after.budgetRef).toBeFalsy();
  });

  // The masking is the reason this took a panel round to surface: a bad field read as a missing record.
  it('reports a malformed field as 400 naming the field, not 404', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).post('/api/programs').set(authHeader(token))
      .send(programBody({ budgetRef: 'not-an-object-id' }));

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/budgetRef/);
  });

  it('still reports a malformed :id as 404', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).get('/api/programs/not-an-object-id').set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

/* --------------------------------------------------------------------------------------------- *
 * Item 5 — "the programs being searched for do not appear in the search results"
 * --------------------------------------------------------------------------------------------- */
describe('programs: search matches partial terms', () => {
  const seed = async (token) => {
    await request(app).post('/api/programs').set(authHeader(token)).send(programBody());
    await request(app).post('/api/programs').set(authHeader(token)).send(programBody({
      title: 'Coastal Clean-Up Drive', description: 'Shoreline clean-up across the coastal barangays.',
    }));
  };

  it.each([
    ['Lead', 'a prefix of a word — the case $text could not serve'],
    ['leadership', 'a whole word, lower case'],
    ['Youth Lead', 'a phrase ending mid-word'],
    ['SUMMIT', 'different casing'],
  ])('finds the summit by %s (%s)', async (term) => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    await seed(token);

    const res = await request(app).get(`/api/programs?search=${encodeURIComponent(term)}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toMatch(/Leadership Summit/);
  });

  it('matches the description as well as the title', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    await seed(token);

    const res = await request(app).get('/api/programs?search=shoreline').set(authHeader(token));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Coastal Clean-Up Drive');
  });

  // The term is data, not a pattern: unescaped, this would match everything.
  it('treats regex metacharacters as literal text', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    await seed(token);

    const res = await request(app).get('/api/programs?search=.*').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('keeps search inside the caller\'s own municipality', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    await seed(token);
    const other = await createUser({ role: 'sk_chairperson' });
    await seed(other.token);

    const res = await request(app).get('/api/programs?search=Lead').set(authHeader(token));
    expect(res.body.data).toHaveLength(1);
  });
});

/* --------------------------------------------------------------------------------------------- *
 * Items 9 & 13 — "arrange Youth Members alphabetically"
 * --------------------------------------------------------------------------------------------- */
describe('youth registry: ordered as the name column reads', () => {
  it('sorts by first name, then surname', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    for (const [firstName, lastName] of [['Juan', 'dela Cruz'], ['Ana', 'Reyes'], ['Ana', 'Bautista'], ['Zenaida', 'Cruz']]) {
      await YouthMember.create({
        firstName, lastName, birthDate: new Date('2006-05-05'), gender: 'Female', municipality: municipalityId,
      });
    }

    const res = await request(app).get('/api/youth').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.map((m) => `${m.firstName} ${m.lastName}`)).toEqual([
      'Ana Bautista', 'Ana Reyes', 'Juan dela Cruz', 'Zenaida Cruz',
    ]);
  });
});

/* --------------------------------------------------------------------------------------------- *
 * Item 6 — "Unable to add new Youth Members" as SK Chairperson
 * Covered in youthSelfService.test.js; asserted here against the isolation rule it must not bend.
 * --------------------------------------------------------------------------------------------- */
describe('youth registry: a chairperson registers into their OWN municipality only', () => {
  it('ignores a foreign municipality in the body', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const foreign = await createMunicipality();

    const res = await request(app).post('/api/youth').set(authHeader(token)).send({
      firstName: 'Nena', lastName: 'Ilagan', birthDate: '2007-02-02',
      gender: 'Female', municipality: foreign._id.toString(),
    });

    expect(res.status).toBe(201);
    const stored = await YouthMember.findById(res.body.data._id);
    expect(stored.municipality.toString()).toBe(municipalityId.toString());
  });
});

/* --------------------------------------------------------------------------------------------- *
 * Item 8 — the barangay filter's "Pick a municipality" dead end
 * --------------------------------------------------------------------------------------------- */
describe('municipalities: province-wide barangay list', () => {
  it('returns barangays from every municipality, each naming its own', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const Barangay = require('../models/Barangay');
    const a = await createMunicipality({ name: 'Alpha' });
    const b = await createMunicipality({ name: 'Bravo' });
    await Barangay.create({ name: 'Tanza', municipality: a._id });
    await Barangay.create({ name: 'Libtangin', municipality: b._id });

    const res = await request(app).get('/api/municipalities/barangays').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((x) => x.municipality.name).sort()).toEqual(['Alpha', 'Bravo']);
  });

  // Declared before /:id, or Express reads "barangays" as a municipality id.
  it('is not shadowed by the /:id route', async () => {
    const { token } = await createUser({ role: 'super_admin' });
    const res = await request(app).get('/api/municipalities/barangays').set(authHeader(token));
    expect(res.status).not.toBe(404);
  });
});

/* --------------------------------------------------------------------------------------------- *
 * Item 11 — "no content displayed in the DILG Representative section"
 * --------------------------------------------------------------------------------------------- */
describe('dilg_representative: reads the province, writes nothing', () => {
  const withData = async () => {
    const dilg = await createUser({ role: 'dilg_representative', municipality: null });
    const a = await createUser({ role: 'sk_chairperson' });
    const b = await createUser({ role: 'sk_chairperson' });
    await request(app).post('/api/programs').set(authHeader(a.token)).send(programBody());
    await request(app).post('/api/programs').set(authHeader(b.token)).send(programBody({ title: 'Coastal Clean-Up Drive' }));
    return { dilg, a, b };
  };

  it('sees programs from every municipality, not an empty list', async () => {
    const { dilg } = await withData();
    const res = await request(app).get('/api/programs').set(authHeader(dilg.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('reads a single program belonging to any municipality', async () => {
    const { dilg, a } = await withData();
    const list = await request(app).get('/api/programs').set(authHeader(a.token));
    const res = await request(app).get(`/api/programs/${list.body.data[0]._id}`).set(authHeader(dilg.token));
    expect(res.status).toBe(200);
  });

  it('opens Reports and Analytics', async () => {
    const { dilg } = await withData();
    for (const path of ['/api/analytics/fund-utilization', '/api/analytics/program-success', '/api/analytics/youth-engagement']) {
      const res = await request(app).get(path).set(authHeader(dilg.token));
      expect(res.status).toBe(200);
    }
  });

  it('reaches the dashboard with real figures rather than zeroes', async () => {
    const { dilg } = await withData();
    const res = await request(app).get('/api/dashboard').set(authHeader(dilg.token));
    expect(res.status).toBe(200);
    expect(res.body.data.kpis.totalPrograms).toBe(2);
  });

  /*
   * The other half of the decision, and the more important one: province-wide READS must not have
   * quietly become province-wide writes. Approval rights it held only nominally are gone too.
   */
  it('cannot create a program', async () => {
    const { dilg } = await withData();
    const res = await request(app).post('/api/programs').set(authHeader(dilg.token)).send(programBody());
    expect(res.status).toBe(403);
  });

  it('cannot edit a program in any municipality', async () => {
    const { dilg, a } = await withData();
    const list = await request(app).get('/api/programs').set(authHeader(a.token));
    const res = await request(app).put(`/api/programs/${list.body.data[0]._id}`).set(authHeader(dilg.token))
      .send({ title: 'Renamed by oversight' });
    expect(res.status).toBe(403);
  });

  it('cannot register a youth member', async () => {
    const { dilg } = await withData();
    const mun = await createMunicipality();
    const res = await request(app).post('/api/youth').set(authHeader(dilg.token)).send({
      firstName: 'Nena', lastName: 'Ilagan', birthDate: '2007-02-02',
      gender: 'Female', municipality: mun._id.toString(),
    });
    expect(res.status).toBe(403);
  });

  it('cannot approve or reject a budget', async () => {
    const { dilg, a } = await withData();
    const budget = await createBudget(a.municipalityId, a.user._id, { status: 'pending_approval' });
    for (const action of ['approve', 'reject']) {
      const res = await request(app).patch(`/api/budgets/${budget._id}/${action}`).set(authHeader(dilg.token))
        .send({ rejectionReason: 'no' });
      expect(res.status).toBe(403);
    }
  });
});

/* --------------------------------------------------------------------------------------------- *
 * Item 14 — Secretary redirected to the Dashboard instead of Reports and Analytics
 * --------------------------------------------------------------------------------------------- */
describe('sk_secretary: reports yes, approvals no', () => {
  it('opens reports and analytics', async () => {
    const { token } = await createUser({ role: 'sk_secretary' });
    const analytics = await request(app).get('/api/analytics/program-success').set(authHeader(token));
    expect(analytics.status).toBe(200);
    const reports = await request(app).get('/api/reports/programs?format=json').set(authHeader(token));
    expect(reports.status).not.toBe(403);
  });

  /*
   * The reason REPORTERS had to be split first. Adding the Secretary to the single old constant
   * would have granted expense and liquidation approval as a side effect of a reporting request.
   */
  it('cannot approve an expense', async () => {
    const { token } = await createUser({ role: 'sk_secretary' });
    const res = await request(app).patch('/api/expenses/000000000000000000000000/approve').set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('cannot approve or reject a liquidation', async () => {
    const { token } = await createUser({ role: 'sk_secretary' });
    for (const action of ['approve', 'reject']) {
      const res = await request(app).patch(`/api/liquidations/000000000000000000000000/${action}`)
        .set(authHeader(token)).send({ rejectionReason: 'no' });
      expect(res.status).toBe(403);
    }
  });
});
