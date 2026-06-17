import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatDate,
  formatFileSize,
  truncate,
  getInitials,
  slugify,
} from '../utils/formatters';

describe('formatCurrency', () => {
  it('prefixes the peso sign and uses 2 decimals', () => {
    expect(formatCurrency(1000)).toBe('₱1,000.00');
  });

  it('groups thousands', () => {
    expect(formatCurrency(1234567.5)).toBe('₱1,234,567.50');
  });

  it('treats null/undefined as zero', () => {
    expect(formatCurrency(null)).toBe('₱0.00');
    expect(formatCurrency(undefined)).toBe('₱0.00');
  });

  it('never emits the PHP currency code (Node CLDR quirk guard)', () => {
    expect(formatCurrency(500)).not.toMatch(/PHP/);
  });
});

describe('formatDate', () => {
  it('returns N/A for falsy input', () => {
    expect(formatDate(null)).toBe('N/A');
    expect(formatDate('')).toBe('N/A');
  });

  it('formats an ISO date into a short readable form', () => {
    const out = formatDate('2026-03-15');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/Mar/);
  });
});

describe('formatFileSize', () => {
  it('returns 0 B for falsy input', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('scales into KB and MB', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1048576)).toBe('1.0 MB');
  });
});

describe('truncate', () => {
  it('returns the string unchanged when under the limit', () => {
    expect(truncate('short', 60)).toBe('short');
  });

  it('appends an ellipsis when over the limit', () => {
    expect(truncate('abcdef', 3)).toBe('abc...');
  });

  it('returns empty string for falsy input', () => {
    expect(truncate(undefined)).toBe('');
  });
});

describe('getInitials', () => {
  it('builds uppercase initials from first and last name', () => {
    expect(getInitials('juan', 'dela cruz')).toBe('JD');
  });

  it('handles missing names gracefully', () => {
    expect(getInitials('Maria', '')).toBe('M');
    expect(getInitials('', '')).toBe('');
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips punctuation', () => {
    expect(slugify('SK Resolution #12!')).toBe('sk-resolution-12');
  });
});
