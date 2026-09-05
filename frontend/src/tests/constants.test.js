import { describe, it, expect } from 'vitest';
import { MUNICIPALITIES, ADMIN_ROLES, FINANCE_STAFF, YOUTH_EDITORS, ROLE_LABELS, ROLES, SELF_ASSIGNABLE_ROLES, homeFor } from '../utils/constants';

describe('MUNICIPALITIES', () => {
  it('lists all four Marinduque municipalities', () => {
    expect(MUNICIPALITIES).toHaveLength(4);
    // Must match the `name` values the API returns, not a display abbreviation.
    ['Boac', 'Gasan', 'Mogpog', 'Santa Cruz'].forEach((m) => {
      expect(MUNICIPALITIES).toContain(m);
    });
  });
});

describe('role groups', () => {
  it('ADMIN_ROLES contains the three admin tiers', () => {
    expect(ADMIN_ROLES).toEqual(['super_admin', 'provincial_admin', 'municipal_admin']);
  });

  it('FINANCE_STAFF extends admins with chairperson and treasurer', () => {
    expect(FINANCE_STAFF).toEqual(expect.arrayContaining([...ADMIN_ROLES, 'sk_chairperson', 'sk_treasurer']));
    expect(FINANCE_STAFF).not.toContain('sk_secretary');
  });

  it('YOUTH_EDITORS includes kagawad but excludes treasurer', () => {
    expect(YOUTH_EDITORS).toContain('sk_kagawad');
    expect(YOUTH_EDITORS).not.toContain('sk_treasurer');
  });

  it('every role has a human-readable label', () => {
    ['super_admin', 'sk_chairperson', 'youth'].forEach((r) => {
      expect(typeof ROLE_LABELS[r]).toBe('string');
      expect(ROLE_LABELS[r].length).toBeGreaterThan(0);
    });
  });

  // Retired: it granted less than being signed out, and doubled as the silent catch-all for any
  // unrecognised role at registration. Nothing should offer it or label it any more.
  it('no longer knows about public_user', () => {
    expect(ROLE_LABELS.public_user).toBeUndefined();
    expect(SELF_ASSIGNABLE_ROLES).not.toContain('public_user');
    expect(Object.values(ROLES)).not.toContain('public_user');
  });

  // The portal it existed to view needs no account, which is why removing it costs nothing.
  it('sends a youth to their own pages, and everyone else to the dashboard', () => {
    expect(homeFor('youth')).toBe('/my/programs');
    expect(homeFor('sk_chairperson')).toBe('/dashboard');
    expect(homeFor(undefined)).toBe('/dashboard');
  });
});
