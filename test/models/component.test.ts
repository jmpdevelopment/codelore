import { describe, it, expect } from 'vitest';
import { slugify, isValidComponentId, type Component } from '../../src/models/component';

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Billing Engine')).toBe('billing-engine');
  });

  it('collapses runs of non-alphanumerics', () => {
    expect(slugify('Auth / Middleware  (v2)')).toBe('auth-middleware-v2');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('--foo--')).toBe('foo');
  });

  it('truncates to 64 chars', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(64);
  });

  it('falls back to "component" for empty input', () => {
    expect(slugify('   ')).toBe('component');
    expect(slugify('!!!')).toBe('component');
  });
});

describe('isValidComponentId', () => {
  it('accepts slug-safe ids', () => {
    expect(isValidComponentId('billing-engine')).toBe(true);
    expect(isValidComponentId('auth')).toBe(true);
    expect(isValidComponentId('v2')).toBe(true);
  });

  it('rejects invalid ids', () => {
    expect(isValidComponentId('Billing Engine')).toBe(false);
    expect(isValidComponentId('-starts-with-hyphen')).toBe(false);
    expect(isValidComponentId('ends-with-hyphen-')).toBe(false);
    expect(isValidComponentId('has/slash')).toBe(false);
    expect(isValidComponentId('..')).toBe(false);
    expect(isValidComponentId('')).toBe(false);
    expect(isValidComponentId(42)).toBe(false);
    expect(isValidComponentId(undefined)).toBe(false);
  });
});

describe('Component interface', () => {
  it('accepts valid data', () => {
    const c: Component = {
      id: 'billing',
      name: 'Billing Engine',
      description: 'Monthly subscription billing pipeline',
      owners: ['alice@example.com'],
      files: ['src/billing/calc.ts', 'src/billing/invoice.ts'],
      source: 'human_authored',
      created_at: '2026-04-18T00:00:00Z',
      updated_at: '2026-04-18T00:00:00Z',
    };
    expect(c.files).toHaveLength(2);
    expect(c.source).toBe('human_authored');
  });
});
