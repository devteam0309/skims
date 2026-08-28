const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createMunicipality, createProgram, authHeader } = require('./helpers');
const User = require('../models/User');
const YouthMember = require('../models/YouthMember');
const Program = require('../models/Program');
const jwt = require('jsonwebtoken');

jest.mock('../services/emailService', () => ({
  sendEmailVerification: jest.fn().mockResolvedValue({}),
  sendApprovalNotification: jest.fn().mockResolvedValue({}),
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const sign = (user) => jwt.sign(
  { id: user._id, role: user.role },
  process.env.JWT_SECRET || 'skims-test-secret-key-for-testing-only',
  { expiresIn: '1h' }
);

/** A youth account that has already verified its email, as one would be after clicking the link. */
const makeYouth = async (municipalityId, overrides = {}) => {
  const res = await request(app).post('/api/auth/register').send({
    firstName: 'Ella', lastName: 'Marquez', email: `ella-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'Test@1234', role: 'youth', municipality: municipalityId.toString(),
    birthDate: '2008-05-04', gender: 'Female', ...overrides,
  });
  if (res.status !== 201) return { res };
  const user = await User.findById(res.body.data.userId);
  user.isEmailVerified = true;
  await user.save({ validateBeforeSave: false });
  return { res, user, token: sign(user) };
};

describe('youth self-registration', () => {
  it('creates the login and its registry record together', async () => {
    const mun = await createMunicipality();
    const { res, user } = await makeYouth(mun._id);
    expect(res.status).toBe(201);

    expect(user.role).toBe('youth');
    // Youth approve themselves — an admin in the middle would defeat the point of self-service.
    expect(user.isApproved).toBe(true);

    const member = await YouthMember.findOne({ user: user._id });
    expect(member).not.toBeNull();
    expect(member.email).toBe(user.email);
    // Nobody has vouched for it yet, and the registry is an official roster.
    expect(member.verificationStatus).toBe('unverified');
  });

  it('enforces the SK age band at sign-up', async () => {
    const mun = await createMunicipality();
    const { res } = await makeYouth(mun._id, { birthDate: '2018-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ages 15 to 30/i);
  });

  it('leaves no orphan login when the registry record cannot be created', async () => {
    const mun = await createMunicipality();
    const email = 'orphan@example.com';
    const res = await request(app).post('/api/auth/register').send({
      firstName: 'Too', lastName: 'Young', email, password: 'Test@1234',
      role: 'youth', municipality: mun._id.toString(), birthDate: '2018-01-01', gender: 'Male',
    });
    expect(res.status).toBe(400);

    // A half-created account would also block this address from ever registering again.
    expect(await User.findOne({ email })).toBeNull();
  });

  /*
   * The case that would otherwise be unrecoverable: staff canvassed this youth already, so the
   * unique index would reject a second record and the youth could never sign up.
   */
  it('claims an existing staff-entered record instead of duplicating the person', async () => {
    const mun = await createMunicipality();
    const { user: admin } = await createUser({ role: 'municipal_admin', municipality: mun._id });
    const staffRecord = await YouthMember.create({
      firstName: 'Ella', lastName: 'Marquez', birthDate: new Date('2008-05-04'),
      gender: 'Female', municipality: mun._id, registeredBy: admin._id, contactNumber: '09171234567',
    });

    const { res, user } = await makeYouth(mun._id);
    expect(res.status).toBe(201);

    expect(await YouthMember.countDocuments({ deletedAt: null })).toBe(1);
    const claimed = await YouthMember.findById(staffRecord._id);
    expect(claimed.user.toString()).toBe(user._id.toString());
    expect(claimed.email).toBe(user.email);
    // Staff-entered detail survives the claim.
    expect(claimed.contactNumber).toBe('09171234567');
  });

  it('refuses to claim a record that already belongs to someone', async () => {
    const mun = await createMunicipality();
    await makeYouth(mun._id);
    const second = await makeYouth(mun._id, { email: 'someone-else@example.com' });
    expect(second.res.status).toBe(409);
  });
});

describe('the youth role is closed by default', () => {
  const FORBIDDEN = [
    ['get', '/api/budgets'],
    ['get', '/api/expenses'],
    ['get', '/api/liquidations'],
    ['get', '/api/documents'],
    ['get', '/api/dashboard'],
    // The roster itself — other members' addresses and contact numbers.
    ['get', '/api/youth'],
    ['get', '/api/reports/financial'],
    ['get', '/api/monitoring/overview'],
  ];

  it.each(FORBIDDEN)('denies %s %s', async (method, url) => {
    const mun = await createMunicipality();
    const { token } = await makeYouth(mun._id);
    const res = await request(app)[method](url).set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('cannot create a youth record for anyone', async () => {
    const mun = await createMunicipality();
    const { token } = await makeYouth(mun._id);
    const res = await request(app).post('/api/youth').set(authHeader(token)).send({
      firstName: 'Ghost', lastName: 'Record', birthDate: '2008-01-01',
      gender: 'Male', municipality: mun._id.toString(),
    });
    expect(res.status).toBe(403);
  });

  it('can read its own record and the programs it may join', async () => {
    const mun = await createMunicipality();
    const { token } = await makeYouth(mun._id);
    expect((await request(app).get('/api/youth/me').set(authHeader(token))).status).toBe(200);
    expect((await request(app).get('/api/programs').set(authHeader(token))).status).toBe(200);
  });

  it('may correct its own contact details but not its identity', async () => {
    const mun = await createMunicipality();
    const { token, user } = await makeYouth(mun._id);
    const res = await request(app).put('/api/youth/me').set(authHeader(token))
      .send({ contactNumber: '09998887777', occupation: 'Student', lastName: 'Changed' });
    expect(res.status).toBe(200);

    const member = await YouthMember.findOne({ user: user._id });
    expect(member.contactNumber).toBe('09998887777');
    // Name identifies the record in an official roster; a correction goes through staff.
    expect(member.lastName).toBe('Marquez');
  });
});

describe('staff youth registration is narrowed to admins', () => {
  it('allows a municipal_admin', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).post('/api/youth').set(authHeader(token)).send({
      firstName: 'Nena', lastName: 'Ilagan', birthDate: '2007-02-02',
      gender: 'Female', municipality: municipalityId.toString(),
    });
    expect(res.status).toBe(201);
  });

  it('no longer allows an sk_chairperson', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).post('/api/youth').set(authHeader(token)).send({
      firstName: 'Nena', lastName: 'Ilagan', birthDate: '2007-02-02',
      gender: 'Female', municipality: municipalityId.toString(),
    });
    expect(res.status).toBe(403);
  });
});

describe('joining a program', () => {
  const setup = async () => {
    const mun = await createMunicipality();
    const { user: staff, token: staffToken } = await createUser({ role: 'sk_chairperson', municipality: mun._id });
    const program = await createProgram(mun._id, staff._id, {
      approvalStatus: 'approved', status: 'ongoing', targetParticipants: 1,
    });
    const youth = await makeYouth(mun._id);
    return { mun, staff, staffToken, program, youth };
  };

  it('records a request as pending rather than joining outright', async () => {
    const { program, youth } = await setup();
    const res = await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(youth.token));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('pending');

    // A request is not a slot.
    expect((await Program.findById(program._id)).actualParticipants).toBe(0);
  });

  it('refuses a program from another municipality', async () => {
    const { youth } = await setup();
    const other = await createMunicipality();
    const { user: otherStaff } = await createUser({ role: 'sk_chairperson', municipality: other._id });
    const foreign = await createProgram(other._id, otherStaff._id, { approvalStatus: 'approved' });

    const res = await request(app).post(`/api/programs/${foreign._id}/join`).set(authHeader(youth.token));
    expect(res.status).toBe(403);
  });

  it('refuses a program that has not been approved', async () => {
    const { mun, staff, youth } = await setup();
    const draft = await createProgram(mun._id, staff._id, { approvalStatus: 'draft', title: 'Not yet cleared' });
    const res = await request(app).post(`/api/programs/${draft._id}/join`).set(authHeader(youth.token));
    expect(res.status).toBe(400);
  });

  it('rejects a duplicate request', async () => {
    const { program, youth } = await setup();
    await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(youth.token));
    const again = await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(youth.token));
    expect(again.status).toBe(409);
  });

  it('confirms a request and counts it against the cap', async () => {
    const { program, staffToken, youth } = await setup();
    await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(youth.token));
    const member = await YouthMember.findOne({ user: youth.user._id });

    const res = await request(app)
      .patch(`/api/programs/${program._id}/participants/${member._id}`)
      .set(authHeader(staffToken))
      .send({ decision: 'confirmed' });
    expect(res.status).toBe(200);

    expect((await Program.findById(program._id)).actualParticipants).toBe(1);
  });

  it('turns away a request once the program is full', async () => {
    const { mun, program, staffToken, youth } = await setup(); // targetParticipants: 1
    await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(youth.token));
    const first = await YouthMember.findOne({ user: youth.user._id });
    await request(app).patch(`/api/programs/${program._id}/participants/${first._id}`)
      .set(authHeader(staffToken)).send({ decision: 'confirmed' });

    const second = await makeYouth(mun._id, {
      firstName: 'Noel', lastName: 'Bautista', email: 'noel@example.com', birthDate: '2007-09-09', gender: 'Male',
    });
    const res = await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(second.token));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/full/i);
  });

  it('declines a request with a reason, and lets it be made again', async () => {
    const { program, staffToken, youth } = await setup();
    await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(youth.token));
    const member = await YouthMember.findOne({ user: youth.user._id });

    const declined = await request(app)
      .patch(`/api/programs/${program._id}/participants/${member._id}`)
      .set(authHeader(staffToken))
      .send({ decision: 'declined', reason: 'Barangay quota already met' });
    expect(declined.status).toBe(200);
    expect((await Program.findById(program._id)).actualParticipants).toBe(0);

    // A single past decision must not lock a youth out of that programme forever.
    const retry = await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(youth.token));
    expect(retry.status).toBe(200);
  });

  it('will not decide the same request twice', async () => {
    const { program, staffToken, youth } = await setup();
    await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(youth.token));
    const member = await YouthMember.findOne({ user: youth.user._id });
    const url = `/api/programs/${program._id}/participants/${member._id}`;

    expect((await request(app).patch(url).set(authHeader(staffToken)).send({ decision: 'confirmed' })).status).toBe(200);
    expect((await request(app).patch(url).set(authHeader(staffToken)).send({ decision: 'confirmed' })).status).toBe(409);
  });

  it('shows staff the requests for their program', async () => {
    const { program, staffToken, youth } = await setup();
    await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(youth.token));

    const res = await request(app).get(`/api/programs/${program._id}/participants`).set(authHeader(staffToken));
    expect(res.status).toBe(200);
    expect(res.body.data.pending).toBe(1);
    expect(res.body.data.confirmed).toBe(0);
    expect(res.body.data.participants[0].lastName).toBe('Marquez');
  });

  it('withdraws a request and frees the slot', async () => {
    const { program, staffToken, youth } = await setup();
    await request(app).post(`/api/programs/${program._id}/join`).set(authHeader(youth.token));
    const member = await YouthMember.findOne({ user: youth.user._id });
    await request(app).patch(`/api/programs/${program._id}/participants/${member._id}`)
      .set(authHeader(staffToken)).send({ decision: 'confirmed' });

    const res = await request(app).delete(`/api/programs/${program._id}/join`).set(authHeader(youth.token));
    expect(res.status).toBe(200);
    expect((await Program.findById(program._id)).actualParticipants).toBe(0);
  });
});
