/**
 * Document recycle bin.
 *
 * `deletedAt` was already a soft delete, but the Cloudinary asset was destroyed in the same call, so
 * the surviving record was unrecoverable in the only sense that matters — restoring it would have
 * produced a document whose every download 404s. The behaviour pinned here is that deletion keeps
 * the file and permanent deletion is a separate, explicit act.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');
const Document = require('../models/Document');
const AuditLog = require('../models/AuditLog');

jest.mock('../config/cloudinary', () => ({
  uploadToCloudinary: jest.fn(),
  destroyQuietly: jest.fn(),
  // Present so the mock stays a complete stand-in for the module even though this suite never
  // uploads — an incomplete mock fails as an undefined call deep in a handler, which reads as a 500.
  rawUploadOptions: jest.fn(() => ({ folder: 'skims/documents', resource_type: 'raw', public_id: 'test-upload' })),
  cloudinary: {},
}));
const { destroyQuietly } = require('../config/cloudinary');

beforeAll(connect);
afterAll(disconnect);
afterEach(async () => {
  destroyQuietly.mockClear();
  await clearDB();
});

const makeDoc = (municipality, uploadedBy, overrides = {}) => Document.create({
  title: 'Resolution 12',
  category: 'resolution',
  fileName: 'skims/documents/file-id',
  originalName: 'resolution-12.pdf',
  fileUrl: 'https://res.cloudinary.com/test/raw/upload/resolution-12',
  fileType: 'application/pdf',
  municipality,
  uploadedBy,
  ...overrides,
});

describe('Deleting a document moves it to the recycle bin', () => {
  it('keeps the record and the stored file', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await makeDoc(municipalityId, user._id);

    const res = await request(app).delete(`/api/documents/${doc._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/recycle bin/i);

    const stored = await Document.findById(doc._id);
    expect(stored).toBeTruthy();
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.deletedBy.toString()).toBe(user._id.toString());
    // The file must survive, or "restore" restores a broken document.
    expect(destroyQuietly).not.toHaveBeenCalled();
  });

  it('hides it from the ordinary list and from a direct request', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await makeDoc(municipalityId, user._id);
    await request(app).delete(`/api/documents/${doc._id}`).set(authHeader(token));

    const list = await request(app).get('/api/documents').set(authHeader(token));
    expect(list.body.data).toHaveLength(0);

    const byId = await request(app).get(`/api/documents/${doc._id}`).set(authHeader(token));
    expect(byId.status).toBe(404);
  });
});

describe('GET /api/documents/recycle-bin', () => {
  it('lists deleted documents, and only deleted ones', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const kept = await makeDoc(municipalityId, user._id, { title: 'Kept' });
    const binned = await makeDoc(municipalityId, user._id, { title: 'Binned' });
    await request(app).delete(`/api/documents/${binned._id}`).set(authHeader(token));

    const res = await request(app).get('/api/documents/recycle-bin').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Binned');
    expect(kept).toBeDefined();
  });

  it('does not show another municipality deleted documents', async () => {
    const { user: foreignUser, municipalityId: foreignMunId } = await createUser({ role: 'municipal_admin' });
    const { token } = await createUser({ role: 'municipal_admin' });
    const foreign = await makeDoc(foreignMunId, foreignUser._id);
    await Document.findByIdAndUpdate(foreign._id, { deletedAt: new Date() });

    const res = await request(app).get('/api/documents/recycle-bin').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('is closed to roles that cannot delete documents', async () => {
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token } = await createUser({ role: 'sk_chairperson', municipality: municipalityId });
    const res = await request(app).get('/api/documents/recycle-bin').set(authHeader(token));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/documents/:id/restore', () => {
  it('returns the document to the active list', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await makeDoc(municipalityId, user._id);
    await request(app).delete(`/api/documents/${doc._id}`).set(authHeader(token));

    const res = await request(app).patch(`/api/documents/${doc._id}/restore`).set(authHeader(token));
    expect(res.status).toBe(200);

    const restored = await Document.findById(doc._id);
    expect(restored.deletedAt).toBeNull();
    expect(restored.deletedBy).toBeUndefined();

    const list = await request(app).get('/api/documents').set(authHeader(token));
    expect(list.body.data).toHaveLength(1);

    const log = await AuditLog.findOne({ action: 'RESTORE', resource: 'document', resourceId: doc._id });
    expect(log).toBeTruthy();
  });

  it('refuses to restore a document that was never deleted', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await makeDoc(municipalityId, user._id);
    const res = await request(app).patch(`/api/documents/${doc._id}/restore`).set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it('refuses to restore another municipality document', async () => {
    const { user: foreignUser, municipalityId: foreignMunId } = await createUser({ role: 'municipal_admin' });
    const { token } = await createUser({ role: 'municipal_admin' });
    const foreign = await makeDoc(foreignMunId, foreignUser._id, { deletedAt: new Date() });

    const res = await request(app).patch(`/api/documents/${foreign._id}/restore`).set(authHeader(token));
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/documents/:id/permanent', () => {
  it('destroys the record and the stored file, including old versions', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await makeDoc(municipalityId, user._id, {
      deletedAt: new Date(),
      previousVersions: [{ version: 1, fileName: 'skims/documents/old-file-id', fileUrl: 'x', uploadedAt: new Date() }],
    });

    const res = await request(app).delete(`/api/documents/${doc._id}/permanent`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(await Document.findById(doc._id)).toBeNull();

    // Both the current file and the superseded one, or Cloudinary keeps orphans for ever.
    const destroyed = destroyQuietly.mock.calls.map((c) => c[0]);
    expect(destroyed).toContain('skims/documents/file-id');
    expect(destroyed).toContain('skims/documents/old-file-id');
  });

  it('refuses to permanently delete a document that is not in the recycle bin', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await makeDoc(municipalityId, user._id);

    const res = await request(app).delete(`/api/documents/${doc._id}/permanent`).set(authHeader(token));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/recycle bin/i);
    expect(await Document.findById(doc._id)).toBeTruthy();
    expect(destroyQuietly).not.toHaveBeenCalled();
  });

  it('audits the destruction before the record disappears', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await makeDoc(municipalityId, user._id, { deletedAt: new Date() });

    await request(app).delete(`/api/documents/${doc._id}/permanent`).set(authHeader(token));

    // Afterwards this entry is the only remaining trace that the document existed.
    const log = await AuditLog.findOne({ action: 'PERMANENT_DELETE', resource: 'document', resourceId: doc._id });
    expect(log).toBeTruthy();
    expect(log.oldValues).toMatchObject({ title: 'Resolution 12', originalName: 'resolution-12.pdf' });
    expect(log.details.irreversible).toBe(true);
  });

  it('is closed to non-admin roles', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token } = await createUser({ role: 'sk_secretary', municipality: municipalityId });
    const doc = await makeDoc(municipalityId, user._id, { deletedAt: new Date() });

    const res = await request(app).delete(`/api/documents/${doc._id}/permanent`).set(authHeader(token));
    expect(res.status).toBe(403);
    expect(await Document.findById(doc._id)).toBeTruthy();
  });
});
