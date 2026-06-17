const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');
const Barangay = require('../models/Barangay');
const Municipality = require('../models/Municipality');
const YouthMember = require('../models/YouthMember');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const dob = (yearsAgo) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  return d.toISOString().slice(0, 10);
};

const MEMBER = (overrides = {}) => ({
  firstName: 'Brgy',
  lastName: 'Test',
  birthDate: dob(20),
  gender: 'male',
  ...overrides,
});

describe('Youth barangay must belong to the member\'s municipality', () => {
  it('accepts a barangay that belongs to the user\'s municipality (create)', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const barangay = await Barangay.create({ name: 'Home Brgy', municipality: municipalityId });

    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(MEMBER({ barangay: barangay._id.toString() }));
    expect(res.status).toBe(201);
    expect(res.body.data.barangay.toString()).toBe(barangay._id.toString());
  });

  it('rejects a barangay from a DIFFERENT municipality (create) with 400', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const otherMun = await Municipality.create({ name: 'Other Town', code: 'OTH' });
    const foreignBrgy = await Barangay.create({ name: 'Foreign Brgy', municipality: otherMun._id });

    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(MEMBER({ barangay: foreignBrgy._id.toString() }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong/i);
  });

  it('rejects a non-existent barangay (create) with 400', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(MEMBER({ barangay: '000000000000000000000000' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not exist/i);
  });

  it('still creates when barangay is blank (no regression)', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(MEMBER({ barangay: '' }));
    expect(res.status).toBe(201);
  });

  it('accepts a same-municipality barangay on update', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const b1 = await Barangay.create({ name: 'B One', municipality: municipalityId });
    const b2 = await Barangay.create({ name: 'B Two', municipality: municipalityId });
    const create = await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER({ barangay: b1._id.toString() }));
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/youth/${id}`)
      .set(authHeader(token))
      .send(MEMBER({ barangay: b2._id.toString() }));
    expect(res.status).toBe(200);
    expect((await YouthMember.findById(id)).barangay.toString()).toBe(b2._id.toString());
  });

  it('rejects a foreign-municipality barangay on update with 400', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const home = await Barangay.create({ name: 'Home', municipality: municipalityId });
    const otherMun = await Municipality.create({ name: 'Far Town', code: 'FAR' });
    const foreign = await Barangay.create({ name: 'Far Brgy', municipality: otherMun._id });
    const create = await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER({ barangay: home._id.toString() }));
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/youth/${id}`)
      .set(authHeader(token))
      .send(MEMBER({ barangay: foreign._id.toString() }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not belong/i);

    // unchanged
    expect((await YouthMember.findById(id)).barangay.toString()).toBe(home._id.toString());
  });

  it('clears the barangay when blanked on update (no validation error)', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const home = await Barangay.create({ name: 'Clearable', municipality: municipalityId });
    const create = await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER({ barangay: home._id.toString() }));
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/youth/${id}`)
      .set(authHeader(token))
      .send(MEMBER({ barangay: '' }));
    expect(res.status).toBe(200);
    expect((await YouthMember.findById(id)).barangay == null).toBe(true);
  });
});
