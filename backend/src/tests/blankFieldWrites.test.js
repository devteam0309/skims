/*
 * The blank-string cast failure, swept across the modules that were never audited for it.
 *
 * Forms submit their whole shape, so any optional ObjectId, Date or Number field arrives as `''`
 * when the user leaves it alone. Mongoose cannot cast that, throws a CastError, and the write
 * fails outright — which is exactly how the Programs module came to be unusable for a whole panel
 * round. Programs and youth are fixed; these four were flagged as sharing the shape.
 *
 * Every case here posts the payload a real form produces, not a minimal one.
 */
const request = require('supertest');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBudget, createProgram, authHeader } = require('./helpers');
const Announcement = require('../models/Announcement');
const Expense = require('../models/Expense');

jest.mock('../services/emailService', () => new Proxy({}, {
  get: () => jest.fn().mockResolvedValue({}),
}));

jest.mock('../config/cloudinary', () => ({
  uploadToCloudinary: jest.fn().mockResolvedValue({
    public_id: 'skims/documents/test', secure_url: 'https://example.test/doc.pdf', bytes: 1024,
  }),
  destroyQuietly: jest.fn().mockResolvedValue({}),
  cloudinary: { uploader: { destroy: jest.fn() } },
}));

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

describe('announcements: blank optional fields', () => {
  /*
   * The likeliest of the four to bite in real use: the form reveals eventDate and eventLocation
   * only for type "event", so every non-event announcement submits a blank eventDate.
   */
  it('creates a non-event announcement with blank event fields', async () => {
    const { token } = await createUser({ role: 'sk_secretary' });
    const res = await request(app).post('/api/announcements').set(authHeader(token)).send({
      title: 'Office closed on Monday',
      content: 'The SK office will be closed for the local holiday.',
      type: 'general',
      eventDate: '',
      eventLocation: '',
      expiresAt: '',
      isPublic: true,
    });

    expect(res.status).toBe(201);
    const stored = await Announcement.findById(res.body.data._id);
    expect(stored.eventDate).toBeFalsy();
  });

  it('updates an announcement with blank event fields', async () => {
    const { token } = await createUser({ role: 'sk_secretary' });
    const created = await request(app).post('/api/announcements').set(authHeader(token)).send({
      title: 'Assembly on Friday', content: 'Barangay youth assembly.', type: 'event',
      eventDate: '2026-10-10', eventLocation: 'Covered court',
    });
    expect(created.status).toBe(201);

    // Switching an event back to a general notice clears both event fields.
    const res = await request(app).put(`/api/announcements/${created.body.data._id}`)
      .set(authHeader(token)).send({
        title: 'Assembly postponed', content: 'The assembly is postponed.', type: 'general',
        eventDate: '', eventLocation: '', expiresAt: '',
      });

    expect(res.status).toBe(200);
    const stored = await Announcement.findById(created.body.data._id);
    expect(stored.eventDate).toBeFalsy();
    expect(stored.eventLocation).toBeFalsy();
  });
});

describe('expenses: blank optional references', () => {
  it('creates an expense with no programme or barangay linked', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const budget = await createBudget(municipalityId, user._id, { status: 'approved' });

    const res = await request(app).post('/api/expenses').set(authHeader(token))
      .field('type', 'purchase_request')
      .field('title', 'Office supplies for the SK secretariat')
      .field('description', 'Bond paper, ink and folders.')
      .field('amount', '5000')
      .field('budget', budget._id.toString())
      .field('program', '')
      .field('barangay', '')
      .field('transactionDate', '2026-03-10');

    expect(res.status).toBe(201);
    const stored = await Expense.findById(res.body.data._id);
    expect(stored.program).toBeFalsy();
  });

  // transactionDate is required, so a blank one leaves the stored value rather than clearing it.
  it('ignores a blank required date on update instead of failing the edit', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const budget = await createBudget(municipalityId, user._id, { status: 'approved' });
    const created = await request(app).post('/api/expenses').set(authHeader(token))
      .field('type', 'purchase_request')
      .field('title', 'Office supplies for the SK secretariat')
      .field('amount', '5000')
      .field('budget', budget._id.toString())
      .field('transactionDate', '2026-03-10');
    expect(created.status).toBe(201);

    const res = await request(app).put(`/api/expenses/${created.body.data._id}`)
      .set(authHeader(token))
      .send({ title: 'Office supplies (revised)', description: '', transactionDate: '' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Office supplies (revised)');

    const stored = await Expense.findById(created.body.data._id);
    expect(stored.transactionDate).toBeTruthy();          // kept, not wiped
    expect(stored.description).toBeFalsy();               // optional, so genuinely cleared
  });
});

describe('liquidations: blank optional fields', () => {
  /*
   * `program` is required on this model — a liquidation always liquidates something — so the
   * blank-handling here is about dueDate and remarks. Asserted separately below that a genuinely
   * missing programme is still refused rather than quietly dropped.
   */
  it('creates a liquidation with a blank due date and remarks', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const budget = await createBudget(municipalityId, user._id, { status: 'approved' });
    const program = await createProgram(municipalityId, user._id, { status: 'ongoing' });

    const res = await request(app).post('/api/liquidations').set(authHeader(token))
      .field('title', 'Liquidation for Q1 office expenses')
      .field('budget', budget._id.toString())
      .field('program', program._id.toString())
      .field('totalAmount', '5000')
      .field('liquidatedAmount', '5000')
      .field('dueDate', '')
      .field('remarks', '');

    expect(res.status).toBe(201);
  });

  it('still refuses a liquidation with no programme, rather than dropping the field', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_treasurer' });
    const budget = await createBudget(municipalityId, user._id, { status: 'approved' });

    const res = await request(app).post('/api/liquidations').set(authHeader(token))
      .field('title', 'Liquidation for Q1 office expenses')
      .field('budget', budget._id.toString())
      .field('program', '')
      .field('totalAmount', '5000');

    expect(res.status).toBe(400);
  });
});

describe('documents: blank optional references', () => {
  it('uploads a document with no programme or barangay linked', async () => {
    const { token } = await createUser({ role: 'sk_secretary' });

    const res = await request(app).post('/api/documents').set(authHeader(token))
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'minutes.pdf', contentType: 'application/pdf' })
      .field('title', 'SK Regular Session Minutes')
      .field('description', 'Minutes of the February regular session.')
      .field('category', 'minutes')
      .field('program', '')
      .field('barangay', '')
      .field('fiscalYear', '');

    expect(res.status).toBe(201);
  });

  it('updates a document with a blank fiscal year', async () => {
    const { token } = await createUser({ role: 'sk_secretary' });
    const created = await request(app).post('/api/documents').set(authHeader(token))
      .attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'minutes.pdf', contentType: 'application/pdf' })
      .field('title', 'SK Regular Session Minutes')
      .field('category', 'minutes');
    expect(created.status).toBe(201);

    const res = await request(app).put(`/api/documents/${created.body.data._id}`)
      .set(authHeader(token))
      .send({ title: 'SK Regular Session Minutes (final)', description: '', fiscalYear: '' });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('SK Regular Session Minutes (final)');
  });
});
