const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, authHeader } = require('./helpers');
const Document = require('../models/Document');
// Exported off the model, as in routes/documents.js.
const { DOCUMENT_CATEGORIES } = Document;

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const createDoc = async (municipalityId, uploadedBy, overrides = {}) =>
  Document.create({
    title: 'Test Resolution',
    category: 'resolution',
    fileName: 'skims/documents/test-file-id',
    originalName: 'test-resolution.pdf',
    fileUrl: 'https://res.cloudinary.com/test/raw/upload/skims/documents/test-file-id',
    fileType: 'application/pdf',
    fileSize: 12345,
    municipality: municipalityId,
    uploadedBy,
    ...overrides,
  });

describe('GET /api/documents', () => {
  it('returns documents scoped to own municipality', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { user: otherUser, municipalityId: otherMunId } = await createUser({ role: 'municipal_admin' });
    await createDoc(municipalityId, user._id);
    await createDoc(otherMunId, otherUser._id);

    const res = await request(app).get('/api/documents').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/documents/:id', () => {
  it('returns a document by ID', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, user._id);

    const res = await request(app).get(`/api/documents/${doc._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(doc._id.toString());
  });

  it('returns 404 for non-existent document', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).get('/api/documents/000000000000000000000000').set(authHeader(token));
    expect(res.status).toBe(404);
  });

  it('blocks cross-municipality access', async () => {
    const { user: owner, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: otherToken } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, owner._id);

    const res = await request(app).get(`/api/documents/${doc._id}`).set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/documents/:id', () => {
  it('updates a document title', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, user._id);

    const res = await request(app)
      .put(`/api/documents/${doc._id}`)
      .set(authHeader(token))
      .send({ title: 'Updated Resolution Title' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated Resolution Title');
  });

  it('returns 403 for cross-municipality update', async () => {
    const { user: owner, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: otherToken } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, owner._id);

    const res = await request(app)
      .put(`/api/documents/${doc._id}`)
      .set(authHeader(otherToken))
      .send({ title: 'Hacked Title' });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/documents/:id/archive', () => {
  it('archives a document', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, user._id);

    const res = await request(app)
      .patch(`/api/documents/${doc._id}/archive`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.isArchived).toBe(true);
  });

  it('returns 403 for cross-municipality archive attempt', async () => {
    const { user: owner, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: otherToken } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, owner._id);

    const res = await request(app)
      .patch(`/api/documents/${doc._id}/archive`)
      .set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/documents/:id/unarchive', () => {
  it('restores an archived document', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, user._id, { isArchived: true });

    const res = await request(app)
      .patch(`/api/documents/${doc._id}/unarchive`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data.isArchived).toBe(false);
  });
});

describe('POST /api/documents/:id/download', () => {
  it('tracks download and returns fileUrl for a public document (no auth)', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, user._id, { isPublic: true });

    const res = await request(app).post(`/api/documents/${doc._id}/download`);
    expect(res.status).toBe(200);
    expect(res.body.data.fileUrl).toBe(doc.fileUrl);
  });

  it('returns 403 for cross-municipality private document', async () => {
    const { user: owner, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: otherToken } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, owner._id, { isPublic: false });

    const res = await request(app)
      .post(`/api/documents/${doc._id}/download`)
      .set(authHeader(otherToken));
    expect(res.status).toBe(403);
  });

  it('returns 401 for private document without auth', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, user._id, { isPublic: false });

    const res = await request(app).post(`/api/documents/${doc._id}/download`);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/documents/:id', () => {
  it('admin can soft-delete a document', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, user._id);

    const res = await request(app).delete(`/api/documents/${doc._id}`).set(authHeader(token));
    expect(res.status).toBe(200);
    const deleted = await Document.findById(doc._id);
    expect(deleted.deletedAt).not.toBeNull();
  });

  it('returns 403 for sk_chairperson (not in ADMINS)', async () => {
    const { user: owner, municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token: chairToken } = await createUser({ role: 'sk_chairperson', municipality: municipalityId });
    const doc = await createDoc(municipalityId, owner._id);

    const res = await request(app).delete(`/api/documents/${doc._id}`).set(authHeader(chairToken));
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent document', async () => {
    const { token } = await createUser({ role: 'municipal_admin' });
    const res = await request(app).delete('/api/documents/000000000000000000000000').set(authHeader(token));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/documents/stats', () => {
  it('returns byCategory and recent document stats', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    await createDoc(municipalityId, user._id);
    await createDoc(municipalityId, user._id, { category: 'minutes' });

    const res = await request(app).get('/api/documents/stats').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.byCategory)).toBe(true);
    expect(Array.isArray(res.body.data.recent)).toBe(true);
  });
});

describe('document categories', () => {
  /*
   * The suggested list, not an enum — `category` is free text on the schema. "Other" was dropped
   * because the control offering it is a type-or-pick combobox: a filer who means "Barangay
   * Assembly" should record that, not a placeholder that erases it.
   */
  it('suggests no "other" category', () => {
    expect(DOCUMENT_CATEGORIES).not.toContain('other');
  });

  it('accepts a category the list does not name', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await createDoc(municipalityId, user._id, { category: 'barangay_assembly_minutes' });
    expect(doc.category).toBe('barangay_assembly_minutes');
  });

  /*
   * Removing the suggestion must not orphan what is already filed under it. Documents stored as
   * `other` predate the change, and the filter is free text on the same canonical form, so typing
   * "Other" still finds them.
   */
  it('still filters documents already stored as "other"', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'municipal_admin' });
    await createDoc(municipalityId, user._id, { category: 'other' });
    await createDoc(municipalityId, user._id, { category: 'minutes' });

    const res = await request(app).get('/api/documents?category=Other').set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].category).toBe('other');
  });
});
