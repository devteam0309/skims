/**
 * Excel import for the Youth Registry.
 *
 * SK offices already keep their Katipunan ng Kabataan roster in a spreadsheet, and re-typing it a
 * member at a time is the single largest piece of manual work the system asks of them.
 *
 * Nothing here writes. The controller parses and validates, shows the result, and only inserts after
 * the user has seen what will happen — and it re-parses the file on confirmation rather than trusting
 * rows echoed back by the client, because a preview the server does not re-derive is just a request
 * body with extra steps.
 *
 * Reuses `exceljs`, already a dependency for report export, so the import and export sides of the
 * same spreadsheets cannot drift apart.
 */
const ExcelJS = require('exceljs');
const { normalizeLabel } = require('../utils/labels');
const { calculateAge, isYouthEligibleAge, YOUTH_MIN_AGE, YOUTH_MAX_AGE } = require('../utils/age');

/** A whole municipality's roster is a few hundred rows; this is a bound on memory, not a target. */
const MAX_ROWS = 1000;

/*
 * Accepted spelling for each column, normalised. An office's own sheet says "Firstname", "First
 * Name" or "Given Name" and all three mean the same thing — rejecting a roster over a header
 * spelling would send the user back to reformat a file they already maintain.
 */
const COLUMN_ALIASES = {
  firstName: ['first_name', 'firstname', 'given_name', 'first'],
  lastName: ['last_name', 'lastname', 'surname', 'family_name', 'last'],
  birthDate: ['birth_date', 'birthdate', 'date_of_birth', 'dob', 'birthday'],
  gender: ['gender', 'sex'],
  email: ['email', 'email_address', 'e_mail'],
  contactNumber: ['contact_number', 'contact', 'mobile', 'mobile_number', 'phone', 'phone_number', 'cellphone'],
  address: ['address', 'street_address', 'purok', 'sitio'],
  educationalAttainment: ['educational_attainment', 'education', 'education_level', 'highest_educational_attainment'],
  occupation: ['occupation', 'job', 'work'],
  isRegisteredVoter: ['is_registered_voter', 'registered_voter', 'voter', 'sk_voter'],
};

const REQUIRED_COLUMNS = ['firstName', 'lastName', 'birthDate', 'gender'];

/** Human-readable names, for the error messages and the template. */
const COLUMN_LABELS = {
  firstName: 'First Name',
  lastName: 'Last Name',
  birthDate: 'Birth Date',
  gender: 'Gender',
  email: 'Email',
  contactNumber: 'Contact Number',
  address: 'Address',
  educationalAttainment: 'Educational Attainment',
  occupation: 'Occupation',
  isRegisteredVoter: 'Registered Voter',
};

const PH_MOBILE = /^(09|\+639)\d{9}$/;
const EMAIL = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;

/** Cell values arrive as strings, numbers, dates, or rich-text/formula objects. */
const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.result !== undefined) return String(value.result).trim();
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('').trim();
    if (value.hyperlink && value.text) return String(value.text).trim();
    return '';
  }
  return String(value).trim();
};

/**
 * Birth dates, from the three shapes a real roster contains.
 *
 * A true date cell is unambiguous and preferred. A text cell is not: `03/04/2008` is March in one
 * office's sheet and April in another's, so only ISO (`YYYY-MM-DD`) and the day-first form used
 * locally are accepted, and anything else is reported rather than guessed. Inventing a date here
 * would silently shift someone's SK eligibility.
 */
const parseBirthDate = (raw) => {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;

  const text = cellText(raw);
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (iso) {
    const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Day-first, as written in the Philippines: 05/04/2008 is 5 April.
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    if (+month < 1 || +month > 12 || +day < 1 || +day > 31) return null;
    const d = new Date(Date.UTC(+year, +month - 1, +day));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
};

const parseBoolean = (raw) => {
  const text = cellText(raw).toLowerCase();
  if (['yes', 'y', 'true', '1', 'oo', 'registered'].includes(text)) return true;
  if (['no', 'n', 'false', '0', 'hindi', ''].includes(text)) return false;
  return null;
};

/** Map the header row onto field names. Returns `{ map, missing }`. */
const mapHeaders = (headerRow) => {
  const map = {};
  headerRow.forEach((heading, index) => {
    const key = normalizeLabel(cellText(heading));
    if (!key) return;
    const field = Object.keys(COLUMN_ALIASES).find((f) => COLUMN_ALIASES[f].includes(key));
    // First column wins, so a sheet with a stray duplicate heading still imports.
    if (field && map[field] === undefined) map[field] = index;
  });
  const missing = REQUIRED_COLUMNS.filter((f) => map[f] === undefined).map((f) => COLUMN_LABELS[f]);
  return { map, missing };
};

/**
 * Read and validate a workbook buffer.
 *
 * Returns `{ ok, error, headers, rows }`, where every row carries its spreadsheet line number so the
 * user can find it in their own file — reporting "row 14" when the sheet has a title row above the
 * headers would send them to the wrong line.
 */
const parseYouthWorkbook = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (_) {
    // A .xls renamed to .xlsx, a password-protected file, or a truncated upload all land here.
    return { ok: false, error: 'That file could not be read as a spreadsheet. Save it as .xlsx and try again.' };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) return { ok: false, error: 'The spreadsheet is empty' };

  /*
   * The header row is the first row that actually names the required columns — not necessarily the
   * first row in the sheet, which is often a title or a blank spacer.
   */
  let headerRowNumber = 0;
  let headers = null;
  for (let n = 1; n <= Math.min(sheet.rowCount, 10); n += 1) {
    const values = sheet.getRow(n).values.slice(1);
    const { map, missing } = mapHeaders(values);
    if (missing.length === 0) {
      headerRowNumber = n;
      headers = map;
      break;
    }
  }

  if (!headers) {
    const firstRow = sheet.getRow(1).values.slice(1);
    const { missing } = mapHeaders(firstRow);
    return {
      ok: false,
      error: `The spreadsheet is missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
      expected: REQUIRED_COLUMNS.map((f) => COLUMN_LABELS[f]),
    };
  }

  const rows = [];
  let dataRows = 0;

  for (let n = headerRowNumber + 1; n <= sheet.rowCount; n += 1) {
    const row = sheet.getRow(n);
    const values = row.values.slice(1);
    const at = (field) => (headers[field] === undefined ? undefined : values[headers[field]]);

    // Skip rows that are entirely blank: a spreadsheet's used range routinely runs past its data.
    const hasAnything = Object.keys(headers).some((f) => cellText(at(f)) !== '');
    if (!hasAnything) continue;

    dataRows += 1;
    if (dataRows > MAX_ROWS) {
      return { ok: false, error: `This file has more than ${MAX_ROWS} rows. Split it and import in parts.` };
    }

    const errors = [];
    const record = {};

    record.firstName = cellText(at('firstName'));
    record.lastName = cellText(at('lastName'));
    if (!record.firstName) errors.push('First Name is required');
    if (!record.lastName) errors.push('Last Name is required');

    const birthDate = parseBirthDate(at('birthDate'));
    if (!birthDate) {
      errors.push('Birth Date is missing or not a date (use YYYY-MM-DD)');
    } else {
      record.birthDate = birthDate;
      const age = calculateAge(birthDate);
      if (!isYouthEligibleAge(age)) {
        errors.push(`Age ${age} is outside the ${YOUTH_MIN_AGE}–${YOUTH_MAX_AGE} SK age range`);
      }
    }

    // Free text, stored as typed and matched case-insensitively — normalising it would repeat the
    // problem that removing the gender enum was meant to fix.
    record.gender = cellText(at('gender'));
    if (!record.gender) errors.push('Gender is required');
    else if (record.gender.length > 40) errors.push('Gender must be 40 characters or fewer');

    const email = cellText(at('email'));
    if (email) {
      if (!EMAIL.test(email)) errors.push(`"${email}" is not a valid email address`);
      else record.email = email.toLowerCase();
    }

    const contact = cellText(at('contactNumber')).replace(/[\s()-]/g, '');
    if (contact) {
      if (!PH_MOBILE.test(contact)) errors.push(`"${contact}" is not a PH mobile number (09XXXXXXXXX)`);
      else record.contactNumber = contact;
    }

    const address = cellText(at('address'));
    if (address) record.address = address;

    const education = cellText(at('educationalAttainment'));
    // Normalised, so a typed level groups with the existing ones in the filters instead of becoming
    // its own category — the rule for every classification field except gender.
    if (education) record.educationalAttainment = normalizeLabel(education);

    const occupation = cellText(at('occupation'));
    if (occupation) record.occupation = occupation;

    const voter = parseBoolean(at('isRegisteredVoter'));
    if (voter === null) {
      errors.push(`"${cellText(at('isRegisteredVoter'))}" is not a yes/no value for Registered Voter`);
    } else {
      record.isRegisteredVoter = voter;
    }

    rows.push({ line: n, record, errors });
  }

  if (rows.length === 0) return { ok: false, error: 'The spreadsheet has headers but no data rows' };

  return { ok: true, headerRowNumber, headers: Object.keys(headers).map((f) => COLUMN_LABELS[f]), rows };
};

/**
 * Flag rows that duplicate each other within the file.
 *
 * Name + birth date, which is the same key as the registry's own unique index — so a pair the
 * database would reject is caught here, where it can be shown next to the two offending line
 * numbers, instead of surfacing as a failed insert halfway through.
 */
const markInFileDuplicates = (rows) => {
  const seen = new Map();
  rows.forEach((row) => {
    const { firstName, lastName, birthDate } = row.record;
    if (!firstName || !lastName || !birthDate) return;
    const key = `${firstName.toLowerCase()}|${lastName.toLowerCase()}|${new Date(birthDate).toISOString().slice(0, 10)}`;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, row.line);
    } else {
      row.duplicateOf = first;
    }
  });
  return rows;
};

module.exports = {
  parseYouthWorkbook,
  markInFileDuplicates,
  COLUMN_LABELS,
  REQUIRED_COLUMNS,
  MAX_ROWS,
};
