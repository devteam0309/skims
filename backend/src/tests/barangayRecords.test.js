/**
 * Barangay records, October 2026 panel round (items 1.4, 2.x, 3.1, 4.x, 7.1).
 *
 * The cast: Barangay Agot, Boac has a chairperson, a treasurer and a secretary who must read ONE
 * set of records; Barangay Maligaya, Boac has a chairperson who must read none of Agot's; Boac's
 * municipal administrator reads both; Gasan's administrator reads neither.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createMunicipality, createBarangay, createProgram, authHeader, PDF } = require('./helpers');
const Document = require('../models/Document');
const Announcement = require('../models/Announcement');
const Program = require('../models/Program');
const User = require('../models/User');
const { _memoryFiles } = require('../services/fileStorage');

jest.mock('../services/emailService', () => new Proxy({}, { get: () => jest.fn().mockResolvedValue({}) }));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const world = async () => {
  const boac = await createMunicipality({ name: 'Boac', code: 'BOA' });
  const gasan = await createMunicipality({ name: 'Gasan', code: 'GAS' });
  const agot = await createBarangay(boac._id, { name: 'Agot' });
  const maligaya = await createBarangay(boac._id, { name: 'Maligaya' });
  const make = (role, municipality, barangay) => createUser({ role, municipality, ...(barangay ? { barangay } : {}) });
  return {
    boac, gasan, agot, maligaya,
    admin: await make('municipal_admin', boac._id),
    chair: await make('sk_chairperson', boac._id, agot._id),
    treasurer: await make('sk_treasurer', boac._id, agot._id),
    secretary: await make('sk_secretary', boac._id, agot._id),
    maligayaChair: await make('sk_chairperson', boac._id, maligaya._id),
    gasanAdmin: await make('municipal_admin', gasan._id),
    superAdmin: await createUser({ role: 'super_admin', municipality: null }),
    dilg: await createUser({ role: 'dilg_representative', municipality: null }),
    provincial: await createUser({ role: 'provincial_admin', municipality: null }),
  };
};

const upload = (token, fields = {}, filename = 'resolution.pdf') => {
  let req = request(app).post('/api/documents').set(authHeader(token));
  for (const [k, v] of Object.entries({ category: 'resolution', ...fields })) req = req.field(k, String(v));
  return req.attach('file', PDF, { filename, contentType: 'application/pdf' });
};

describe('one barangay, one repository (1.4, 4.1, 4.2)', () => {
  it('files the treasurer\'s upload under Agot, where the chairperson and secretary read it', async () => {
    const w = await world();
    const res = await upload(w.treasurer.token, { title: 'Disbursement voucher DV-001', category: 'disbursement_voucher' });
    expect(res.status).toBe(201);
    expect(res.body.data.barangay.toString()).toBe(w.agot._id.toString());
    // The file is private: no URL comes back, and the stored file is not a public asset.
    expect(res.body.data.fileUrl).toBeUndefined();
    expect(res.body.data.storageType).toBe('memory');

    for (const officer of [w.chair, w.secretary, w.treasurer, w.admin]) {
      const list = await request(app).get('/api/documents').set(authHeader(officer.token));
      expect(list.body.data.map((d) => d.title)).toContain('Disbursement voucher DV-001');
    }
    const preview = await request(app).get(`/api/documents/${res.body.data._id}/serve?inline=1`).set(authHeader(w.chair.token));
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toMatch(/application\/pdf/);
    expect(Buffer.compare(preview.body, PDF)).toBe(0);
  });

  it('keeps Agot\'s documents from Maligaya and from another municipality — in lists, by id, and as files', async () => {
    const w = await world();
    const { body: { data: doc } } = await upload(w.treasurer.token, { title: 'Agot voucher' });

    for (const outsider of [w.maligayaChair, w.gasanAdmin]) {
      const list = await request(app).get('/api/documents').set(authHeader(outsider.token));
      expect(list.body.data.map((d) => d.title)).not.toContain('Agot voucher');
      expect((await request(app).get(`/api/documents/${doc._id}`).set(authHeader(outsider.token))).status).toBe(403);
      expect((await request(app).get(`/api/documents/${doc._id}/serve`).set(authHeader(outsider.token))).status).toBe(403);
      expect((await request(app).post(`/api/documents/${doc._id}/download`).set(authHeader(outsider.token))).status).toBe(403);
    }
  });

  it('ignores ?barangay= pointing at another barangay, and refuses an upload filed into one', async () => {
    const w = await world();
    await upload(w.treasurer.token, { title: 'Agot voucher' });

    const probe = await request(app).get(`/api/documents?barangay=${w.agot._id}`).set(authHeader(w.maligayaChair.token));
    expect(probe.body.data.map((d) => d.title)).not.toContain('Agot voucher');

    const tampered = await upload(w.maligayaChair.token, { title: 'Planted', barangay: w.agot._id });
    expect(tampered.status).toBe(403);
    expect(await Document.countDocuments({ title: 'Planted' })).toBe(0);
  });

  it('lets the municipal administrator narrow to one barangay', async () => {
    const w = await world();
    await upload(w.treasurer.token, { title: 'Agot voucher' });
    await upload(w.maligayaChair.token, { title: 'Maligaya minutes' });
    const res = await request(app).get(`/api/documents?barangay=${w.maligaya._id}`).set(authHeader(w.admin.token));
    expect(res.body.data.map((d) => d.title)).toEqual(['Maligaya minutes']);
  });

  it('keeps a replaced file downloadable as a previous version', async () => {
    const w = await world();
    const { body: { data: doc } } = await upload(w.chair.token, { title: 'Minutes' }, 'minutes-v1.pdf');
    const replaced = await request(app).patch(`/api/documents/${doc._id}/replace-file`).set(authHeader(w.chair.token))
      .attach('file', Buffer.from('%PDF-1.4 version two'), { filename: 'minutes-v2.pdf', contentType: 'application/pdf' });
    expect(replaced.status).toBe(200);
    const v1 = await request(app).get(`/api/documents/${doc._id}/versions/1/serve`).set(authHeader(w.secretary.token));
    expect(v1.status).toBe(200);
    expect(Buffer.compare(v1.body, PDF)).toBe(0);
  });

  it('serves nothing private to a youth account or a deactivated account\'s still-valid token', async () => {
    const w = await world();
    const { body: { data: doc } } = await upload(w.chair.token, { title: 'Private minutes' });
    const youth = await createUser({ role: 'youth', municipality: w.boac._id });
    expect((await request(app).get(`/api/documents/${doc._id}/serve`).set(authHeader(youth.token))).status).toBe(401);

    await User.updateOne({ _id: w.secretary.user._id }, { isActive: false });
    expect((await request(app).get(`/api/documents/${doc._id}/serve`).set(authHeader(w.secretary.token))).status).toBe(401);
  });
});

describe('document recycle bin (4.3)', () => {
  it('moves a document to the bin, shows it to its own barangay only, and restores it intact', async () => {
    const w = await world();
    const { body: { data: doc } } = await upload(w.treasurer.token, { title: 'Agot receipt' });

    const del = await request(app).delete(`/api/documents/${doc._id}`).set(authHeader(w.treasurer.token));
    expect(del.status).toBe(200);
    expect((await request(app).get('/api/documents').set(authHeader(w.chair.token))).body.data).toHaveLength(0);

    const chairBin = await request(app).get('/api/documents/recycle-bin').set(authHeader(w.chair.token));
    expect(chairBin.status).toBe(200);
    expect(chairBin.body.data.map((d) => d.title)).toEqual(['Agot receipt']);
    expect(chairBin.body.data[0].canRestore).toBe(true);
    expect(chairBin.body.data[0].canPermanentlyDelete).toBe(false);

    const maligayaBin = await request(app).get('/api/documents/recycle-bin').set(authHeader(w.maligayaChair.token));
    expect(maligayaBin.body.data).toHaveLength(0);
    expect((await request(app).patch(`/api/documents/${doc._id}/restore`).set(authHeader(w.maligayaChair.token))).status).toBe(403);

    const restored = await request(app).patch(`/api/documents/${doc._id}/restore`).set(authHeader(w.chair.token));
    expect(restored.status).toBe(200);
    const back = await Document.findById(doc._id);
    expect(back.deletedAt).toBeNull();
    expect(back.barangay.toString()).toBe(w.agot._id.toString());
    expect(back.uploadedBy.toString()).toBe(w.treasurer.user._id.toString());
  });

  it('lets a treasurer remove only what they uploaded; editors remove any of their barangay\'s', async () => {
    const w = await world();
    const { body: { data: chairs } } = await upload(w.chair.token, { title: 'Chair resolution' });
    expect((await request(app).delete(`/api/documents/${chairs._id}`).set(authHeader(w.treasurer.token))).status).toBe(403);
    expect((await request(app).delete(`/api/documents/${chairs._id}`).set(authHeader(w.secretary.token))).status).toBe(200);
  });

  it('keeps permanent deletion for administrators, and destroys the stored file with it', async () => {
    const w = await world();
    const { body: { data: doc } } = await upload(w.chair.token, { title: 'To destroy' });
    const stored = await Document.findById(doc._id);
    await request(app).delete(`/api/documents/${doc._id}`).set(authHeader(w.chair.token));

    expect((await request(app).delete(`/api/documents/${doc._id}/permanent`).set(authHeader(w.chair.token))).status).toBe(403);
    expect((await request(app).delete(`/api/documents/${doc._id}/permanent`).set(authHeader(w.gasanAdmin.token))).status).toBe(403);
    const gone = await request(app).delete(`/api/documents/${doc._id}/permanent`).set(authHeader(w.admin.token));
    expect(gone.status).toBe(200);
    expect(await Document.findById(doc._id)).toBeNull();
    expect(_memoryFiles.has(stored.fileName)).toBe(false);
  });

  it('does not let a barangay officer bin a municipality-level document', async () => {
    const w = await world();
    const { body: { data: circular } } = await upload(w.admin.token, { title: 'Municipal circular' });
    expect(circular.barangay).toBeFalsy();
    // Readable by every barangay...
    expect((await request(app).get(`/api/documents/${circular._id}`).set(authHeader(w.chair.token))).status).toBe(200);
    // ...but not theirs to remove.
    expect((await request(app).delete(`/api/documents/${circular._id}`).set(authHeader(w.chair.token))).status).toBe(403);
  });
});

describe('announcements: ownership and authority (2.2)', () => {
  const announce = (token, body = {}) => request(app).post('/api/announcements').set(authHeader(token))
    .send({ title: 'Notice', content: 'Full text of the notice.\n\nSecond paragraph.', ...body });

  it('keeps a DILG announcement read-only to every lower office', async () => {
    const w = await world();
    const ann = await Announcement.create({
      title: 'DILG Compliance Deadline Reminder', content: 'Submit the Q3 compliance report by 15 November.',
      author: w.dilg.user._id, authorRole: 'dilg_representative', issuingOffice: 'DILG Marinduque', isPublic: true,
    });

    for (const officer of [w.chair, w.secretary, w.admin]) {
      const edit = await request(app).put(`/api/announcements/${ann._id}`).set(authHeader(officer.token)).send({ title: 'Changed' });
      expect(edit.status).toBe(403);
    }
    // An equal authority cannot either; the break-glass account can.
    expect((await request(app).put(`/api/announcements/${ann._id}`).set(authHeader(w.provincial.token)).send({ title: 'Changed' })).status).toBe(403);
    expect((await request(app).put(`/api/announcements/${ann._id}`).set(authHeader(w.superAdmin.token)).send({ title: 'Corrected' })).status).toBe(200);
    expect((await request(app).delete(`/api/announcements/${ann._id}`).set(authHeader(w.admin.token))).status).toBe(403);

    const list = await request(app).get('/api/announcements').set(authHeader(w.chair.token));
    const row = list.body.data.find((a) => a._id === ann._id.toString());
    expect(row).toMatchObject({ canEdit: false, canDelete: false, issuingOffice: 'DILG Marinduque' });
    expect(row.content).toBe('Submit the Q3 compliance report by 15 November.');
  });

  it('lets an author edit their own, keeps peers out, and lets the municipal office manage it', async () => {
    const w = await world();
    const created = await announce(w.chair.token, { title: 'Agot clean-up' });
    expect(created.status).toBe(201);
    expect(created.body.data.issuingOffice).toBe('Sangguniang Kabataan — Barangay Agot, Boac');
    const id = created.body.data._id;

    expect((await request(app).put(`/api/announcements/${id}`).set(authHeader(w.chair.token)).send({ title: 'Agot clean-up (moved)' })).status).toBe(200);
    expect((await request(app).put(`/api/announcements/${id}`).set(authHeader(w.maligayaChair.token)).send({ title: 'x' })).status).toBe(403);
    expect((await request(app).put(`/api/announcements/${id}`).set(authHeader(w.secretary.token)).send({ title: 'x' })).status).toBe(403);
    expect((await request(app).put(`/api/announcements/${id}`).set(authHeader(w.admin.token)).send({ title: 'Agot clean-up (approved)' })).status).toBe(200);
    expect((await request(app).put(`/api/announcements/${id}`).set(authHeader(w.gasanAdmin.token)).send({ title: 'x' })).status).toBe(403);

    const one = await request(app).get(`/api/announcements/${id}`).set(authHeader(w.chair.token));
    expect(one.body.data).toMatchObject({ canEdit: true, title: 'Agot clean-up (approved)' });
  });

  it('protects older announcements by the author\'s role when no authority was recorded', async () => {
    const w = await world();
    const legacy = await Announcement.create({ title: 'Old provincial notice', content: 'x', author: w.provincial.user._id });
    expect((await request(app).put(`/api/announcements/${legacy._id}`).set(authHeader(w.chair.token)).send({ title: 'x' })).status).toBe(403);
  });
});

describe('programme implementation date (3.1)', () => {
  const PROGRAM = (extra = {}) => ({
    title: 'Agot Coastal Clean-Up', description: 'Quarterly coastal clean-up with volunteers.', category: 'environment',
    startDate: '2026-11-01', endDate: '2026-11-20', targetParticipants: 40, ...extra,
  });

  it('stores the implementation date apart from the preparation period and returns it', async () => {
    const w = await world();
    const res = await request(app).post('/api/programs').set(authHeader(w.chair.token)).send(PROGRAM({ implementationDate: '2026-11-28' }));
    expect(res.status).toBe(201);
    const p = await Program.findById(res.body.data._id);
    expect(p.startDate.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(p.endDate.toISOString().slice(0, 10)).toBe('2026-11-20');
    expect(p.implementationDate.toISOString().slice(0, 10)).toBe('2026-11-28');
    expect(p.barangay.toString()).toBe(w.agot._id.toString());
  });

  it('is never derived from the other dates when left out', async () => {
    const w = await world();
    const res = await request(app).post('/api/programs').set(authHeader(w.chair.token)).send(PROGRAM());
    expect(res.status).toBe(201);
    expect((await Program.findById(res.body.data._id)).implementationDate).toBeNull();
  });

  it('refuses an implementation date before the preparation period opens', async () => {
    const w = await world();
    const res = await request(app).post('/api/programs').set(authHeader(w.chair.token)).send(PROGRAM({ implementationDate: '2026-10-15' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/implementation date/i);
  });

  it('will not mark a programme completed until the implementation date is recorded', async () => {
    const w = await world();
    const { body: { data: p } } = await request(app).post('/api/programs').set(authHeader(w.chair.token)).send(PROGRAM());
    const early = await request(app).patch(`/api/programs/${p._id}/status`).set(authHeader(w.chair.token)).send({ status: 'completed' });
    expect(early.status).toBe(400);

    await request(app).put(`/api/programs/${p._id}`).set(authHeader(w.chair.token)).send({ implementationDate: '2026-11-25' });
    const done = await request(app).patch(`/api/programs/${p._id}/status`).set(authHeader(w.chair.token)).send({ status: 'completed' });
    expect(done.status).toBe(200);
  });
});

describe('programmes organised by barangay for the municipal administrator (7.1)', () => {
  const seedPrograms = async (w) => {
    await createProgram(w.boac._id, w.chair.user._id, { title: 'Agot Sports Fest', barangay: w.agot._id, status: 'ongoing' });
    await createProgram(w.boac._id, w.chair.user._id, { title: 'Agot Reading Hour', barangay: w.agot._id, status: 'planned' });
    await createProgram(w.boac._id, w.maligayaChair.user._id, { title: 'Maligaya Tree Planting', barangay: w.maligaya._id, status: 'completed', implementationDate: new Date('2026-06-01') });
    await createProgram(w.boac._id, w.admin.user._id, { title: 'Boac Youth Summit' });
    await createProgram(w.gasan._id, w.gasanAdmin.user._id, { title: 'Gasan programme' });
  };

  it('groups every barangay of the municipality with counts, plus the municipality-wide bucket', async () => {
    const w = await world();
    await seedPrograms(w);
    const res = await request(app).get('/api/programs/barangay-summary').set(authHeader(w.admin.token));
    expect(res.status).toBe(200);
    const rows = Object.fromEntries(res.body.data.barangays.map((r) => [r.barangay.name, r]));
    expect(rows.Agot).toMatchObject({ total: 2, ongoing: 1, planned: 1 });
    expect(rows.Maligaya).toMatchObject({ total: 1, completed: 1 });
    expect(res.body.data.municipalityWide.total).toBe(1);
    expect(res.body.data.totals).toBe(4);
  });

  it('gives a barangay officer only their own row', async () => {
    const w = await world();
    await seedPrograms(w);
    const res = await request(app).get('/api/programs/barangay-summary').set(authHeader(w.maligayaChair.token));
    expect(res.body.data.barangays.map((r) => r.barangay.name)).toEqual(['Maligaya']);
  });

  it('filters by barangay, finds a barangay by name, and sorts by it', async () => {
    const w = await world();
    await seedPrograms(w);
    const one = await request(app).get(`/api/programs?barangay=${w.agot._id}`).set(authHeader(w.admin.token));
    expect(one.body.data.map((p) => p.title).sort()).toEqual(['Agot Reading Hour', 'Agot Sports Fest']);

    const found = await request(app).get('/api/programs?search=maliga').set(authHeader(w.admin.token));
    expect(found.body.data.map((p) => p.title)).toEqual(['Maligaya Tree Planting']);

    const wide = await request(app).get('/api/programs?barangay=none').set(authHeader(w.admin.token));
    expect(wide.body.data.map((p) => p.title)).toEqual(['Boac Youth Summit']);

    const sorted = await request(app).get('/api/programs?sort=barangay&limit=10').set(authHeader(w.admin.token));
    expect(sorted.body.data.map((p) => p.barangay?.name || null)).toEqual(['Agot', 'Agot', 'Maligaya', null]);
    expect(sorted.body.meta.total).toBe(4);
  });

  it('lets a barangay officer edit their barangay\'s programmes but not the municipal one', async () => {
    const w = await world();
    await seedPrograms(w);
    const summit = await Program.findOne({ title: 'Boac Youth Summit' });
    const sports = await Program.findOne({ title: 'Agot Sports Fest' });
    expect((await request(app).put(`/api/programs/${summit._id}`).set(authHeader(w.chair.token)).send({ title: 'Hijacked' })).status).toBe(403);
    expect((await request(app).put(`/api/programs/${sports._id}`).set(authHeader(w.secretary.token)).send({ title: 'Agot Sports Festival' })).status).toBe(200);
    expect((await request(app).put(`/api/programs/${sports._id}`).set(authHeader(w.maligayaChair.token)).send({ title: 'x' })).status).toBe(403);
  });
});
