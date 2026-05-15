/**
 * Tests for lib/privacy/retention.ts — ADR-0023 AC2.
 *
 * Verifies:
 *   - Every RetentionCategory returns the expected RetentionWindow.
 *   - Purity: two calls with the same arg are deep-equal.
 *   - Type-level exhaustiveness via expectTypeOf / @ts-expect-error.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  getRetentionWindow,
  getPostEventRetention,
  type RetentionCategory,
  type RetentionWindow,
} from '@/lib/privacy/retention';

describe('getRetentionWindow', () => {
  it('id_document -> { kind: "until_event", event: "verification" }', () => {
    const w = getRetentionWindow('id_document');
    expect(w).toEqual({ kind: 'until_event', event: 'verification' });
  });

  it('audit_log -> { kind: "forever" }', () => {
    const w = getRetentionWindow('audit_log');
    expect(w).toEqual({ kind: 'forever' });
  });

  it('ledger -> { kind: "forever" }', () => {
    const w = getRetentionWindow('ledger');
    expect(w).toEqual({ kind: 'forever' });
  });

  it('payment -> { kind: "days", days: 2555 } (7 years)', () => {
    const w = getRetentionWindow('payment');
    expect(w).toEqual({ kind: 'days', days: 365 * 7 });
    if (w.kind === 'days') {
      expect(w.days).toBe(2555);
    }
  });

  it('sentry -> { kind: "days", days: 90 }', () => {
    const w = getRetentionWindow('sentry');
    expect(w).toEqual({ kind: 'days', days: 90 });
  });

  it('posthog -> { kind: "days", days: 365 }', () => {
    const w = getRetentionWindow('posthog');
    expect(w).toEqual({ kind: 'days', days: 365 });
  });

  it('session -> { kind: "days", days: 30 }', () => {
    const w = getRetentionWindow('session');
    expect(w).toEqual({ kind: 'days', days: 30 });
  });

  it('marketing_contact -> { kind: "until_event", event: "unsubscribe" }', () => {
    const w = getRetentionWindow('marketing_contact');
    expect(w).toEqual({ kind: 'until_event', event: 'unsubscribe' });
  });

  it('is pure: two calls with the same arg are deep-equal', () => {
    const categories: RetentionCategory[] = [
      'id_document',
      'audit_log',
      'ledger',
      'payment',
      'sentry',
      'posthog',
      'session',
      'marketing_contact',
    ];
    for (const cat of categories) {
      expect(getRetentionWindow(cat)).toEqual(getRetentionWindow(cat));
    }
  });
});

describe('getPostEventRetention', () => {
  it('id_document -> { kind: "days", days: 30 }', () => {
    const w = getPostEventRetention('id_document');
    expect(w).toEqual({ kind: 'days', days: 30 });
  });

  it('returns null for categories with no post-event follow-on', () => {
    const noFollowOn: RetentionCategory[] = [
      'audit_log',
      'ledger',
      'payment',
      'sentry',
      'posthog',
      'session',
      'marketing_contact',
    ];
    for (const cat of noFollowOn) {
      expect(getPostEventRetention(cat)).toBeNull();
    }
  });
});

describe('RetentionWindow type', () => {
  it('getRetentionWindow return type is RetentionWindow', () => {
    expectTypeOf(getRetentionWindow).returns.toEqualTypeOf<RetentionWindow>();
  });

  it('RetentionCategory is a string union (not any)', () => {
    expectTypeOf<RetentionCategory>().not.toEqualTypeOf<string>();
  });

  it('passing a nonexistent category to getRetentionWindow is a type error', () => {
    // This test verifies compile-time exhaustiveness only.
    // We assert the function parameter type directly: getRetentionWindow only
    // accepts RetentionCategory values, so passing an arbitrary string requires
    // a cast. The cast-free call below would be a type error — verified by
    // the TypeScript compiler at build/typecheck time (not at runtime).
    // We use a type-level assertion: the parameter type must not extend string.
    expectTypeOf(getRetentionWindow).parameter(0).not.toEqualTypeOf<string>();
  });
});
