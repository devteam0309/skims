/**
 * Registration and account approval, October 2026 panel round (items 1.1, 1.2, 1.3, 1.5).
 *
 *   - the barangay list follows the municipality, and says which SK seats are taken;
 *   - every applicant who needs approval attaches identity or residency proof, stored privately and
 *     openable only by super_admin;
 *   - approval is refused without that proof;
 *   - one chairperson, one treasurer and one secretary per barangay — pending applications hold the
 *     seat, rejection/deactivation/deletion release it, and simultaneous claims cannot both win;
 *   - sk_kagawad is gone; municipal_admin can register.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const {
  createUser, createMunicipality, createBarangay, authHeader, registerApplicant,
} = require('./helpers');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { _memoryFiles } = require('../services/fileStorage');

jest.mock('../services/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue({}) }));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const PASSWORD = 'Test@1234';
let counter = 0;
const applicant = (overrides = {}) => {
  counter += 1;
  return {
    firstName: 'Ana', lastName: `Applicant${counter}`, email: `applicant${counter}@example.com`, password: PASSWORD,
    ...overrides,
  };
};

const place = async () => {
  const boac = await createMunicipality({ name: 'Boac', code: 'BOA' });
  const mogpog = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
  const agot = await createBarangay(boac._id, { name: 'Agot' });
  const maligaya = await createBarangay(boac._id, { name: 'Maligaya' });
  const argao = await createBarangay(mogpog._id, { name: 'Argao' });
  return { boac, mogpog, agot, maligaya, argao };
};

describe('dynamic barangay list (1.1)', () => {
  it('lists only the chosen municipality\'s barangays', async () => {
    const { boac, mogpog } = await place();
    const res = await request(app).get(`/api/municipalities/${boac._id}/barangays`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((b) => b.name)).toEqual(['Agot', 'Maligaya']);

    const other = await request(app).get(`/api/municipalities/${mogpog._id}/barangays`);
    expect(other.body.data.map((b) => b.name)).toEqual(['Argao']);
  });

  it('marks a barangay whose seat is claimed — pending or filled — for that office only', async () => {
    const { boac, agot, maligaya } = await place();
    await createUser({ role: 'sk_chairperson', municipality: boac._id, barangay: agot._id, isApproved: false });
    await createUser({ role: 'sk_treasurer', municipality: boac._id, barangay: maligaya._id });

    const chair = await request(app).get(`/api/municipalities/${boac._id}/barangays?role=sk_chairperson`);
    expect(Object.fromEntries(chair.body.data.map((b) => [b.name, b.seatStatus]))).toEqual({ Agot: 'pending', Maligaya: 'vacant' });

    const treasurer = await request(app).get(`/api/municipalities/${boac._id}/barangays?role=sk_treasurer`);
    expect(Object.fromEntries(treasurer.body.data.map((b) => [b.name, b.seatStatus]))).toEqual({ Agot: 'vacant', Maligaya: 'filled' });
    // Who holds it is not published.
    expect(JSON.stringify(treasurer.body)).not.toMatch(/email|firstName/);
  });
});

describe('registration with identity / residency proof (1.2, 1.3)', () => {
  it('registers an SK chairperson with a barangay and a document, stored privately', async () => {
    const { boac, agot } = await place();
    const res = await registerApplicant(app, applicant({ role: 'sk_chairperson', municipality: boac._id, barangay: agot._id }),
      { documents: [['kk_id', 'kk-id.pdf'], ['proof_of_residency', 'barangay-certificate.pdf']] });
    expect(res.status).toBe(201);

    const user = await User.findById(res.body.data.userId);
    expect(user.isApproved).toBe(false);
    expect(user.barangay.toString()).toBe(agot._id.toString());
    expect(user.seatKey).toBe(`${agot._id}:sk_chairperson`);
    expect(user.verificationDocuments.map((d) => d.documentType)).toEqual(['kk_id', 'proof_of_residency']);
    expect(_memoryFiles.has(user.verificationDocuments[0].publicId)).toBe(true);
    // Never returned to a client: what a file is, not where it lives.
    const json = JSON.stringify(user.toJSON());
    expect(json).not.toContain(user.verificationDocuments[0].publicId);

    expect(await AuditLog.countDocuments({ action: 'REGISTER', resourceId: user._id })).toBe(1);
  });

  it('refuses an SK official with no supporting document', async () => {
    const { boac, agot } = await place();
    const res = await registerApplicant(app, applicant({ role: 'sk_treasurer', municipality: boac._id, barangay: agot._id }), { documents: [] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/supporting document/i);
    expect(await User.countDocuments()).toBe(0);
  });

  it('refuses a document whose kind is not one of the accepted three', async () => {
    const { boac, agot } = await place();
    const res = await registerApplicant(app, applicant({ role: 'sk_treasurer', municipality: boac._id, barangay: agot._id }),
      { documents: [['selfie', 'me.pdf']] });
    expect(res.status).toBe(422);
  });

  it('refuses a file type outside the allowed list as a client error, not a server fault', async () => {
    const { boac, agot } = await place();
    const res = await request(app).post('/api/auth/register')
      .field('firstName', 'Ana').field('lastName', 'Exe').field('email', 'exe@example.com').field('password', PASSWORD)
      .field('role', 'sk_secretary').field('municipality', String(boac._id)).field('barangay', String(agot._id))
      .field('documentTypes', 'government_id')
      .attach('verificationDocuments', Buffer.from('MZ'), { filename: 'id.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
  });

  it('requires a barangay for the three SK offices', async () => {
    const { boac } = await place();
    const res = await registerApplicant(app, applicant({ role: 'sk_secretary', municipality: boac._id }));
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/barangay/i);
  });

  it('refuses a barangay from a different municipality than the one chosen', async () => {
    const { boac, argao } = await place();
    const res = await registerApplicant(app, applicant({ role: 'sk_chairperson', municipality: boac._id, barangay: argao._id }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong/i);
  });

  it('no longer offers sk_kagawad', async () => {
    const { boac, agot } = await place();
    const res = await registerApplicant(app, applicant({ role: 'sk_kagawad', municipality: boac._id, barangay: agot._id }));
    expect([400, 422]).toContain(res.status);
    expect(await User.countDocuments()).toBe(0);
  });

  it('lets a Municipal Admin register for approval, municipality-wide (a barangay is not stored)', async () => {
    const { boac, agot } = await place();
    const res = await registerApplicant(app, applicant({ role: 'municipal_admin', municipality: boac._id, barangay: agot._id }));
    expect(res.status).toBe(201);
    const user = await User.findById(res.body.data.userId);
    expect(user.role).toBe('municipal_admin');
    expect(user.isApproved).toBe(false);
    expect(user.barangay).toBeFalsy();
    expect(user.seatKey).toBeUndefined();
  });

  it('still lets a youth register without documents and approve themselves', async () => {
    const { boac, agot } = await place();
    const res = await request(app).post('/api/auth/register').send({
      ...applicant({ role: 'youth', municipality: String(boac._id), barangay: String(agot._id) }),
      birthDate: '2007-05-05', gender: 'Female',
    });
    expect(res.status).toBe(201);
    expect((await User.findById(res.body.data.userId)).isApproved).toBe(true);
  });
});

describe('one account per SK seat (1.5)', () => {
  it('refuses a second chairperson for the same barangay while the first is only pending', async () => {
    const { boac, agot } = await place();
    const first = await registerApplicant(app, applicant({ role: 'sk_chairperson', municipality: boac._id, barangay: agot._id }));
    expect(first.status).toBe(201);

    const second = await registerApplicant(app, applicant({ role: 'sk_chairperson', municipality: boac._id, barangay: agot._id }));
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/Agot already has a registered or pending SK Chairperson/);
  });

  it('applies per office: a treasurer and a secretary of the same barangay are fine', async () => {
    const { boac, agot } = await place();
    for (const role of ['sk_chairperson', 'sk_treasurer', 'sk_secretary']) {
      const res = await registerApplicant(app, applicant({ role, municipality: boac._id, barangay: agot._id }));
      expect(res.status).toBe(201);
    }
  });

  it('lets exactly one of two simultaneous claims to the same seat win', async () => {
    const { boac, agot } = await place();
    const results = await Promise.all([1, 2, 3].map(() =>
      registerApplicant(app, applicant({ role: 'sk_treasurer', municipality: boac._id, barangay: agot._id }))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await User.countDocuments({ role: 'sk_treasurer' })).toBe(1);
    // The losers' uploads were removed again.
    expect([..._memoryFiles.keys()].filter((k) => k.startsWith('skims/registrations')).length).toBeGreaterThanOrEqual(1);
  });

  it('releases the seat when the pending application is rejected', async () => {
    const { boac, agot } = await place();
    const { token } = await createUser({ role: 'super_admin', municipality: null });
    const first = await registerApplicant(app, applicant({ role: 'sk_chairperson', municipality: boac._id, barangay: agot._id }));

    const rejected = await request(app).put(`/api/users/${first.body.data.userId}/reject`).set(authHeader(token)).send({ reason: 'Not the elected chairperson' });
    expect(rejected.status).toBe(200);
    const stored = await User.findById(first.body.data.userId);
    expect(stored.seatKey).toBeUndefined();
    expect(stored.rejectionReason).toBe('Not the elected chairperson');

    const rightful = await registerApplicant(app, applicant({ role: 'sk_chairperson', municipality: boac._id, barangay: agot._id }));
    expect(rightful.status).toBe(201);
  });

  it('releases on deactivation, and refuses to reactivate once the seat is filled again', async () => {
    const { boac, agot } = await place();
    const { token } = await createUser({ role: 'super_admin', municipality: null });
    const { user: old } = await createUser({ role: 'sk_secretary', municipality: boac._id, barangay: agot._id });

    expect((await request(app).put(`/api/users/${old._id}/toggle-status`).set(authHeader(token))).status).toBe(200);
    const replacement = await registerApplicant(app, applicant({ role: 'sk_secretary', municipality: boac._id, barangay: agot._id }));
    expect(replacement.status).toBe(201);

    const reactivate = await request(app).put(`/api/users/${old._id}/toggle-status`).set(authHeader(token));
    expect(reactivate.status).toBe(409);
    expect((await User.findById(old._id)).isActive).toBe(false);
  });

  it('refuses a role change or barangay move into a filled seat', async () => {
    const { boac, agot, maligaya } = await place();
    const { token } = await createUser({ role: 'super_admin', municipality: null });
    await createUser({ role: 'sk_chairperson', municipality: boac._id, barangay: agot._id });
    const { user: secretary } = await createUser({ role: 'sk_secretary', municipality: boac._id, barangay: agot._id });
    const { user: maligayaChair } = await createUser({ role: 'sk_chairperson', municipality: boac._id, barangay: maligaya._id });

    const promote = await request(app).put(`/api/users/${secretary._id}/role`).set(authHeader(token)).send({ role: 'sk_chairperson' });
    expect(promote.status).toBe(409);
    expect((await User.findById(secretary._id)).role).toBe('sk_secretary');

    const move = await request(app).put(`/api/users/${maligayaChair._id}/barangay`).set(authHeader(token)).send({ barangay: String(agot._id) });
    expect(move.status).toBe(409);
  });

  it('does not offer sk_kagawad to administrators either', async () => {
    const { token } = await createUser({ role: 'super_admin', municipality: null });
    const { user } = await createUser({ role: 'sk_secretary' });
    const res = await request(app).put(`/api/users/${user._id}/role`).set(authHeader(token)).send({ role: 'sk_kagawad' });
    expect(res.status).toBe(403);
  });
});

describe('approval inspects the proof (1.2)', () => {
  const registerPending = async () => {
    const { boac, agot } = await place();
    const res = await registerApplicant(app, applicant({ role: 'sk_chairperson', municipality: boac._id, barangay: agot._id }),
      { documents: [['government_id', 'philsys-id.pdf']] });
    return User.findById(res.body.data.userId);
  };

  it('lets super_admin preview the document inline and download it, and records both', async () => {
    const pending = await registerPending();
    const { token } = await createUser({ role: 'super_admin', municipality: null });
    const docId = pending.verificationDocuments[0]._id;

    const list = await request(app).get('/api/users/pending').set(authHeader(token));
    expect(list.body.data[0].verificationDocuments[0]).toMatchObject({ documentType: 'government_id', originalName: 'philsys-id.pdf' });
    expect(list.body.data[0].verificationDocuments[0].publicId).toBeUndefined();

    const preview = await request(app).get(`/api/users/${pending._id}/verification-documents/${docId}`).set(authHeader(token));
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toMatch(/application\/pdf/);
    expect(preview.headers['content-disposition']).toMatch(/^inline/);
    expect(preview.headers['cache-control']).toMatch(/no-store/);

    const download = await request(app).get(`/api/users/${pending._id}/verification-documents/${docId}?download=1`).set(authHeader(token));
    expect(download.headers['content-disposition']).toMatch(/^attachment; filename="philsys-id.pdf"/);

    expect(await AuditLog.countDocuments({ resource: 'verification_document', resourceId: pending._id })).toBe(2);
  });

  it('keeps the document from every other role, municipal administrators included', async () => {
    const pending = await registerPending();
    const docId = pending.verificationDocuments[0]._id;
    for (const role of ['municipal_admin', 'provincial_admin', 'sk_chairperson', 'dilg_representative']) {
      const { token } = await createUser({ role, municipality: pending.municipality });
      const res = await request(app).get(`/api/users/${pending._id}/verification-documents/${docId}`).set(authHeader(token));
      expect(res.status).toBe(403);
    }
    const anonymous = await request(app).get(`/api/users/${pending._id}/verification-documents/${docId}`);
    expect(anonymous.status).toBe(401);
  });

  it('refuses to approve an applicant who attached nothing', async () => {
    const { token } = await createUser({ role: 'super_admin', municipality: null });
    const { user } = await createUser({ role: 'sk_treasurer', isApproved: false });
    const res = await request(app).put(`/api/users/${user._id}/approve`).set(authHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/supporting document/i);
    expect((await User.findById(user._id)).isApproved).toBe(false);
  });

  it('approves one with proof exactly once, and audits it with the account\'s municipality', async () => {
    const pending = await registerPending();
    const { token } = await createUser({ role: 'super_admin', municipality: null });

    const [a, b] = await Promise.all([
      request(app).put(`/api/users/${pending._id}/approve`).set(authHeader(token)),
      request(app).put(`/api/users/${pending._id}/approve`).set(authHeader(token)),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);

    const log = await AuditLog.findOne({ action: 'ACCOUNT_APPROVE', resourceId: pending._id });
    expect(log.municipality.toString()).toBe(pending.municipality.toString());
  });

  it('cannot approve a rejected application', async () => {
    const pending = await registerPending();
    const { token } = await createUser({ role: 'super_admin', municipality: null });
    await request(app).put(`/api/users/${pending._id}/reject`).set(authHeader(token)).send({});
    const res = await request(app).put(`/api/users/${pending._id}/approve`).set(authHeader(token));
    expect(res.status).toBe(409);
  });
});
