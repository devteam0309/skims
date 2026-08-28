const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createMunicipality, authHeader } = require('./helpers');
const YouthMember = require('../models/YouthMember');
const Announcement = require('../models/Announcement');

jest.mock('../services/emailService', () => ({}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

/*
 * Regressions for the defects the compliance audit found. Each one reproduces the exact request
 * that succeeded before the fix, so a reintroduction fails here rather than in the next review.
 */

describe('D1 — a municipal_admin cannot file records into another municipality', () => {
  it('forces the caller municipality on youth create', async () => {
    const mine = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
    const theirs = await createMunicipality({ name: 'Santa Cruz', code: 'STC' });
    const { token } = await createUser({ role: 'municipal_admin', municipality: mine._id });

    const res = await request(app).post('/api/youth').set(authHeader(token)).send({
      firstName: 'Planted', lastName: 'Record', birthDate: '2008-01-01', gender: 'Male',
      municipality: theirs._id.toString(),
    });
    expect(res.status).toBe(201);

    const saved = await YouthMember.findById(res.body.data._id);
    expect(saved.municipality.toString()).toBe(mine._id.toString());
  });

  it('still lets a provincial_admin direct a record at a chosen municipality', async () => {
    const target = await createMunicipality({ name: 'Gasan', code: 'GAS' });
    const { token } = await createUser({ role: 'provincial_admin' });

    const res = await request(app).post('/api/youth').set(authHeader(token)).send({
      firstName: 'Legit', lastName: 'Entry', birthDate: '2008-01-01', gender: 'Female',
      municipality: target._id.toString(),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.municipality.toString()).toBe(target._id.toString());
  });
});

describe('D2 — a municipal_admin cannot read another municipality staff profile', () => {
  it('refuses a foreign user by id', async () => {
    const mine = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
    const theirs = await createMunicipality({ name: 'Santa Cruz', code: 'STC' });
    const { token } = await createUser({ role: 'municipal_admin', municipality: mine._id });
    const { user: foreign } = await createUser({ role: 'sk_treasurer', municipality: theirs._id });

    const res = await request(app).get(`/api/users/${foreign._id}`).set(authHeader(token));
    expect(res.status).toBe(403);
  });

  it('still allows a user in the same municipality', async () => {
    const mine = await createMunicipality({ name: 'Mogpog', code: 'MOG' });
    const { token } = await createUser({ role: 'municipal_admin', municipality: mine._id });
    const { user: peer } = await createUser({ role: 'sk_treasurer', municipality: mine._id });

    const res = await request(app).get(`/api/users/${peer._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
  });
});

describe('D3 — the youth report gender breakdown reflects the data', () => {
  const seedYouth = async (municipality, registeredBy, genders) => {
    for (const [i, gender] of genders.entries()) {
      await YouthMember.create({
        firstName: `Y${i}`, lastName: `L${i}`, birthDate: new Date('2007-01-01'),
        gender, municipality, registeredBy,
      });
    }
  };

  it('carries no empty buckets left over from the old enum', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    await seedYouth(municipalityId, user._id, ['Male', 'Female', 'LGBTQIA+']);

    const res = await request(app).get('/api/reports/youth').set(authHeader(token));
    expect(res.status).toBe(200);

    const gb = res.body.data.genderBreakdown;
    expect(Object.values(gb)).not.toContain(0);
    expect(gb['LGBTQIA+']).toBe(1);
  });

  it('groups case variants of the same value onto one line', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    await seedYouth(municipalityId, user._id, ['Male', 'male', 'MALE']);

    const res = await request(app).get('/api/reports/youth').set(authHeader(token));
    const gb = res.body.data.genderBreakdown;
    expect(Object.keys(gb)).toHaveLength(1);
    expect(Object.values(gb)[0]).toBe(3);
  });
});

describe('D5 — classification fields accept a custom entry', () => {
  it('youth educational attainment takes a level outside the suggestions', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).post('/api/youth').set(authHeader(token)).send({
      firstName: 'Als', lastName: 'Learner', birthDate: '2008-01-01', gender: 'Male',
      municipality: municipalityId.toString(), educationalAttainment: 'ALS Completer',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.educationalAttainment).toBe('als_completer');
  });

  it('finds that youth by the typed form of the level', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });
    await request(app).post('/api/youth').set(authHeader(token)).send({
      firstName: 'Als', lastName: 'Learner', birthDate: '2008-01-01', gender: 'Male',
      municipality: municipalityId.toString(), educationalAttainment: 'ALS Completer',
    });
    const res = await request(app)
      .get('/api/youth?educationalAttainment=ALS%20Completer').set(authHeader(token));
    expect(res.body.data).toHaveLength(1);
  });

  it('announcement type takes a custom value and still canonicalises "Event"', async () => {
    const { token, municipalityId } = await createUser({ role: 'municipal_admin' });

    const custom = await request(app).post('/api/announcements').set(authHeader(token))
      .send({ title: 'Barangay Assembly', content: 'x', type: 'Barangay Assembly' });
    expect(custom.status).toBe(201);
    expect(custom.body.data.type).toBe('barangay_assembly');

    // The event date and location fields are revealed by `type === 'event'`, so a typed "Event"
    // has to land on the same canonical string.
    const evt = await request(app).post('/api/announcements').set(authHeader(token))
      .send({ title: 'Sportsfest', content: 'x', type: 'Event' });
    expect(evt.body.data.type).toBe('event');

    const found = await Announcement.find({ municipality: municipalityId, type: 'event' });
    expect(found).toHaveLength(1);
  });
});
