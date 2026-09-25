/**
 * Frontend half of the barangay scope work, plus the FormData array fix it depended on.
 *
 * These are the assertions that would have caught the two mistakes this round actually made: an
 * array silently flattened into "id1,id2" by FormData, and a barangay control offered to an account
 * whose every selection the server discards.
 *
 * jsdom does no layout, so nothing here measures anything — it asserts the decisions.
 */
import { describe, it, expect } from 'vitest';
import { toFormData } from '../utils/formData';
import { BARANGAY_BOUND_ROLES, FINANCE_EDITORS, FINANCE_APPROVERS, ADMIN_ROLES } from '../utils/constants';

describe('toFormData with array values', () => {
  /*
   * `fd.append(key, ['a','b'])` stringifies to "a,b": one field holding a comma-joined blob, which a
   * handler expecting a list discards as the wrong type. Linking supporting documents to a
   * liquidation was silently dropped exactly this way before the fix.
   */
  it('appends one entry per element instead of joining them', () => {
    const fd = toFormData({ supportingDocuments: ['aaa', 'bbb'], title: 'Q1 liquidation' });
    expect(fd.getAll('supportingDocuments')).toEqual(['aaa', 'bbb']);
    expect(fd.get('supportingDocuments')).not.toBe('aaa,bbb');
  });

  it('appends nothing for an empty array, which is what "none selected" means', () => {
    const fd = toFormData({ supportingDocuments: [], title: 'Q1' });
    expect(fd.getAll('supportingDocuments')).toEqual([]);
    expect(fd.get('title')).toBe('Q1');
  });

  it('drops blank elements but keeps meaningful falsy scalars', () => {
    const fd = toFormData({ ids: ['a', '', null, 'b'], amount: 0, isPublic: false });
    expect(fd.getAll('ids')).toEqual(['a', 'b']);
    // 0 and false are real values for an amount and a flag; only absent fields are skipped.
    expect(fd.get('amount')).toBe('0');
    expect(fd.get('isPublic')).toBe('false');
  });

  it('passes an existing FormData straight through', () => {
    const existing = new FormData();
    existing.append('already', 'built');
    expect(toFormData(existing)).toBe(existing);
  });
});

describe('BARANGAY_BOUND_ROLES', () => {
  /*
   * Decides whether a barangay control is OFFERED. For a bound account the server pins the value, so
   * a picker would be a control whose selection is silently discarded — the same defect the
   * municipality picker had for municipal_admin.
   */
  it('covers the four SK officer roles and no admin tier', () => {
    expect(BARANGAY_BOUND_ROLES).toEqual(['sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad']);
    ADMIN_ROLES.forEach((role) => expect(BARANGAY_BOUND_ROLES).not.toContain(role));
    // Provincial oversight reads the whole province; a barangay would not scope it.
    expect(BARANGAY_BOUND_ROLES).not.toContain('dilg_representative');
    expect(BARANGAY_BOUND_ROLES).not.toContain('youth');
  });

  it('does not overlap the finance approver list', () => {
    // A bound officer is never an approver, so no screen needs to reconcile the two.
    FINANCE_APPROVERS.forEach((role) => expect(BARANGAY_BOUND_ROLES).not.toContain(role));
  });

  it('includes the treasurer, who may write finance records within one barangay', () => {
    expect(BARANGAY_BOUND_ROLES).toContain('sk_treasurer');
    expect(FINANCE_EDITORS).toContain('sk_treasurer');
  });
});
