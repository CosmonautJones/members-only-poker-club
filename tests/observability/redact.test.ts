import { describe, it, expect } from 'vitest';
import { isPiiKey, redactPii } from '@/lib/observability/redact';

describe('isPiiKey', () => {
  it('identifies the canonical PII keys (case-insensitive)', () => {
    for (const key of [
      'email',
      'EMAIL',
      'email_address',
      'phone',
      'phone_number',
      'dob',
      'date_of_birth',
      'birthdate',
      'id_doc_path',
      'id_doc_url',
      'stripe_customer_id',
      'stripe_payment_intent',
      'password',
      'token',
      'auth_token',
      'access_token',
      'refresh_token',
      'secret',
      'webhook_secret',
      'api_key',
      'cookie',
      'session_id',
    ]) {
      expect(isPiiKey(key), `${key} should be PII`).toBe(true);
    }
  });

  it('lets non-PII keys through', () => {
    for (const key of [
      'name',
      'first_name',
      'last_name',
      'profile_id',
      'member_number',
      'amount_cents',
      'minutes',
      'created_at',
      'updated_at',
      'role',
      'status',
    ]) {
      expect(isPiiKey(key), `${key} should not be PII`).toBe(false);
    }
  });
});

describe('redactPii / shallow', () => {
  it('redacts top-level PII keys', () => {
    expect(redactPii({ email: 'x@example.com', name: 'Alice' })).toEqual({
      email: '[redacted]',
      name: 'Alice',
    });
  });

  it('preserves primitives', () => {
    expect(redactPii('hello')).toBe('hello');
    expect(redactPii(42)).toBe(42);
    expect(redactPii(null)).toBeNull();
    expect(redactPii(undefined)).toBeUndefined();
    expect(redactPii(true)).toBe(true);
  });

  it('preserves arrays of primitives', () => {
    expect(redactPii([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('redactPii / nested', () => {
  it('walks nested objects', () => {
    const result = redactPii({
      user: {
        name: 'Alice',
        email: 'a@example.com',
        details: { phone: '512-555-1212', city: 'Austin' },
      },
    });
    expect(result).toEqual({
      user: {
        name: 'Alice',
        email: '[redacted]',
        details: { phone: '[redacted]', city: 'Austin' },
      },
    });
  });

  it('walks arrays of objects', () => {
    const result = redactPii({
      records: [
        { name: 'A', email: 'a@example.com' },
        { name: 'B', email: 'b@example.com' },
      ],
    });
    expect(result).toEqual({
      records: [
        { name: 'A', email: '[redacted]' },
        { name: 'B', email: '[redacted]' },
      ],
    });
  });
});

describe('redactPii / edge cases', () => {
  it('handles cyclic references', () => {
    const obj: Record<string, unknown> = { name: 'A' };
    obj.self = obj;
    expect(() => redactPii(obj)).not.toThrow();
  });

  it('handles empty object and array', () => {
    expect(redactPii({})).toEqual({});
    expect(redactPii([])).toEqual([]);
  });
});
