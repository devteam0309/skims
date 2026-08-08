import { describe, it, expect } from 'vitest';
import { calculateAge, YOUTH_MIN_AGE, YOUTH_MAX_AGE } from '../utils/formatters';

/*
 * This mirrors backend/src/tests/age.test.js. The registration form and the server's eligibility
 * check have to reach the same verdict for the same birth date — if they drift apart, the form
 * accepts someone the server then refuses, with no way for the user to tell why.
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

  // Ages the replaced 365.25-day formula reported incorrectly.
  it('reports the ages the old formula got wrong', () => {
    expect(calculateAge('2008-08-07', new Date('2026-08-07T00:00:00Z'))).toBe(18);
    expect(calculateAge('1996-08-07', new Date('2026-08-07T00:00:00Z'))).toBe(30);
  });

  it('agrees with the eligibility band the server enforces on 2027-03-01', () => {
    const now = new Date('2027-03-01T00:00:00Z');
    const fifteen = calculateAge('2012-03-01', now);
    const thirtyOne = calculateAge('1996-03-01', now);

    expect(fifteen).toBe(15);
    expect(thirtyOne).toBe(31);
    expect(fifteen >= YOUTH_MIN_AGE && fifteen <= YOUTH_MAX_AGE).toBe(true);
    expect(thirtyOne >= YOUTH_MIN_AGE && thirtyOne <= YOUTH_MAX_AGE).toBe(false);
  });
});
