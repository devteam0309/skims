/**
 * Excel import for the Youth Registry.
 *
 * The rule the whole feature rests on: a spreadsheet is untrusted input. Every assertion here is
 * about what the import REFUSES — malformed files, missing columns, bad values, ages outside the SK
 * band, duplicates within the file and against the registry, and a barangay column naming somebody
 * else's barangay. The happy path is one test; the rest is the part that matters.
 */
const request = require('supertest');
const ExcelJS = require('exceljs');
const app = require('../app');
const { connect, disconnect, clearDB } = require('./setup');
const { createUser, createBarangay, authHeader } = require('./helpers');
const YouthMember = require('../models/YouthMember');
const AuditLog = require('../models/AuditLog');

beforeAll(connect);
afterAll(disconnect);
afterEach(clearDB);

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Build a real .xlsx in memory, so the parser is exercised rather than mocked. */
const workbook = async (rows, headers = ['First Name', 'Last Name', 'Birth Date', 'Gender', 'Email', 'Contact Number', 'Educational Attainment']) => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Youth');
  sheet.addRow(headers);
  rows.forEach((r) => sheet.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

const upload = (token, buffer, path = '/api/youth/import/preview', name = 'roster.xlsx') =>
  request(app).post(path).set(authHeader(token)).attach('file', buffer, { filename: name, contentType: XLSX_MIME });

describe('POST /api/youth/import/preview', () => {
  it('reports valid rows without writing anything', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const buffer = await workbook([
      ['Jose', 'Santos', '2006-04-05', 'Male', 'jose@example.com', '09171234567', 'High School'],
      ['Ana', 'Reyes', '2008-01-20', 'Female', '', '', 'College'],
    ]);

    const res = await upload(token, buffer);
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({ rows: 2, valid: 2, invalid: 0, duplicates: 0 });
    expect(res.body.data.rows[0]).toMatchObject({ line: 2, status: 'valid', firstName: 'Jose', birthDate: '2006-04-05' });
    // Nothing is stored by a preview.
    expect(await YouthMember.countDocuments()).toBe(0);
  });

  it('rejects a file that is not a readable spreadsheet', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const res = await upload(token, Buffer.from('this is not a spreadsheet at all'));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/could not be read as a spreadsheet/i);
  });

  it('rejects a file type that is not a spreadsheet at all', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    // The shared upload middleware checks extension against MIME, so a mislabelled file never
    // reaches the parser.
    const res = await request(app)
      .post('/api/youth/import/preview')
      .set(authHeader(token))
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'roster.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('names the columns it needs when they are missing', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const buffer = await workbook([['Jose', 'Santos']], ['Name', 'Nickname']);
    const res = await upload(token, buffer);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/missing required columns/i);
    expect(res.body.message).toMatch(/First Name/);
  });

  it('accepts the header spellings a real roster uses', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const buffer = await workbook(
      [['Jose', 'Santos', '2006-04-05', 'Male']],
      ['Given Name', 'Surname', 'Date of Birth', 'Sex']
    );
    const res = await upload(token, buffer);
    expect(res.status).toBe(200);
    expect(res.body.data.totals.valid).toBe(1);
  });

  it('flags each kind of bad value on the row it appears on', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const buffer = await workbook([
      ['', 'NoFirstName', '2006-04-05', 'Male', '', '', ''],
      ['Bad', 'Date', 'not a date', 'Male', '', '', ''],
      ['Too', 'Old', '1980-01-01', 'Male', '', '', ''],
      ['Bad', 'Email', '2006-04-05', 'Male', 'not-an-email', '', ''],
      ['Bad', 'Phone', '2006-04-05', 'Male', '', '12345', ''],
      ['No', 'Gender', '2006-04-05', '', '', '', ''],
    ]);

    const res = await upload(token, buffer);
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({ rows: 6, valid: 0, invalid: 6 });

    const errorsByLine = Object.fromEntries(res.body.data.rows.map((r) => [r.line, r.errors.join(' | ')]));
    expect(errorsByLine[2]).toMatch(/First Name is required/);
    expect(errorsByLine[3]).toMatch(/not a date/i);
    expect(errorsByLine[4]).toMatch(/outside the 15–30 SK age range/);
    expect(errorsByLine[5]).toMatch(/not a valid email/i);
    expect(errorsByLine[6]).toMatch(/not a PH mobile number/i);
    expect(errorsByLine[7]).toMatch(/Gender is required/);
  });

  it('flags duplicates within the file and members already registered', async () => {
    const { user, token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    await YouthMember.create({
      firstName: 'Existing',
      lastName: 'Member',
      birthDate: new Date('2007-07-07'),
      gender: 'female',
      municipality: municipalityId,
      registeredBy: user._id,
    });

    const buffer = await workbook([
      ['Twice', 'Listed', '2006-04-05', 'Male'],
      ['Twice', 'Listed', '2006-04-05', 'Male'],
      // Different case, same person as the seeded member.
      ['existing', 'member', '2007-07-07', 'Female'],
    ]);

    const res = await upload(token, buffer);
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({ valid: 1, duplicates: 2 });

    const byLine = Object.fromEntries(res.body.data.rows.map((r) => [r.line, r]));
    expect(byLine[3].duplicateOf).toBe(2);
    expect(byLine[4].alreadyRegistered).toBe(true);
  });
});

describe('GET /api/reports/template/youth-roster', () => {
  /*
   * The template and the parser have to agree, or the file we hand out is the file we reject. This
   * round-trips the generated workbook straight back through the import — the only assertion that
   * actually proves the two sides match.
   */
  it('produces a workbook the importer reads with no errors', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    // Collected as raw bytes: superagent parses an unrecognised body into an object, which is not
    // something a spreadsheet can be reconstructed from.
    const res = await request(app)
      .get('/api/reports/template/youth-roster')
      .set(authHeader(token))
      .buffer()
      .parse((response, cb) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(1000);

    const preview = await request(app)
      .post('/api/youth/import/preview')
      .set(authHeader(token))
      .attach('file', res.body, { filename: 'template.xlsx', contentType: XLSX_MIME });

    expect(preview.status).toBe(200);
    // Exactly the one example row: the blank rows are skipped, and the instructions live on a second
    // worksheet so they are not read as data.
    expect(preview.body.data.totals).toMatchObject({ rows: 1, valid: 1, invalid: 0 });
    expect(preview.body.data.recognisedColumns).toContain('Birth Date');
  });
});

describe('POST /api/youth/import', () => {
  it('imports only the valid rows, and says what it skipped', async () => {
    const { token, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const buffer = await workbook([
      ['Jose', 'Santos', '2006-04-05', 'Male', 'jose@example.com', '09171234567', 'High School'],
      ['Bad', 'Row', 'not a date', 'Male', '', '', ''],
      ['Ana', 'Reyes', '2008-01-20', 'Female', '', '', ''],
    ]);

    const res = await upload(token, buffer, '/api/youth/import');
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ imported: 2, skippedInvalid: 1, skippedDuplicate: 0 });

    const stored = await YouthMember.find({ municipality: municipalityId }).sort({ firstName: 1 });
    expect(stored.map((m) => m.firstName)).toEqual(['Ana', 'Jose']);
    // Educational attainment is normalised on the way in, like every other classification field.
    expect(stored.find((m) => m.firstName === 'Jose').educationalAttainment).toBe('high_school');
    // An imported roster entry is a staff record awaiting confirmation, not a verified one.
    expect(stored[0].verificationStatus).toBe('unverified');
  });

  it('assigns imported members the importer own barangay, ignoring any Barangay column', async () => {
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    const mine = await createBarangay(municipalityId);
    const theirs = await createBarangay(municipalityId);
    const { token } = await createUser({ role: 'sk_chairperson', municipality: municipalityId, barangay: mine._id });

    const buffer = await workbook(
      [['Jose', 'Santos', '2006-04-05', 'Male', theirs._id.toString()]],
      ['First Name', 'Last Name', 'Birth Date', 'Gender', 'Barangay']
    );

    const res = await upload(token, buffer, '/api/youth/import');
    expect(res.status).toBe(201);
    const stored = await YouthMember.findOne({ firstName: 'Jose' });
    expect(stored.barangay.toString()).toBe(mine._id.toString());
  });

  it('refuses a file with nothing importable rather than reporting success', async () => {
    const { token } = await createUser({ role: 'sk_chairperson' });
    const buffer = await workbook([['Bad', 'Row', 'not a date', 'Male']]);
    const res = await upload(token, buffer, '/api/youth/import');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/No importable rows/i);
    expect(await YouthMember.countDocuments()).toBe(0);
  });

  it('records the import in the audit log', async () => {
    const { token, user, municipalityId } = await createUser({ role: 'sk_chairperson' });
    const buffer = await workbook([['Jose', 'Santos', '2006-04-05', 'Male']]);
    await upload(token, buffer, '/api/youth/import');

    const log = await AuditLog.findOne({ action: 'IMPORT', resource: 'youth_member' });
    expect(log).toBeTruthy();
    expect(log.user.toString()).toBe(user._id.toString());
    expect(log.municipality.toString()).toBe(municipalityId.toString());
    expect(log.details).toMatchObject({ fileName: 'roster.xlsx', imported: 1, rows: 1 });
  });

  it('is closed to roles that may not register youth', async () => {
    const { municipalityId } = await createUser({ role: 'municipal_admin' });
    const { token } = await createUser({ role: 'sk_kagawad', municipality: municipalityId });
    const buffer = await workbook([['Jose', 'Santos', '2006-04-05', 'Male']]);

    const res = await upload(token, buffer, '/api/youth/import');
    expect(res.status).toBe(403);
  });

  it('refuses an import from an account with no municipality', async () => {
    // provincial_admin has no municipality of its own, so there is no roster to import into.
    const { token } = await createUser({ role: 'provincial_admin', municipality: null });
    const buffer = await workbook([['Jose', 'Santos', '2006-04-05', 'Male']]);

    const res = await upload(token, buffer, '/api/youth/import');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no municipality/i);
  });
});
