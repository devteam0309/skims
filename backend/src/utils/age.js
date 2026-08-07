/**
 * Calendar age in whole years.
 *
 * Three places previously derived age as
 *   Math.floor((Date.now() - birthDate) / (365.25 * 24 * 60 * 60 * 1000))
 * — the youth route's eligibility check, the YouthMember `age` virtual, and the registration
 * form. A 365.25-day year is not a calendar year, so the result drifts by a day either side of a
 * birthday depending on how leap days fall in the interval, and floors to the wrong integer.
 *
 * Evaluated on 2026-08-07 the drift changes no eligibility decision, so it currently shows only
 * as a wrong number (someone who turned 18 today reads as 17). From March 2027 it starts changing
 * decisions in both directions: a 15-year-old computing as 14 is turned away from a registry they
 * are entitled to join, and a 31-year-old computing as 30 is admitted to one they are not.
 *
 * Counting calendar years — and comparing month/day to decide whether this year's birthday has
 * happened yet — has no drift to accumulate.
 *
 * UTC throughout: birth dates arrive as plain 'YYYY-MM-DD', which Date parses as UTC midnight.
 * Reading them back with local getters would shift the day for any server not on UTC and
 * reintroduce an off-by-one either side of a birthday.
 */
const calculateAge = (birthDate, now = new Date()) => {
  if (!birthDate) return null;
  const born = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;

  const ref = now instanceof Date ? now : new Date(now);
  let age = ref.getUTCFullYear() - born.getUTCFullYear();

  const monthDiff = ref.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getUTCDate() < born.getUTCDate())) age -= 1;

  return age;
};

/** SK membership band, per the eligibility rule the youth routes enforce. */
const YOUTH_MIN_AGE = 15;
const YOUTH_MAX_AGE = 30;

const isYouthEligibleAge = (age) => age !== null && age >= YOUTH_MIN_AGE && age <= YOUTH_MAX_AGE;

module.exports = { calculateAge, isYouthEligibleAge, YOUTH_MIN_AGE, YOUTH_MAX_AGE };
