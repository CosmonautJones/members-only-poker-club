import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// `import 'server-only'` is a Next.js bundle-time guard; in vitest we
// shim it so the modules under test can be loaded in a node test env.
vi.mock('server-only', () => ({}));

import { StripeNotConfiguredError } from '@/lib/payments/_errors';
import { assertStripeConfigured, getStripeClient } from '@/lib/payments/stripe-client';

describe('StripeNotConfiguredError', () => {
  it('preserves the canonical name field', () => {
    const err = new StripeNotConfiguredError('STRIPE_SECRET_KEY');
    expect(err.name).toBe('StripeNotConfiguredError');
  });

  it('exposes a stable render-safe userMessage literal (AC19)', () => {
    const err = new StripeNotConfiguredError('STRIPE_SECRET_KEY');
    expect(err.userMessage).toBe('Stripe integration pending — see ADR-0010');
  });

  it('does NOT include the env-var name in error.message (fail-loud premortem risk 3)', () => {
    const err = new StripeNotConfiguredError('STRIPE_SECRET_KEY');
    // The env var name is operationally sensitive — should never appear
    // in the log-friendly `message` field that Sentry captures verbatim.
    expect(err.message).not.toMatch(/STRIPE_SECRET_KEY/);
    // Sanity: the message must still mention ADR-0010 so log diggers
    // know where to look for activation steps.
    expect(err.message).toMatch(/ADR-0010/);
  });

  it('hides missingEnvVar from JSON.stringify (non-enumerable property)', () => {
    const err = new StripeNotConfiguredError('STRIPE_SECRET_KEY');
    const serialized = JSON.stringify(err);
    expect(serialized).not.toMatch(/missingEnvVar/);
    expect(serialized).not.toMatch(/STRIPE_SECRET_KEY/);
  });

  it('exposes missingEnvVar via Object.getOwnPropertyDescriptor for typed-catch consumers', () => {
    const err = new StripeNotConfiguredError('STRIPE_SECRET_KEY');
    const descriptor = Object.getOwnPropertyDescriptor(err, 'missingEnvVar');
    expect(descriptor).toEqual({
      enumerable: false,
      writable: false,
      configurable: false,
      value: 'STRIPE_SECRET_KEY',
    });
  });

  it('reads missingEnvVar directly (readable for tests/diagnostics)', () => {
    const err = new StripeNotConfiguredError('STRIPE_SECRET_KEY');
    expect(err.missingEnvVar).toBe('STRIPE_SECRET_KEY');
  });

  it('is an instance of Error (catchable via the standard hierarchy)', () => {
    const err = new StripeNotConfiguredError('STRIPE_SECRET_KEY');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StripeNotConfiguredError);
  });
});

describe('assertStripeConfigured', () => {
  const originalEnv = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    // Each sub-case mutates process.env directly — restore after.
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalEnv;
    }
  });

  it('throws StripeNotConfiguredError when STRIPE_SECRET_KEY is unset', () => {
    expect(() => assertStripeConfigured()).toThrow(StripeNotConfiguredError);
  });

  it('throws StripeNotConfiguredError when STRIPE_SECRET_KEY is an empty string', () => {
    process.env.STRIPE_SECRET_KEY = '';
    expect(() => assertStripeConfigured()).toThrow(StripeNotConfiguredError);
  });

  it('throws StripeNotConfiguredError when STRIPE_SECRET_KEY is whitespace only', () => {
    process.env.STRIPE_SECRET_KEY = '   ';
    expect(() => assertStripeConfigured()).toThrow(StripeNotConfiguredError);
  });

  it('succeeds (no throw) when STRIPE_SECRET_KEY looks like a real key', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    expect(() => assertStripeConfigured()).not.toThrow();
  });

  it('thrown error carries missingEnvVar=STRIPE_SECRET_KEY for typed catches', () => {
    try {
      assertStripeConfigured();
      throw new Error('assertStripeConfigured did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(StripeNotConfiguredError);
      expect((e as StripeNotConfiguredError).missingEnvVar).toBe('STRIPE_SECRET_KEY');
    }
  });
});

describe('getStripeClient (Slice 1 stub)', () => {
  const originalEnv = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = originalEnv;
    }
  });

  it('always throws in Slice 1, regardless of env state (unset)', () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getStripeClient()).toThrow(StripeNotConfiguredError);
  });

  it('always throws in Slice 1, regardless of env state (set)', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    expect(() => getStripeClient()).toThrow(StripeNotConfiguredError);
  });
});

describe('redact.ts extension — missingEnvVar pattern (fail-loud premortem risk 3)', () => {
  it('classifies missingEnvVar as PII so Sentry redacts manual serializations', async () => {
    const { isPiiKey } = await import('@/lib/observability/redact');
    expect(isPiiKey('missingEnvVar')).toBe(true);
    expect(isPiiKey('MissingEnvVar')).toBe(true);
    expect(isPiiKey('MISSINGENVVAR')).toBe(true);
  });

  it('redacts missingEnvVar values when present in a serialized payload', async () => {
    const { redactPii } = await import('@/lib/observability/redact');
    const result = redactPii({ missingEnvVar: 'STRIPE_SECRET_KEY', other: 'ok' });
    expect(result).toEqual({ missingEnvVar: '[redacted]', other: 'ok' });
  });
});
