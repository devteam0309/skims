const { calculateAge, isYouthEligibleAge } = require('../utils/age');

/*
 * The dates below are not arbitrary. Each was found by scanning birth dates against the old
 * 365.25-day formula and keeping the ones where it disagreed with the calendar. They are pinned
 * with an explicit `now`, so the suite does not quietly stop testing the bug as time passes.
 */
describe('calculateAge', () => {
  it('counts a birthday that falls today', () => {
    expect(calculateAge('2011-08-07', new Date('2026-08-07T00:00:00Z'))).toBe(15);
  });

  it('does not count a birthday that has not arrived yet this year', () => {
    expect(calculateAge('2011-08-08', new Date('2026-08-07T00:00:00Z'))).toBe(14);
  });

  it('handles a 29 February birth date in a non-leap year', () => {
    expect(calculateAge('2008-02-29', new Date('2026-02-28T00:00:00Z'))).toBe(17);
    expect(calculateAge('2008-02-29', new Date('2026-03-01T00:00:00Z'))).toBe(18);
  });

  it('returns null rather than NaN for missing or unparseable input', () => {
    expect(calculateAge(null)).toBeNull();
    expect(calculateAge('')).toBeNull();
    expect(calculateAge('not-a-date')).toBeNull();
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(calculateAge(new Date('2000-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toBe(26);
  });

  // The old formula reported 17 for someone who turned 18 that day, and 29 for someone who
  // turned 30 — wrong numbers shown against a real person's record.
  it('reports the ages the 365.25-day formula got wrong', () => {
    expect(calculateAge('2008-08-07', new Date('2026-08-07T00:00:00Z'))).toBe(18);
    expect(calculateAge('1996-08-07', new Date('2026-08-07T00:00:00Z'))).toBe(30);
  });
});

describe('isYouthEligibleAge', () => {
  it('includes both ends of the 15–30 band', () => {
    expect(isYouthEligibleAge(15)).toBe(true);
    expect(isYouthEligibleAge(30)).toBe(true);
  });

  it('excludes either side of it', () => {
    expect(isYouthEligibleAge(14)).toBe(false);
    expect(isYouthEligibleAge(31)).toBe(false);
    expect(isYouthEligibleAge(null)).toBe(false);
  });

  /*
   * The decisions the old formula would have got wrong from 2027 onward: a 15-year-old computed
   * as 14 and turned away from a registry they are entitled to join, and a 31-year-old computed
   * as 30 and admitted to one they are not.
   */
  it('admits a 15-year-old and refuses a 31-year-old on 2027-03-01', () => {
    const now = new Date('2027-03-01T00:00:00Z');
    expect(isYouthEligibleAge(calculateAge('2012-03-01', now))).toBe(true);
    expect(isYouthEligibleAge(calculateAge('1996-03-01', now))).toBe(false);
  });
});
