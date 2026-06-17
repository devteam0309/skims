import { describe, it, expect } from 'vitest';
import { MUNICIPALITIES, ADMIN_ROLES, FINANCE_STAFF, YOUTH_EDITORS, ROLE_LABELS } from '../utils/constants';

describe('MUNICIPALITIES', () => {
  it('lists all six Marinduque municipalities', () => {
    expect(MUNICIPALITIES).toHaveLength(6);
    ['Boac', 'Buenavista', 'Gasan', 'Mogpog', 'Sta. Cruz', 'Torrijos'].forEach((m) => {
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
    expect(FINANCE_STAFF).not.toContain('public_user');
  });

  it('YOUTH_EDITORS includes kagawad but excludes treasurer', () => {
    expect(YOUTH_EDITORS).toContain('sk_kagawad');
    expect(YOUTH_EDITORS).not.toContain('sk_treasurer');
  });

  it('every role has a human-readable label', () => {
    ['super_admin', 'sk_chairperson', 'public_user'].forEach((r) => {
      expect(typeof ROLE_LABELS[r]).toBe('string');
      expect(ROLE_LABELS[r].length).toBeGreaterThan(0);
    });
  });
});
