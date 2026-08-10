import { describe, expect, it } from 'vitest';
import { formatJst, jstInputToIso, toJstInput } from './date';

describe('JST date conversion', () => {
  it('stores a JST deadline as UTC', () => {
    expect(jstInputToIso('2026-08-15T18:00')).toBe('2026-08-15T09:00:00.000Z');
  });

  it('restores a UTC deadline to a JST form value', () => {
    expect(toJstInput('2026-08-15T09:00:00.000Z')).toBe('2026-08-15T18:00');
    expect(formatJst('2026-08-15T09:00:00.000Z')).toContain('18:00');
  });

  it('rejects invalid dates', () => {
    expect(() => jstInputToIso('invalid')).toThrow();
  });
});
