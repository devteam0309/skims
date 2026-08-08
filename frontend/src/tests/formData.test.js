import { describe, it, expect } from 'vitest';
import { toFormData } from '../utils/formData';

const entries = (fd) => Object.fromEntries(fd.entries());

describe('toFormData', () => {
  it('copies plain object fields onto the body', () => {
    const fd = toFormData({ title: 'Tarpaulin printing', amount: '5000' });
    expect(entries(fd)).toEqual({ title: 'Tarpaulin printing', amount: '5000' });
  });

  it('drops empty, null and undefined fields', () => {
    const fd = toFormData({ title: 'Venue rental', vendorName: '', budget: null, program: undefined });
    expect(entries(fd)).toEqual({ title: 'Venue rental' });
  });

  it('keeps 0 and false, which a truthiness check would discard', () => {
    const fd = toFormData({ liquidatedAmount: 0, isPublic: false });
    expect(entries(fd)).toEqual({ liquidatedAmount: '0', isPublic: 'false' });
  });

  /*
   * The regression this helper exists for. Rebuilding a FormData by iterating it with
   * Object.entries() yields nothing, so the expense create request went out with an empty body
   * and the server rejected it on fields the user had already filled in.
   */
  it('passes an existing FormData through without emptying it', () => {
    const original = new FormData();
    original.append('title', 'Sound system rental');
    original.append('amount', '12000');

    const fd = toFormData(original);

    expect(fd).toBe(original);
    expect(entries(fd)).toEqual({ title: 'Sound system rental', amount: '12000' });
  });

  it('tolerates being handed nothing', () => {
    expect(entries(toFormData(undefined))).toEqual({});
  });
});
