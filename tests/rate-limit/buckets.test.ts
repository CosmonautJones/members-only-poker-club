import { describe, it, expect } from 'vitest';
import { BUCKETS } from '@/lib/rate-limit/buckets';

describe('BUCKETS', () => {
  it('has every key from the ADR', () => {
    for (const key of [
      'anonymous',
      'login',
      'signup',
      'contact_form',
      'member',
      'staff',
    ] as const) {
      expect(BUCKETS[key]).toBeDefined();
    }
  });

  it('matches ADR-0016 numeric policy', () => {
    expect(BUCKETS.anonymous.limit).toBe(60);
    expect(BUCKETS.anonymous.window_ms).toBe(60_000);

    expect(BUCKETS.login.limit).toBe(5);
    expect(BUCKETS.login.window_ms).toBe(15 * 60_000);

    expect(BUCKETS.signup.limit).toBe(3);
    expect(BUCKETS.signup.window_ms).toBe(60 * 60_000);

    expect(BUCKETS.contact_form.limit).toBe(3);
    expect(BUCKETS.contact_form.window_ms).toBe(60 * 60_000);

    expect(BUCKETS.member.limit).toBe(600);
    expect(BUCKETS.staff.limit).toBe(1200);
  });

  it('every bucket has a non-empty description', () => {
    for (const bucket of Object.values(BUCKETS)) {
      expect(bucket.description.length).toBeGreaterThan(0);
    }
  });
});
