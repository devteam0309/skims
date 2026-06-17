const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBudget, createProgram } = require('./helpers');
const Announcement = require('../models/Announcement');
const Document = require('../models/Document');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

describe('GET /api/public/programs', () => {
  it('returns public programs without auth', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    await createProgram(municipalityId, user._id, { isPublic: true });

    const res = await request(app).get('/api/public/programs');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('does not return private programs', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    await createProgram(municipalityId, user._id, { isPublic: false });

    const res = await request(app).get('/api/public/programs');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/public/announcements', () => {
  it('returns public announcements without auth', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    await Announcement.create({
      title: 'Public Notice',
      content: 'This is a public announcement.',
      municipality: municipalityId,
      author: user._id,
      isPublic: true,
    });

    const res = await request(app).get('/api/public/announcements');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('does not return private announcements', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    await Announcement.create({
      title: 'Internal Only',
      content: 'Not for public.',
      municipality: municipalityId,
      author: user._id,
      isPublic: false,
    });

    const res = await request(app).get('/api/public/announcements');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('GET /api/public/budget', () => {
  it('returns aggregated approved budget summary', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    await createBudget(municipalityId, user._id, { status: 'approved' });

    const res = await request(app).get('/api/public/budget');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/public/documents', () => {
  it('returns only public non-archived documents', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    await Document.create({
      title: 'Public Doc',
      category: 'resolution',
      fileName: 'public-doc-id',
      originalName: 'public.pdf',
      fileUrl: 'https://res.cloudinary.com/test/raw/upload/public-doc-id',
      fileType: 'application/pdf',
      municipality: municipalityId,
      uploadedBy: user._id,
      isPublic: true,
      isArchived: false,
    });
    await Document.create({
      title: 'Private Doc',
      category: 'minutes',
      fileName: 'private-doc-id',
      originalName: 'private.pdf',
      fileUrl: 'https://res.cloudinary.com/test/raw/upload/private-doc-id',
      fileType: 'application/pdf',
      municipality: municipalityId,
      uploadedBy: user._id,
      isPublic: false,
    });

    const res = await request(app).get('/api/public/documents');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Public Doc');
  });
});

describe('GET /api/public/documents/:id/download', () => {
  it('redirects to file URL for a public document', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await Document.create({
      title: 'Downloadable Doc',
      category: 'resolution',
      fileName: 'dl-doc-id',
      originalName: 'dl.pdf',
      fileUrl: 'https://res.cloudinary.com/test/raw/upload/dl-doc-id',
      fileType: 'application/pdf',
      municipality: municipalityId,
      uploadedBy: user._id,
      isPublic: true,
    });

    const res = await request(app).get(`/api/public/documents/${doc._id}/download`);
    expect(res.status).toBe(302);
    expect(res.header.location).toBe(doc.fileUrl);
  });

  it('returns 404 for a non-public or non-existent document', async () => {
    const { user, municipalityId } = await createUser({ role: 'municipal_admin' });
    const doc = await Document.create({
      title: 'Private',
      category: 'resolution',
      fileName: 'private-dl-id',
      originalName: 'priv.pdf',
      fileUrl: 'https://res.cloudinary.com/test/raw/upload/private-dl-id',
      fileType: 'application/pdf',
      municipality: municipalityId,
      uploadedBy: user._id,
      isPublic: false,
    });

    const res = await request(app).get(`/api/public/documents/${doc._id}/download`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/public/municipalities', () => {
  it('returns active municipalities without auth', async () => {
    await createUser({ role: 'municipal_admin' }); // creates a municipality as side effect
    const res = await request(app).get('/api/public/municipalities');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/public/stats', () => {
  it('returns public program counts and municipality counts', async () => {
    const { user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    await createProgram(municipalityId, user._id, { isPublic: true, status: 'completed' });

    const res = await request(app).get('/api/public/stats');
    expect(res.status).toBe(200);
    expect(typeof res.body.data.totalPrograms).toBe('number');
    expect(typeof res.body.data.completedPrograms).toBe('number');
    expect(typeof res.body.data.totalMunicipalities).toBe('number');
  });
});
