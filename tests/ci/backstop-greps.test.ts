import { describe, it, expect } from 'vitest';
import {
  BACKSTOP_GREPS,
  CENTS_FLOAT_TYPE_PATTERN,
  SERVICE_ROLE_KEY_BARE_PATTERN,
} from '@/lib/ci/backstop-greps';

describe('CENTS_FLOAT_TYPE_PATTERN (ADR-0004)', () => {
  it('flags *_cents columns declared with floating-point types', () => {
    expect(CENTS_FLOAT_TYPE_PATTERN.test('amount_cents NUMERIC(12,2)')).toBe(true);
    expect(CENTS_FLOAT_TYPE_PATTERN.test('price_cents decimal NOT NULL')).toBe(true);
    expect(CENTS_FLOAT_TYPE_PATTERN.test('total_cents float')).toBe(true);
    expect(CENTS_FLOAT_TYPE_PATTERN.test('balance_cents real')).toBe(true);
    expect(CENTS_FLOAT_TYPE_PATTERN.test('fee_cents double precision')).toBe(true);
  });

  it('allows *_cents columns with INTEGER/BIGINT types', () => {
    expect(CENTS_FLOAT_TYPE_PATTERN.test('amount_cents INTEGER NOT NULL')).toBe(false);
    expect(CENTS_FLOAT_TYPE_PATTERN.test('price_cents BIGINT')).toBe(false);
    expect(CENTS_FLOAT_TYPE_PATTERN.test('balance_cents int')).toBe(false);
  });
});

describe('SERVICE_ROLE_KEY_BARE_PATTERN (ADR-0007)', () => {
  it('flags any bare reference to SUPABASE_SERVICE_ROLE_KEY', () => {
    expect(SERVICE_ROLE_KEY_BARE_PATTERN.test('SUPABASE_SERVICE_ROLE_KEY = "eyJ..."')).toBe(true);
    expect(SERVICE_ROLE_KEY_BARE_PATTERN.test('process.env.SUPABASE_SERVICE_ROLE_KEY')).toBe(true);
    expect(SERVICE_ROLE_KEY_BARE_PATTERN.test('const k = env("SUPABASE_SERVICE_ROLE_KEY")')).toBe(
      true,
    );
  });

  it('does not match unrelated text', () => {
    expect(SERVICE_ROLE_KEY_BARE_PATTERN.test('SUPABASE_ANON_KEY')).toBe(false);
    expect(SERVICE_ROLE_KEY_BARE_PATTERN.test('just some other text')).toBe(false);
  });
});

describe('BACKSTOP_GREPS list', () => {
  it('contains the two expected entries', () => {
    const names = BACKSTOP_GREPS.map((g) => g.name);
    expect(names).toContain('cents-float-type');
    expect(names).toContain('service-role-key-in-client');
  });

  it('each entry is well-formed', () => {
    for (const grep of BACKSTOP_GREPS) {
      expect(grep.name.length).toBeGreaterThan(0);
      expect(grep.pattern).toBeInstanceOf(RegExp);
      expect(grep.description.length).toBeGreaterThan(0);
      expect(grep.glob.length).toBeGreaterThan(0);
    }
  });

  it('service-role-key-in-client entry restricts to client trees via paths', () => {
    const entry = BACKSTOP_GREPS.find((g) => g.name === 'service-role-key-in-client');
    expect(entry).toBeDefined();
    expect(entry?.paths).toBeDefined();
    expect(entry?.paths).toContain('app/(member)/');
    expect(entry?.paths).toContain('app/(marketing)/');
    expect(entry?.paths).toContain('components/');
  });
});
