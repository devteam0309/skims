const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');
const AuditLog = require('../models/AuditLog');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const dob = (yearsAgo) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - yearsAgo);
  return d.toISOString().slice(0, 10);
};

const MEMBER_PAYLOAD = (overrides = {}) => ({
  firstName: 'Maria',
  lastName: 'Santos',
  birthDate: dob(20),
  gender: 'female',
  educationalAttainment: 'college',
  ...overrides,
});

describe('YouthMember audit trail', () => {
  it('writes a CREATE audit log entry on registration', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const res = await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER_PAYLOAD());
    expect(res.status).toBe(201);

    const log = await AuditLog.findOne({ resource: 'youth_member', action: 'CREATE' });
    expect(log).not.toBeNull();
    expect(log.resourceId.toString()).toBe(res.body.data._id);
    expect(log.user.toString()).toBe(user._id.toString());
    expect(log.municipality.toString()).toBe(municipalityId.toString());
  });

  it('writes an UPDATE audit log entry on edit', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER_PAYLOAD());
    const id = create.body.data._id;

    await request(app).put(`/api/youth/${id}`).set(authHeader(token)).send({ firstName: 'Maricel' });

    const log = await AuditLog.findOne({ resource: 'youth_member', action: 'UPDATE', resourceId: id });
    expect(log).not.toBeNull();
    expect(log.details.changes).toContain('firstName');
  });

  it('writes a DELETE audit log entry on soft-delete', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const create = await request(app).post('/api/youth').set(authHeader(token)).send(MEMBER_PAYLOAD());
    const id = create.body.data._id;

    await request(app).delete(`/api/youth/${id}`).set(authHeader(token));

    const log = await AuditLog.findOne({ resource: 'youth_member', action: 'DELETE', resourceId: id });
    expect(log).not.toBeNull();
  });
});
