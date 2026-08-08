import { describe, it, expect } from 'vitest';
import { PASSWORD_PATTERN, PASSWORD_RULE_TEXT, LOGIN_NOTICES } from '../utils/constants';

/*
 * PASSWORD_PATTERN must match the validator on backend/src/models/User.js, which runs on save and
 * is the last word on whether a password is accepted.
 *
 * The registration form previously required only an uppercase letter and a digit, matching the
 * register route's validator but not the model. "Password1" cleared the form, cleared the route,
 * and was then rejected on save with a message citing a special-character rule the form had never
 * mentioned — confirmed against the running API as a 400 before this was changed.
 */
describe('PASSWORD_PATTERN', () => {
  it('rejects the password the sign-up form used to accept', () => {
    expect(PASSWORD_PATTERN.test('Password1')).toBe(false);
  });

  it('accepts a password meeting every stated requirement', () => {
    expect(PASSWORD_PATTERN.test('Password1!')).toBe(true);
    expect(PASSWORD_PATTERN.test('Admin@123')).toBe(true);
  });

  it('requires each part of the rule independently', () => {
    expect(PASSWORD_PATTERN.test('Pass1!')).toBe(false);       // under 8 characters
    expect(PASSWORD_PATTERN.test('password1!')).toBe(false);   // no uppercase
    expect(PASSWORD_PATTERN.test('Password!')).toBe(false);    // no digit
    expect(PASSWORD_PATTERN.test('Password12')).toBe(false);   // no special character
  });

  it('states all four requirements in the text shown to users', () => {
    expect(PASSWORD_RULE_TEXT).toMatch(/8/);
    expect(PASSWORD_RULE_TEXT).toMatch(/uppercase/i);
    expect(PASSWORD_RULE_TEXT).toMatch(/number/i);
    expect(PASSWORD_RULE_TEXT).toMatch(/special/i);
  });
});

/*
 * The login page renders only messages found in this map. The `reason` query parameter used to be
 * printed verbatim, so a crafted link could put arbitrary text in the app's own error toast on the
 * real domain.
 */
describe('LOGIN_NOTICES', () => {
  it('resolves the codes the API client emits', () => {
    expect(LOGIN_NOTICES.session_expired).toBeTruthy();
    expect(LOGIN_NOTICES.account_inactive).toBeTruthy();
  });

  it('has no entry for arbitrary attacker-supplied text', () => {
    expect(LOGIN_NOTICES['Your account is locked, call 0917-555-0123']).toBeUndefined();
    expect(LOGIN_NOTICES['<img src=x onerror=alert(1)>']).toBeUndefined();
  });
});
