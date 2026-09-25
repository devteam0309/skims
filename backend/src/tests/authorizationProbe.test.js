/**
 * Direct-request authorization probe.
 *
 * The brief's security phase asks for unauthorized actions attempted through the API itself rather
 * than through the UI, so this suite ignores the frontend entirely: every case here is a
 * hand-constructed request of the kind a browser devtools console or curl can send.
 *
 * The barangay and finance suites cover their own areas. What is left here is what belongs to no
 * single module: the audit trail's immutability, and the handful of endpoints where the guard is the
 * only thing standing between a scoped account and somebody else's records.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBarangay, createProgram, authHeader } = require('./helpers');
const AuditLog = require('../models/AuditLog');
const YouthMember = require('../models/YouthMember');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

describe('The audit trail cannot be written through the API', () => {
  /*
   * There is deliberately no POST, PUT, PATCH or DELETE on /api/audit-logs — the router mounts a
   * single GET. Asserted as a behaviour rather than trusted as a fact about the file, because adding
   * a mutation route later would be an easy and very quiet mistake.
   */
  it('offers no mutation route at all, even to super_admin', async () => {
    const { token } = await createUser({ role: 'super_admin', municipality: null });
    const log = await AuditLog.create({ user: null, action: 'CREATE', resource: 'program', details: {} });

    const attempts = [
      request(app).post('/api/audit-logs').set(authHeader(token)).send({ action: 'FAKE', resource: 'program' }),
      request(app).put(`/api/audit-logs/${log._id}`).set(authHeader(token)).send({ action: 'FAKE' }),
      request(app).patch(`/api/audit-logs/${log._id}`).set(authHeader(token)).send({ action: 'FAKE' }),
      request(app).delete(`/api/audit-logs/${log._id}`).set(authHeader(token)),
    ];

    for (const attempt of attempts) {
      const res = await attempt;
      // 404 (no such route) or 405 — anything but a success.
      expect(res.status).toBeGreaterThanOrEqual(400);
    }

    const stored = await AuditLog.findById(log._id);
    expect(stored.action).toBe('CREATE');
    expect(await AuditLog.countDocuments()).toBe(1);
  });

  it('is not readable by an ordinary SK account', async () => {
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    for (const role of ['sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'municipal_admin']) {
      const { token } = await createUser({ role, municipality: municipalityId });
      const res = await request(app).get('/api/audit-logs').set(authHeader(token));
      expect(res.status).toBe(403);
    }
  });
});

describe('User management is closed to everyone but super_admin', () => {
  it('refuses the whole surface to a municipal_admin', async () => {
    const { user: target, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const { token } = await createUser({ role: 'municipal_admin', municipality: municipalityId });
    const barangay = await createBarangay(municipalityId);

    const calls = [
      request(app).get('/api/users').set(authHeader(token)),
      request(app).get('/api/users/pending').set(authHeader(token)),
      request(app).get('/api/users/email-changes').set(authHeader(token)),
      request(app).put(`/api/users/${target._id}/approve`).set(authHeader(token)),
      request(app).put(`/api/users/${target._id}/role`).set(authHeader(token)).send({ role: 'super_admin' }),
      request(app).put(`/api/users/${target._id}/barangay`).set(authHeader(token)).send({ barangay: barangay._id.toString() }),
      request(app).delete(`/api/users/${target._id}`).set(authHeader(token)),
    ];

    for (const call of calls) {
      const res = await call;
      expect(res.status).toBe(403);
    }
  });
});

describe('Scope cannot be widened through a query parameter', () => {
  it('ignores ?municipality= pointing at another municipality', async () => {
    const { user: foreignAdmin, municipalityId: foreignMunId } = await createUser({ role: 'municipal_admin' });
    await createProgram(foreignMunId, foreignAdmin._id, { title: 'Theirs' });
    await YouthMember.create({
      firstName: 'Their', lastName: 'Member', birthDate: new Date('2006-01-01'), gender: 'male', municipality: foreignMunId,
    });

    const { user: admin, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token } = await createUser({ role: 'sk_chairperson', municipality: municipalityId });
    await createProgram(municipalityId, admin._id, { title: 'Mine' });

    const programs = await request(app).get(`/api/programs?municipality=${foreignMunId}`).set(authHeader(token));
    expect(programs.status).toBe(200);
    expect(programs.body.data.map((p) => p.title)).toEqual(['Mine']);

    const youth = await request(app).get(`/api/youth?municipality=${foreignMunId}`).set(authHeader(token));
    expect(youth.status).toBe(200);
    expect(youth.body.data).toHaveLength(0);
  });

  it('fails closed for an account with no municipality at all', async () => {
    // A scoped role with no municipality must match nothing, not everything.
    const { user: admin, municipalityId } = await createUser({ role: 'municipal_admin' });
    await createProgram(municipalityId, admin._id);
    const { token } = await createUser({ role: 'sk_chairperson', municipality: null });

    const programs = await request(app).get('/api/programs').set(authHeader(token));
    expect(programs.status).toBe(200);
    expect(programs.body.data).toHaveLength(0);

    const documents = await request(app).get('/api/documents').set(authHeader(token));
    expect(documents.body.data).toHaveLength(0);
  });
});

describe('The youth allowlist still governs the new endpoints', () => {
  /*
   * The `youth` role is denied everything not explicitly listed in YOUTH_ALLOWED, and the routes
   * added this round were deliberately not listed. This asserts the deny-by-default surface actually
   * covers them — which is the whole reason it was built that way.
   */
  it('denies a youth account the import, the recycle bin and the review actions', async () => {
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    const { user: youthUser, token } = await createUser({ role: 'youth', municipality: municipalityId });
    await YouthMember.create({
      firstName: 'Self', lastName: 'Registered', birthDate: new Date('2006-01-01'), gender: 'male',
      municipality: municipalityId, user: youthUser._id,
    });

    const calls = [
      request(app).post('/api/youth/import/preview').set(authHeader(token)),
      request(app).get('/api/documents/recycle-bin').set(authHeader(token)),
      request(app).get('/api/users/email-changes').set(authHeader(token)),
      request(app).get('/api/expenses').set(authHeader(token)),
      request(app).get('/api/budgets').set(authHeader(token)),
    ];

    for (const call of calls) {
      const res = await call;
      expect(res.status).toBe(403);
    }
  });
});
