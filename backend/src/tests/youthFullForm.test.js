const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');
const Barangay = require('../models/Barangay');
const YouthMember = require('../models/YouthMember');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const dob = (yearsAgo) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  return d.toISOString().slice(0, 10);
};

// Mirrors the exact full-form object the frontend Youth.jsx submits (all keys present,
// blanks as empty strings) — including the ObjectId (barangay) and enum (educationalAttainment) fields.
const FULL_FORM = (overrides = {}) => ({
  firstName: 'Maria',
  lastName: 'Santos',
  birthDate: dob(20),
  gender: 'female',
  educationalAttainment: '',
  contactNumber: '',
  email: '',
  address: '',
  occupation: '',
  barangay: '',
  municipality: '',
  isRegisteredVoter: false,
  ...overrides,
});

describe('Youth full-form payload (regression for blank ObjectId/enum fields)', () => {
  it('creates with the full form when barangay/education/municipality are blank', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).post('/api/youth').set(authHeader(token)).send(FULL_FORM());
    expect(res.status).toBe(201);
    expect(res.body.data.firstName).toBe('Maria');
  });

  it('updates with the full form when barangay/education are blank (no CastError 404)', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/youth').set(authHeader(token)).send(FULL_FORM());
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/youth/${id}`)
      .set(authHeader(token))
      .send(FULL_FORM({ firstName: 'Maricel', isActive: true }));
    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe('Maricel');
  });

  it('sets non-empty optional fields on update', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const barangay = await Barangay.create({ name: 'Barangay Uno', municipality: municipalityId });
    const create = await request(app).post('/api/youth').set(authHeader(token)).send(FULL_FORM());
    const id = create.body.data._id;

    const res = await request(app)
      .put(`/api/youth/${id}`)
      .set(authHeader(token))
      .send(FULL_FORM({ educationalAttainment: 'college', barangay: barangay._id.toString(), contactNumber: '09171234567' }));
    expect(res.status).toBe(200);

    const updated = await YouthMember.findById(id);
    expect(updated.educationalAttainment).toBe('college');
    expect(updated.barangay.toString()).toBe(barangay._id.toString());
    expect(updated.contactNumber).toBe('09171234567');
  });

  it('clears a previously-set barangay when the field is blanked on update', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const barangay = await Barangay.create({ name: 'Barangay Dos', municipality: municipalityId });
    const create = await request(app)
      .post('/api/youth')
      .set(authHeader(token))
      .send(FULL_FORM({ barangay: barangay._id.toString(), educationalAttainment: 'college' }));
    const id = create.body.data._id;
    expect((await YouthMember.findById(id)).barangay).not.toBeNull();

    const res = await request(app)
      .put(`/api/youth/${id}`)
      .set(authHeader(token))
      .send(FULL_FORM({ barangay: '', educationalAttainment: '' }));
    expect(res.status).toBe(200);

    const updated = await YouthMember.findById(id);
    expect(updated.barangay == null).toBe(true);
    expect(updated.educationalAttainment == null).toBe(true);
  });
});
