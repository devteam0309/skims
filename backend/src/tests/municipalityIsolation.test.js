const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createMunicipality, createBudget, createProgram, authHeader } = require('./helpers');
const Program = require('../models/Program');
const YouthMember = require('../models/YouthMember');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

/*
 * The review panel reported seeing other municipalities' data. These lock the boundary down per
 * module so a regression shows up here rather than in a demo. The scoped roles are everything
 * except super_admin and provincial_admin, which are province-wide by design.
 */
const SCOPED_ROLES = ['municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary'];

describe('budgets are municipality-isolated', () => {
  it.each(SCOPED_ROLES)('%s sees only their own municipality budget', async (role) => {
    const mine = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
    const theirs = await createMunicipality({ name: 'Sta. Cruz', code: 'STC' });
    const { token, user } = await createUser({ role, municipality: mine._id });
    await createBudget(mine._id, user._id, { title: 'Mogpog FY2026' });
    await createBudget(theirs._id, user._id, { title: 'Sta. Cruz FY2026' });

    const res = await request(app).get('/api/budgets').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Mogpog FY2026');
  });

  it('ignores an explicit municipality query parameter aimed at another municipality', async () => {
    const mine = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
    const theirs = await createMunicipality({ name: 'Sta. Cruz', code: 'STC' });
    const { token, user } = await createUser({ role: 'sk_chairperson', municipality: mine._id });
    await createBudget(theirs._id, user._id, { title: 'Sta. Cruz FY2026' });

    const res = await request(app).get(`/api/budgets?municipality=${theirs._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('programs are municipality-isolated', () => {
  it.each(SCOPED_ROLES)('%s sees only their own municipality programs', async (role) => {
    const mine = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
    const theirs = await createMunicipality({ name: 'Sta. Cruz', code: 'STC' });
    const { token, user } = await createUser({ role, municipality: mine._id });
    await createProgram(mine._id, user._id, { title: 'Mogpog Sports Fest' });
    await createProgram(theirs._id, user._id, { title: 'Sta. Cruz Clean-up' });

    const res = await request(app).get('/api/programs').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Mogpog Sports Fest');
  });

  it('returns 404 rather than another municipality program by direct id', async () => {
    const mine = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
    const theirs = await createMunicipality({ name: 'Sta. Cruz', code: 'STC' });
    const { token, user } = await createUser({ role: 'sk_chairperson', municipality: mine._id });
    const foreign = await createProgram(theirs._id, user._id);

    const res = await request(app).get(`/api/programs/${foreign._id}`).set(authHeader(token));
    expect([403, 404]).toContain(res.status);
  });

  /*
   * The body used to win whenever it was present, so a scoped user could file a program under a
   * municipality they cannot even read — it would vanish from their own list on creation.
   */
  it('ignores a municipality supplied in the create body', async () => {
    const mine = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
    const theirs = await createMunicipality({ name: 'Sta. Cruz', code: 'STC' });
    const { token } = await createUser({ role: 'sk_chairperson', municipality: mine._id });

    const res = await request(app).post('/api/programs').set(authHeader(token)).send({
      title: 'Smuggled Program',
      description: 'Attempts to file itself under another municipality',
      category: 'sports',
      municipality: theirs._id.toString(),
      budget: 1000,
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      targetParticipants: 10,
    });
    expect(res.status).toBe(201);

    const saved = await Program.findById(res.body.data._id);
    expect(saved.municipality.toString()).toBe(mine._id.toString());
  });

  it('blocks deleting a program belonging to another municipality', async () => {
    const mine = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
    const theirs = await createMunicipality({ name: 'Sta. Cruz', code: 'STC' });
    const { token, user } = await createUser({ role: 'municipal_admin', municipality: mine._id });
    const foreign = await createProgram(theirs._id, user._id);

    const res = await request(app).delete(`/api/programs/${foreign._id}`).set(authHeader(token));
    expect(res.status).toBe(403);

    const stillThere = await Program.findById(foreign._id);
    expect(stillThere.deletedAt).toBeNull();
  });
});

describe('youth registry is municipality-isolated', () => {
  it('lists only youth from the caller municipality', async () => {
    const mine = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
    const theirs = await createMunicipality({ name: 'Sta. Cruz', code: 'STC' });
    const { token, user } = await createUser({ role: 'sk_chairperson', municipality: mine._id });
    await YouthMember.create({
      firstName: 'Ana', lastName: 'Reyes', birthDate: new Date('2005-01-01'),
      gender: 'female', municipality: mine._id, registeredBy: user._id,
    });
    await YouthMember.create({
      firstName: 'Ben', lastName: 'Cruz', birthDate: new Date('2005-01-01'),
      gender: 'male', municipality: theirs._id, registeredBy: user._id,
    });

    const res = await request(app).get('/api/youth').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].firstName).toBe('Ana');
  });
});

/*
 * The cross-municipality comparison is the one province-wide view, and it is open to every
 * REPORTER — which includes an SK Chairperson. It may therefore carry programme activity, but no
 * peso figures, or it hands each municipality's budget to the neighbouring municipality's staff.
 */
describe('province-wide views carry no money', () => {
  it('municipality comparison reports no budget figures', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    await createProgram(municipalityId, user._id, { budget: 999999 });

    const res = await request(app).get('/api/dashboard/municipality-comparison').set(authHeader(token));
    expect(res.status).toBe(200);
    for (const row of res.body.data) {
      expect(row.totalBudget).toBeUndefined();
    }
    expect(JSON.stringify(res.body.data)).not.toContain('999999');
  });

  it('municipality report reports no budget figures', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    await createBudget(municipalityId, user._id, { totalBudget: 888888 });

    const res = await request(app).get('/api/monitoring/municipalities').set(authHeader(token));
    expect(res.status).toBe(200);
    for (const row of res.body.data) {
      expect(row.budgetStats).toBeUndefined();
    }
    expect(JSON.stringify(res.body.data)).not.toContain('888888');
  });
});
