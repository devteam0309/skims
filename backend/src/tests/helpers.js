const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Municipality = require('../models/Municipality');
const Budget = require('../models/Budget');
const Program = require('../models/Program');
const Barangay = require('../models/Barangay');

const createMunicipality = async (overrides = {}) => {
  return Municipality.create({
    name: `Municipality ${Math.random().toString(36).slice(2, 8)}`,
    code: Math.random().toString(36).slice(2, 8).toUpperCase(),
    ...overrides,
  });
};

const createUser = async (overrides = {}) => {
  const municipality = overrides.municipality || (await createMunicipality())._id;
  const user = await User.create({
    firstName: 'Test',
    lastName: 'User',
    email: `user-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'Test@1234',
    role: 'municipal_admin',
    isEmailVerified: true,
    isActive: true,
    isApproved: true,
    municipality,
    ...overrides,
    // municipality override after spread so it wins if explicitly passed
  });
  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET || 'skims-test-secret-key-for-testing-only',
    { expiresIn: '1h' }
  );
  return { user, token, municipalityId: municipality };
};

const createBudget = async (municipalityId, createdBy, overrides = {}) => {
  return Budget.create({
    title: 'Test Budget',
    fiscalYear: 2026,
    municipality: municipalityId,
    totalBudget: 500000,
    approvedAmount: 500000,
    disbursedAmount: 0,
    remainingBalance: 500000,
    status: 'approved',
    approvedBy: createdBy,
    approvedAt: new Date(),
    createdBy,
    ...overrides,
  });
};

const createProgram = async (municipalityId, createdBy, overrides = {}) => {
  return Program.create({
    title: 'Test Program',
    description: 'A test program for unit testing purposes',
    category: 'education',
    municipality: municipalityId,
    budget: 100000,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    targetParticipants: 50,
    createdBy,
    ...overrides,
  });
};

/**
 * A barangay in the given municipality. Named uniquely because Barangay has a compound unique index
 * on (name, municipality), which a fixed name would violate on the second call in a suite.
 */
const createBarangay = async (municipalityId, overrides = {}) => {
  return Barangay.create({
    name: `Barangay ${Math.random().toString(36).slice(2, 8)}`,
    municipality: municipalityId,
    ...overrides,
  });
};

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

/** A small, valid-looking PDF body for upload tests. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF');

/**
 * POST /api/auth/register as multipart, the way the register form sends it: every non-youth
 * applicant must attach identity or residency proof (October 2026). `documents` is a list of
 * [documentType, filename]; pass [] to register with none.
 */
const registerApplicant = (app, fields, { documents = [['government_id', 'government-id.pdf']] } = {}) => {
  // Required lazily so suites that never register do not load supertest twice.
  // eslint-disable-next-line global-require
  let req = require('supertest')(app).post('/api/auth/register');
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) req = req.field(key, String(value));
  }
  for (const [type, filename] of documents) {
    req = req.field('documentTypes', type)
      .attach('verificationDocuments', PDF, { filename, contentType: 'application/pdf' });
  }
  return req;
};

/** Attach `count` receipts to a supertest multipart request. */
const withReceipts = (req, count = 1, type = 'official_receipt') => {
  let r = req;
  for (let i = 0; i < count; i += 1) {
    r = r.field('documentTypes', type).attach('attachments', PDF, { filename: `receipt-${i + 1}.pdf`, contentType: 'application/pdf' });
  }
  return r;
};

/**
 * Send what used to be a JSON body as multipart, with receipts attached — the shape the expense form
 * posts. Nested objects (vendor) become `vendor[name]` fields, which multer reads back as objects.
 */
const multipart = (test, payload = {}, { receipts = 1, field = 'attachments' } = {}) => {
  let t = test;
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((v) => { t = t.field(key, String(v)); });
    else if (typeof value === 'object') Object.entries(value).forEach(([k, v]) => { t = t.field(`${key}[${k}]`, String(v)); });
    else t = t.field(key, String(value));
  }
  for (let i = 0; i < receipts; i += 1) {
    t = t.field('documentTypes', 'official_receipt').attach(field, PDF, { filename: `receipt-${i + 1}.pdf`, contentType: 'application/pdf' });
  }
  return t;
};

/**
 * A pending expense straight in the database, with proof attached — for approval tests that are
 * about the decision rather than about how the record was filed.
 */
const createExpenseRecord = async (overrides = {}) => {
  // eslint-disable-next-line global-require
  const Expense = require('../models/Expense');
  return new Expense({
    type: 'official_receipt',
    title: 'Test expense',
    amount: 1000,
    transactionDate: new Date('2026-03-01'),
    status: 'pending',
    attachments: [{ documentType: 'official_receipt', originalName: 'receipt.pdf', fileType: 'application/pdf', storageType: 'memory', publicId: 'test/receipt.pdf' }],
    ...overrides,
  }).save();
};

module.exports = {
  createUser, createMunicipality, createBarangay, createBudget, createProgram, authHeader,
  PDF, registerApplicant, withReceipts, multipart, createExpenseRecord,
};
