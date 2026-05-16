/**
 * Unit tests for `lib/observability/sentry.ts` — admin-surface Sentry
 * helpers (ADR-0035 AC32, WD.T22).
 *
 * Run locally:    pnpm test tests/admin/sentry-tags.test.ts
 * Prerequisites:  none — `@sentry/nextjs` is mocked at module level.
 *
 * Spec: docs/specs/0035-admin-operations-console-implementation.md AC32
 *
 * SUT contract (per AC32):
 *   - `withAdminScope(fn)` invokes Sentry's `withScope` and pre-tags
 *     the scope with `surface=admin` before invoking `fn`. The scope
 *     adapter passed to `fn` forwards `setTag` to the underlying
 *     Sentry scope.
 *   - `captureAdminActionError(err, { action, actorRole })` tags
 *     `surface=admin`, `action=<action>`, `actor_role=<role>` and
 *     calls `Sentry.captureException(err)`. NEVER tags `email` or
 *     any PII-keyed value (the source-of-truth for what is PII is
 *     ADR-0014's redaction list).
 *   - `ADMIN_REDACTED_KEYS` is the deny-list for admin-surface
 *     free-text fields that must be redacted from any Sentry event
 *     payload: `reject_reason`, `info_request_message`,
 *     `requester_email`.
 *   - `redactAdminEventKeys(event)` strips those keys from
 *     `event.extra`, `event.tags`, and `event.contexts` recursively,
 *     replacing values with the literal string `'[REDACTED]'`.
 *
 * Mocking strategy:
 *   - vi.mock('server-only') so the `import 'server-only'` directive
 *     does not throw under vitest (which runs in a node test env).
 *   - vi.mock('@sentry/nextjs') with hoisted spies for `withScope`,
 *     `captureException`, `setTag`, etc. so the test can assert
 *     exactly which tags were applied and that captureException was
 *     invoked with the original error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mocks — these need to be visible to the factories of
// vi.mock() and to the tests below. Define the underlying spies at
// the same phase so we can read them from inside test bodies.
const sentryMocks = vi.hoisted(() => {
  const scopeSetTag = vi.fn();
  const scopeSetExtra = vi.fn();
  type ScopeShim = { setTag: typeof scopeSetTag; setExtra: typeof scopeSetExtra };
  const withScope = vi.fn((cb: (scope: ScopeShim) => void) => {
    cb({ setTag: scopeSetTag, setExtra: scopeSetExtra });
  });
  const captureException = vi.fn();
  return { scopeSetTag, scopeSetExtra, withScope, captureException };
});

vi.mock('server-only', () => ({}));

vi.mock('@sentry/nextjs', () => ({
  withScope: sentryMocks.withScope,
  captureException: sentryMocks.captureException,
  setTag: vi.fn(),
}));

beforeEach(() => {
  sentryMocks.scopeSetTag.mockClear();
  sentryMocks.scopeSetExtra.mockClear();
  sentryMocks.withScope.mockClear();
  sentryMocks.captureException.mockClear();
  // Restore the default withScope behaviour (some tests override it).
  sentryMocks.withScope.mockImplementation((cb) => {
    cb({ setTag: sentryMocks.scopeSetTag, setExtra: sentryMocks.scopeSetExtra });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ADMIN_REDACTED_KEYS', () => {
  it('contains exactly the three AC32 free-text fields', async () => {
    const { ADMIN_REDACTED_KEYS } = await import('@/lib/observability/sentry');
    // Spec: AC32 names exactly these three keys.
    expect([...ADMIN_REDACTED_KEYS]).toEqual([
      'reject_reason',
      'info_request_message',
      'requester_email',
    ]);
  });

  it('is a readonly tuple (frozen at type level)', async () => {
    const { ADMIN_REDACTED_KEYS } = await import('@/lib/observability/sentry');
    // The `as const` assertion produces a readonly tuple — runtime
    // shape is a plain array but the type-level contract is what
    // downstream consumers rely on. Sanity-check the array shape.
    expect(Array.isArray(ADMIN_REDACTED_KEYS)).toBe(true);
    expect(ADMIN_REDACTED_KEYS.length).toBe(3);
  });
});

describe('withAdminScope', () => {
  it('tags the scope with surface=admin before invoking the callback', async () => {
    const { withAdminScope } = await import('@/lib/observability/sentry');

    const result = await withAdminScope((scope) => {
      scope.setTag('action', 'foo');
      return 'ok';
    });

    expect(result).toBe('ok');
    // The first tag set on the underlying scope must be surface=admin.
    expect(sentryMocks.scopeSetTag).toHaveBeenCalledWith('surface', 'admin');
    // The caller's per-action tag is forwarded.
    expect(sentryMocks.scopeSetTag).toHaveBeenCalledWith('action', 'foo');
    expect(sentryMocks.withScope).toHaveBeenCalledTimes(1);
  });

  it('passes through async callback return values', async () => {
    const { withAdminScope } = await import('@/lib/observability/sentry');
    const result = await withAdminScope(async (scope) => {
      scope.setTag('action', 'bar');
      return await Promise.resolve(42);
    });
    expect(result).toBe(42);
  });

  it('forwards setExtra on the adapter scope', async () => {
    const { withAdminScope } = await import('@/lib/observability/sentry');
    await withAdminScope((scope) => {
      scope.setExtra('request_id', 'abc-123');
      return null;
    });
    expect(sentryMocks.scopeSetExtra).toHaveBeenCalledWith('request_id', 'abc-123');
  });

  it('falls back to a no-op scope when Sentry.withScope throws', async () => {
    const { withAdminScope } = await import('@/lib/observability/sentry');
    sentryMocks.withScope.mockImplementationOnce(() => {
      throw new Error('sentry broken');
    });
    // The callback must still run with a no-op scope and the return
    // value must propagate.
    const result = await withAdminScope((scope) => {
      // Calling setTag on the no-op scope must not throw.
      scope.setTag('action', 'fallback');
      return 'fallback-result';
    });
    expect(result).toBe('fallback-result');
  });
});

describe('captureAdminActionError', () => {
  it('tags surface, action, actor_role and calls captureException', async () => {
    const { captureAdminActionError } = await import('@/lib/observability/sentry');
    const err = new Error('boom');

    captureAdminActionError(err, {
      action: 'approveVerification',
      actorRole: 'manager',
    });

    // All three required tags must be set.
    expect(sentryMocks.scopeSetTag).toHaveBeenCalledWith('surface', 'admin');
    expect(sentryMocks.scopeSetTag).toHaveBeenCalledWith('action', 'approveVerification');
    expect(sentryMocks.scopeSetTag).toHaveBeenCalledWith('actor_role', 'manager');
    // captureException must be invoked with the exact error reference.
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureException).toHaveBeenCalledWith(err);
  });

  it('never tags an email or other PII-keyed value', async () => {
    const { captureAdminActionError } = await import('@/lib/observability/sentry');
    captureAdminActionError(new Error('x'), {
      action: 'rejectRequest',
      actorRole: 'owner',
    });
    // Walk every setTag call's args and assert none contain an email
    // address shape (`@`) or known PII tag keys. AC32 forbids these.
    for (const [key, value] of sentryMocks.scopeSetTag.mock.calls) {
      expect(key).not.toBe('email');
      expect(key).not.toBe('actor_email');
      expect(key).not.toBe('user_email');
      if (typeof value === 'string') {
        expect(value).not.toMatch(/@/);
      }
    }
  });

  it('does not throw when Sentry.withScope throws', async () => {
    const { captureAdminActionError } = await import('@/lib/observability/sentry');
    sentryMocks.withScope.mockImplementationOnce(() => {
      throw new Error('sentry init missing');
    });
    expect(() =>
      captureAdminActionError(new Error('y'), {
        action: 'approveExport',
        actorRole: 'manager',
      }),
    ).not.toThrow();
  });
});

describe('redactAdminEventKeys / beforeSend redaction', () => {
  it('redacts admin keys from event.extra', async () => {
    const { redactAdminEventKeys } = await import('@/lib/observability/sentry');
    const redacted = redactAdminEventKeys({
      extra: {
        reject_reason: 'member submitted a forged id',
        unrelated: 'keep',
      },
    });
    const extra = redacted.extra as Record<string, unknown>;
    expect(extra.reject_reason).toBe('[REDACTED]');
    expect(extra.unrelated).toBe('keep');
    // Verbatim value must NOT appear anywhere in the serialized event.
    expect(JSON.stringify(redacted)).not.toContain('member submitted a forged id');
  });

  it('redacts admin keys from event.tags', async () => {
    const { redactAdminEventKeys } = await import('@/lib/observability/sentry');
    const redacted = redactAdminEventKeys({
      tags: {
        info_request_message: 'please send a recent utility bill',
        action: 'requestInfo',
      },
    });
    const tags = redacted.tags as Record<string, unknown>;
    expect(tags.info_request_message).toBe('[REDACTED]');
    expect(tags.action).toBe('requestInfo');
  });

  it('redacts admin keys from event.contexts nested objects', async () => {
    const { redactAdminEventKeys } = await import('@/lib/observability/sentry');
    const redacted = redactAdminEventKeys({
      contexts: {
        request: {
          requester_email: 'real@example.com',
          method: 'POST',
        },
        admin_action: {
          reject_reason: 'KYC failed',
          actor_role: 'manager',
        },
      },
    });
    const contexts = redacted.contexts as Record<string, Record<string, unknown>>;
    expect(contexts.request?.requester_email).toBe('[REDACTED]');
    expect(contexts.request?.method).toBe('POST');
    expect(contexts.admin_action?.reject_reason).toBe('[REDACTED]');
    expect(contexts.admin_action?.actor_role).toBe('manager');
    // The original email value must NOT survive anywhere.
    expect(JSON.stringify(redacted)).not.toContain('real@example.com');
    expect(JSON.stringify(redacted)).not.toContain('KYC failed');
  });

  it('redacts all three keys when they appear together in one payload', async () => {
    const { redactAdminEventKeys, ADMIN_REDACTED_KEYS } = await import(
      '@/lib/observability/sentry'
    );
    const sentinelValues: Record<string, string> = {
      reject_reason: 'rj-sentinel-aaa',
      info_request_message: 'msg-sentinel-bbb',
      requester_email: 'email-sentinel-ccc@example.com',
    };
    const redacted = redactAdminEventKeys({
      extra: { ...sentinelValues },
      tags: { ...sentinelValues },
      contexts: { admin: { ...sentinelValues } },
    });
    const serialized = JSON.stringify(redacted);
    // Every sentinel value must be gone.
    for (const v of Object.values(sentinelValues)) {
      expect(serialized).not.toContain(v);
    }
    // Every key must be present (we redact values, not keys).
    for (const k of ADMIN_REDACTED_KEYS) {
      expect(serialized).toContain(k);
    }
    // Count of [REDACTED] occurrences: 3 keys × 3 locations = 9.
    const matches = serialized.match(/\[REDACTED\]/g) ?? [];
    expect(matches.length).toBe(9);
  });

  it('passes through events with no admin keys unchanged', async () => {
    const { redactAdminEventKeys } = await import('@/lib/observability/sentry');
    const event = {
      message: 'ok',
      extra: { foo: 'bar' },
      tags: { surface: 'admin', action: 'approve' },
    };
    const result = redactAdminEventKeys(event);
    expect(result.message).toBe('ok');
    expect(result.extra).toEqual({ foo: 'bar' });
    expect(result.tags).toEqual({ surface: 'admin', action: 'approve' });
  });

  it('handles events with missing extra/tags/contexts', async () => {
    const { redactAdminEventKeys } = await import('@/lib/observability/sentry');
    expect(() => redactAdminEventKeys({})).not.toThrow();
    expect(redactAdminEventKeys({ message: 'hi' })).toEqual({ message: 'hi' });
  });

  it('handles cyclic references in event payloads', async () => {
    const { redactAdminEventKeys } = await import('@/lib/observability/sentry');
    const cycle: Record<string, unknown> = { reject_reason: 'x' };
    cycle.self = cycle;
    expect(() => redactAdminEventKeys({ extra: cycle })).not.toThrow();
  });
});
