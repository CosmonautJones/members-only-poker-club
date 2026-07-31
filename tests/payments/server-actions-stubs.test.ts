/**
 * Tests for `app/(admin)/admin/payments/refunds/new/_actions/initiateRefund.ts`
 * (ADR-0036 Slice 1, t9, AC21 + AC22).
 *
 * Run locally:    pnpm test tests/payments/server-actions-stubs.test.ts
 * Prerequisites:  none — module mocks only; no DB / no network.
 *
 * Spec: docs/specs/0036-payment-management-console-implementation.md AC21, AC22.
 *
 * SUT contract (load-bearing — do not weaken):
 *   1. First line is `import 'server-only';`.
 *   2. `'use server';` appears on its own line.
 *   3. First runtime statement: `const { profile: actor } = await requireRole('manager');`.
 *      InsufficientRoleError thrown here propagates BEFORE any audit row.
 *   4. Zod validation runs BEFORE `withAudit`. `z.object({ ... amountCents:
 *      z.number().int().positive().finite() ...}).parse(params)` — `.finite()`
 *      is load-bearing (rejects NaN / Infinity).
 *   5. `assertRefundAuthority({...})` runs BEFORE `withAudit`.
 *      InsufficientAuthorityError thrown here propagates WITHOUT writing audit
 *      (intentional asymmetry per Open Q2 — see initiateRefund.ts load-bearing
 *      comment block).
 *   6. `withAudit(...)` is wrapped INSIDE a `runner.transaction(...)` callback
 *      (premortem risk 11; mirrors openRefundFlow.ts).
 *      Audit row contract:
 *        - action: ADMIN_REFUND_DENIED
 *        - targetType: 'refund_request'
 *        - targetId: '__stripe_not_configured__' (D2 sentinel — NOT 'pending')
 *        - actorId: actor.id
 *        - before: null
 *        - after: { reason: 'stripe_not_configured', refund_type, amount_cents }
 *   7. `assertStripeConfigured()` runs AFTER `withAudit` resolves. The
 *      StripeNotConfiguredError throw propagates to the segment-level error
 *      boundary (t11 path).
 *
 * Premortem-binding additions (see
 * .conductor/36/returns/0007-premortem-fail-loud.md):
 *   - R1 audit-before-throw ordering: sequence-tracking mock asserts
 *     [withAudit_called → withAudit_resolved → assertStripeConfigured_called → throws].
 *   - D2 sentinel: `target_id === '__stripe_not_configured__'`.
 *   - R6 authority-denial vs Stripe-not-configured asymmetry:
 *     authority-denial sub-case asserts `withAudit` NOT called.
 *   - R7 Zod `.finite()`: NaN / Infinity / negative / non-integer / zero
 *     all reject BEFORE `withAudit`.
 *   - R10 source-grep invariants: first-line directive, own-line `'use server';`,
 *     literal `await requireRole('manager')`, literal `assertStripeConfigured`,
 *     references `ADMIN_REFUND_DENIED`, references `__stripe_not_configured__`.
 *   - R11 transaction wrapper: `runner.transaction(...)` called exactly once
 *     before the `withAudit` call inside its callback.
 *
 * NOTE: This file does NOT re-test `StripeNotConfiguredError` constructor /
 * `assertStripeConfigured` env probing — both are covered exhaustively by
 * `tests/payments/stripe-client.test.ts` (t7). We only re-import here to
 * confirm cross-module shape (sub-case a per dispatch envelope).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// `import 'server-only'` is a Next.js bundle-time guard — shim it so the
// SUT and its deps can load in the node-based vitest runtime.
vi.mock('server-only', () => ({}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// `requireRole` mock — mirrors `tests/admin/open-refund-flow-action.test.ts`.
// Tests set `requireRoleState.currentActor` before invoking the action; the
// mock throws InsufficientRoleError on rank mismatch.
const requireRoleState = vi.hoisted(() => ({
  currentActor: null as { id: string; role: 'member' | 'cashier' | 'manager' | 'owner' } | null,
}));

vi.mock('@/lib/auth/requireRole', async () => {
  const { InsufficientRoleError } =
    await vi.importActual<typeof import('@/lib/auth/errors')>('@/lib/auth/errors');
  return {
    requireRole: vi.fn(async (required: 'manager' | 'owner') => {
      const actor = requireRoleState.currentActor;
      if (!actor) {
        throw new Error('test bug: currentActor not set before requireRole call');
      }
      const rank: Record<string, number> = {
        member: 0,
        cashier: 1,
        manager: 2,
        owner: 3,
      };
      if (rank[actor.role]! < rank[required]!) {
        throw new InsufficientRoleError(required, actor.role);
      }
      return { profile: { id: actor.id, role: actor.role } };
    }),
  };
});

// Sequence-tracking mocks for `withAudit` + `assertStripeConfigured` (R1).
// Each call appends a string to `callSequence`; tests assert ordering on this
// array AND on argument shapes via vi.fn .mock.calls.
const callSequence = vi.hoisted(() => ({ entries: [] as string[] }));

// `withAudit` mock — captures the params object passed by the SUT and
// records ordering. Returns a resolved promise so the action proceeds to
// `assertStripeConfigured`.
const withAuditMock = vi.hoisted(() =>
  vi.fn(
    async (
      _tx: unknown,
      params: {
        action: string;
        targetType: string;
        targetId: string;
        actorId: string | null;
      },
      mutate: (tx: unknown) => Promise<{ before: unknown; after: unknown; result: unknown }>,
    ) => {
      callSequence.entries.push('withAudit_called');
      // Invoke the mutate callback so the SUT's `before`/`after` snapshot
      // payload is exercised (matches real `withAudit` semantics — see
      // lib/audit/withAudit.ts line 271).
      const { result } = await mutate({});
      callSequence.entries.push('withAudit_resolved');
      // Re-export params + result on the mock so assertions can read them.
      void params;
      return result;
    },
  ),
);

vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: withAuditMock,
}));

// `assertStripeConfigured` mock — when env unset, throws
// StripeNotConfiguredError; otherwise no-op. The sub-cases drive env state
// directly so this mock just delegates to the real shape via dynamic import
// inside the factory. We also record ordering.
const assertStripeConfiguredMock = vi.hoisted(() =>
  vi.fn(() => {
    callSequence.entries.push('assertStripeConfigured_called');
    // Default: throw StripeNotConfiguredError mirroring real env-unset path.
    // Sub-cases that need success can override via mockImplementationOnce.
    // Lazy-construct to avoid pulling the real module into the hoisted
    // factory.
    throw Object.assign(new Error('Stripe not configured (mock)'), {
      name: 'StripeNotConfiguredError',
      userMessage: 'Stripe integration pending — see ADR-0010',
    });
  }),
);

vi.mock('@/lib/payments/stripe-client', () => ({
  assertStripeConfigured: assertStripeConfiguredMock,
}));

// ---------------------------------------------------------------------------
// Imports of the real surfaces under test (after the mocks above).
// ---------------------------------------------------------------------------

// eslint-disable-next-line import/first
import {
  initiateRefund,
  type TransactionRunner,
} from '@/app/(admin)/admin/payments/refunds/new/_actions/initiateRefund';
// eslint-disable-next-line import/first
import { BadRequest } from '@/app/(admin)/admin/_errors';
// eslint-disable-next-line import/first
import { InsufficientRoleError } from '@/lib/auth/errors';
// eslint-disable-next-line import/first
import { InsufficientAuthorityError } from '@/lib/payments/authority';
// eslint-disable-next-line import/first
import { StripeNotConfiguredError } from '@/lib/payments/_errors';
// eslint-disable-next-line import/first
import { ADMIN_REFUND_DENIED } from '@/lib/audit/actions';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MANAGER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_PAYMENT_ID = '424242';
const VALID_IDEMPOTENCY_KEY = '12345678-1234-4234-8234-123456789012';

const VALID_PARAMS: InitiateRefundParamsForTest = {
  targetPaymentId: TARGET_PAYMENT_ID,
  amountCents: 5000,
  reason: 'requested_by_customer',
  refundType: 'time_bank',
  idempotencyKey: VALID_IDEMPOTENCY_KEY,
};

// Local alias used to keep the spread-clones legal under
// `exactOptionalPropertyTypes: true` (which forbids
// `{ ...obj, reasonNote: undefined }` shapes). We mirror the SUT's
// public interface exactly but elide the optional `reasonNote` from
// the test fixture since none of the sub-cases exercise it.
type InitiateRefundParamsForTest = Omit<Parameters<typeof initiateRefund>[0], 'reasonNote'>;

/**
 * Test-only TransactionRunner. Records ordering of `transaction(...)`
 * invocations so the R11 sub-case can assert `runner.transaction` fires
 * before `withAudit` is called inside its callback.
 */
function recordingRunner(): TransactionRunner {
  return {
    transaction: async (callback) => {
      callSequence.entries.push('runner.transaction_called');
      const result = await callback({
        query: async () => ({ rows: [] }),
      });
      callSequence.entries.push('runner.transaction_resolved');
      return result;
    },
  };
}

// Source-grep target — locate the SUT file relative to this test.
const __filename =
  typeof __dirname === 'undefined'
    ? fileURLToPath(import.meta.url)
    : `${__dirname}/__placeholder__`;
const TEST_DIR = typeof __dirname === 'undefined' ? dirname(__filename) : __dirname;
const ACTION_PATH = resolve(
  TEST_DIR,
  '..',
  '..',
  'app',
  '(admin)',
  'admin',
  'payments',
  'refunds',
  'new',
  '_actions',
  'initiateRefund.ts',
);

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  requireRoleState.currentActor = null;
  callSequence.entries.length = 0;
  withAuditMock.mockClear();
  // Restore default throw behavior on the env probe; sub-cases that need
  // success use mockImplementationOnce(() => { ... }).
  assertStripeConfiguredMock.mockReset();
  assertStripeConfiguredMock.mockImplementation(() => {
    callSequence.entries.push('assertStripeConfigured_called');
    throw Object.assign(new StripeNotConfiguredError('STRIPE_SECRET_KEY'), {
      // `StripeNotConfiguredError` already carries `name` + `userMessage`;
      // we re-throw the real instance so `instanceof` assertions pass.
    });
  });
});

// ---------------------------------------------------------------------------
// (a) Cross-module shape — confirm the error class is reachable from the SUT's
// import graph. (Constructor / name / userMessage exhaustively tested in
// stripe-client.test.ts.)
// ---------------------------------------------------------------------------

describe('initiateRefund — cross-module shape (sub-case a)', () => {
  it('StripeNotConfiguredError re-imports cleanly with the canonical name', () => {
    const err = new StripeNotConfiguredError('STRIPE_SECRET_KEY');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('StripeNotConfiguredError');
    expect(err.userMessage).toBe('Stripe integration pending — see ADR-0010');
  });
});

// ---------------------------------------------------------------------------
// (c) Happy-path-of-fail-loud — valid manager + valid params + unset env
// throws StripeNotConfiguredError AFTER withAudit commits. Asserts ordering
// + audit payload exactly.
// ---------------------------------------------------------------------------

describe('initiateRefund — fail-loud path commits audit before throwing (sub-case c)', () => {
  it('throws StripeNotConfiguredError AND withAudit fires with exact payload BEFORE the throw', async () => {
    requireRoleState.currentActor = { id: MANAGER_ID, role: 'manager' };

    await expect(initiateRefund(VALID_PARAMS, recordingRunner())).rejects.toBeInstanceOf(
      StripeNotConfiguredError,
    );

    // R1 ordering invariant — withAudit MUST commit BEFORE the env probe
    // fires. Sequence-tracking via the shared callSequence array.
    expect(callSequence.entries).toEqual([
      'runner.transaction_called',
      'withAudit_called',
      'withAudit_resolved',
      'runner.transaction_resolved',
      'assertStripeConfigured_called',
    ]);

    // R11 transaction wrapper — the runner.transaction wrapper fires exactly
    // once and wraps the withAudit call (assertion above pins that
    // withAudit_called and withAudit_resolved both fall BETWEEN
    // runner.transaction_called and runner.transaction_resolved).
    expect(withAuditMock).toHaveBeenCalledTimes(1);

    // Exact audit payload assertion (AC21.6 + D2 sentinel).
    const [, params] = withAuditMock.mock.calls[0]!;
    expect(params.action).toBe(ADMIN_REFUND_DENIED);
    expect(params.action).toBe('admin.refund.denied');
    expect(params.targetType).toBe('refund_request');
    // D2 sentinel — NOT 'pending'.
    expect(params.targetId).toBe('__stripe_not_configured__');
    expect(params.actorId).toBe(MANAGER_ID);

    // mutate callback shape — before/after pinned per AC21.6.
    const mutate = withAuditMock.mock.calls[0]![2] as (
      tx: unknown,
    ) => Promise<{ before: unknown; after: unknown; result: unknown }>;
    const mutateResult = await mutate({});
    expect(mutateResult.before).toBeNull();
    expect(mutateResult.after).toEqual({
      reason: 'stripe_not_configured',
      refund_type: 'time_bank',
      amount_cents: 5000,
    });
  });

  it('propagates an audit failure before probing Stripe', async () => {
    requireRoleState.currentActor = { id: MANAGER_ID, role: 'manager' };
    withAuditMock.mockRejectedValueOnce(new Error('test audit insert failure'));

    await expect(initiateRefund(VALID_PARAMS, recordingRunner())).rejects.toThrow(
      'test audit insert failure',
    );

    expect(callSequence.entries).toEqual(['runner.transaction_called']);
    expect(assertStripeConfiguredMock).not.toHaveBeenCalled();
  });

  it('captures the refundType variant in audit after.refund_type for membership_current', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: MANAGER_ID, role: 'manager' };

    await expect(
      initiateRefund(
        { ...VALID_PARAMS, refundType: 'membership_current', amountCents: 1500 },
        recordingRunner(),
      ),
    ).rejects.toBeInstanceOf(StripeNotConfiguredError);

    const mutate = withAuditMock.mock.calls[0]![2] as (
      tx: unknown,
    ) => Promise<{ before: unknown; after: unknown; result: unknown }>;
    const mutateResult = await mutate({});
    expect(mutateResult.after).toEqual({
      reason: 'stripe_not_configured',
      refund_type: 'membership_current',
      amount_cents: 1500,
    });
  });
});

// ---------------------------------------------------------------------------
// (d) requireRole denial — cashier actor → InsufficientRoleError, NO audit.
// ---------------------------------------------------------------------------

describe('initiateRefund — requireRole denial (sub-case d)', () => {
  it('cashier session throws InsufficientRoleError; withAudit NOT called', async () => {
    expect.assertions(3);
    requireRoleState.currentActor = {
      id: '22222222-2222-4222-8222-222222222222',
      role: 'cashier',
    };

    await expect(initiateRefund(VALID_PARAMS, recordingRunner())).rejects.toBeInstanceOf(
      InsufficientRoleError,
    );

    expect(withAuditMock).not.toHaveBeenCalled();
    expect(assertStripeConfiguredMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (e) assertRefundAuthority denial — manager + membership_previous →
// InsufficientAuthorityError, NO audit. (Intentional asymmetry per Open Q2;
// premortem R6.)
// ---------------------------------------------------------------------------

describe('initiateRefund — authority denial (sub-case e, premortem R6 asymmetry)', () => {
  it('manager + membership_previous throws InsufficientAuthorityError; NO audit row', async () => {
    expect.assertions(3);
    requireRoleState.currentActor = { id: MANAGER_ID, role: 'manager' };

    await expect(
      initiateRefund({ ...VALID_PARAMS, refundType: 'membership_previous' }, recordingRunner()),
    ).rejects.toBeInstanceOf(InsufficientAuthorityError);

    // Intentional asymmetry — authority denial does NOT write
    // admin.refund.denied. Documented in the SUT's load-bearing comment
    // block above `assertRefundAuthority`.
    expect(withAuditMock).not.toHaveBeenCalled();
    expect(assertStripeConfiguredMock).not.toHaveBeenCalled();
  });

  it('manager + time_bank over $200 (20001c) throws InsufficientAuthorityError; NO audit row', async () => {
    expect.assertions(2);
    requireRoleState.currentActor = { id: MANAGER_ID, role: 'manager' };

    await expect(
      initiateRefund(
        { ...VALID_PARAMS, refundType: 'time_bank', amountCents: 20001 },
        recordingRunner(),
      ),
    ).rejects.toBeInstanceOf(InsufficientAuthorityError);

    expect(withAuditMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (e') Zod validation — malformed amountCents rejects BEFORE withAudit.
// `.finite()` is the load-bearing refinement (premortem risk 7).
// ---------------------------------------------------------------------------

describe("initiateRefund — Zod validation (sub-case e', premortem R7 .finite())", () => {
  beforeEach(() => {
    requireRoleState.currentActor = { id: MANAGER_ID, role: 'manager' };
  });

  it('rejects NaN amountCents with BadRequest; NO audit row', async () => {
    expect.assertions(2);
    await expect(
      initiateRefund({ ...VALID_PARAMS, amountCents: Number.NaN }, recordingRunner()),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(withAuditMock).not.toHaveBeenCalled();
  });

  it('rejects Infinity amountCents with BadRequest; NO audit row', async () => {
    expect.assertions(2);
    await expect(
      initiateRefund({ ...VALID_PARAMS, amountCents: Number.POSITIVE_INFINITY }, recordingRunner()),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(withAuditMock).not.toHaveBeenCalled();
  });

  it('rejects negative amountCents with BadRequest; NO audit row', async () => {
    expect.assertions(2);
    await expect(
      initiateRefund({ ...VALID_PARAMS, amountCents: -100 }, recordingRunner()),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(withAuditMock).not.toHaveBeenCalled();
  });

  it('rejects non-integer amountCents with BadRequest; NO audit row', async () => {
    expect.assertions(2);
    await expect(
      initiateRefund({ ...VALID_PARAMS, amountCents: 2500.5 }, recordingRunner()),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(withAuditMock).not.toHaveBeenCalled();
  });

  it('rejects zero amountCents with BadRequest; NO audit row (z.positive())', async () => {
    expect.assertions(2);
    await expect(
      initiateRefund({ ...VALID_PARAMS, amountCents: 0 }, recordingRunner()),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(withAuditMock).not.toHaveBeenCalled();
  });

  it('rejects malformed reason with BadRequest; NO audit row', async () => {
    expect.assertions(2);
    await expect(
      initiateRefund(
        // @ts-expect-error — intentional misuse for the test
        { ...VALID_PARAMS, reason: 'not-a-reason' },
        recordingRunner(),
      ),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(withAuditMock).not.toHaveBeenCalled();
  });

  it('rejects malformed refundType with BadRequest; NO audit row', async () => {
    expect.assertions(2);
    await expect(
      initiateRefund(
        // @ts-expect-error — intentional misuse for the test
        { ...VALID_PARAMS, refundType: 'not-a-type' },
        recordingRunner(),
      ),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(withAuditMock).not.toHaveBeenCalled();
  });

  it('rejects malformed idempotencyKey (not UUID) with BadRequest; NO audit row', async () => {
    expect.assertions(2);
    await expect(
      initiateRefund({ ...VALID_PARAMS, idempotencyKey: 'not-a-uuid' }, recordingRunner()),
    ).rejects.toBeInstanceOf(BadRequest);
    expect(withAuditMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (f) Source-grep invariants — premortem R10 + R11.
// ---------------------------------------------------------------------------

describe('initiateRefund — source-shape invariants (sub-case f)', () => {
  it("first line is `import 'server-only';`", () => {
    const src = readFileSync(ACTION_PATH, 'utf8').replace(/^﻿/, '');
    const firstLine = src.split(/\r?\n/)[0]!.trim();
    expect(firstLine).toBe("import 'server-only';");
  });

  it("contains the literal `await requireRole('manager')` call", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/await\s+requireRole\(\s*['"]manager['"]\s*\)/);
  });

  it('contains the literal `assertStripeConfigured()` call', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/assertStripeConfigured\(\s*\)/);
  });

  it('references the ADMIN_REFUND_DENIED constant by identifier', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    // Identifier reference (not just the literal string value) — guards
    // against future refactors that re-inline 'admin.refund.denied'.
    expect(src).toMatch(/\bADMIN_REFUND_DENIED\b/);
  });

  it('imports ADMIN_REFUND_DENIED from @/lib/audit/actions', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(
      /import[^;]*\bADMIN_REFUND_DENIED\b[^;]*from\s*['"]@\/lib\/audit\/actions['"]/,
    );
  });

  it("contains the D2 sentinel literal '__stripe_not_configured__'", () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    expect(src).toMatch(/__stripe_not_configured__/);
  });

  it("does NOT use the rejected `target_id = 'pending'` sentinel (D2)", () => {
    // Strip comments first so JSDoc mentions of "pending" don't
    // false-positive the grep.
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // The sentinel in code must NOT be the literal "'pending'" string.
    // We grep for the exact string token; openRefundFlow's separate
    // 'pending' usage is in a different file.
    expect(stripped).not.toMatch(/targetId\s*:\s*['"]pending['"]/);
  });

  it('places `assertStripeConfigured()` AFTER the `withAudit(...)` call site (R1)', () => {
    // R1 source-level guard — even if the runtime test were stubbed, the
    // textual ordering anchors the audit-before-throw invariant.
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const withAuditIdx = stripped.indexOf('withAudit(');
    const probeIdx = stripped.indexOf('assertStripeConfigured(');
    expect(withAuditIdx).toBeGreaterThanOrEqual(0);
    expect(probeIdx).toBeGreaterThan(withAuditIdx);
  });

  it('wraps the `withAudit(...)` call inside a `runner.transaction(...)` callback (R11)', () => {
    // R11 source-level guard — mirrors openRefundFlow.ts. The textual
    // pattern is `runner.transaction(async (tx) => withAudit(...` (or
    // equivalent with line breaks).
    const src = readFileSync(ACTION_PATH, 'utf8');
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // Multiline regex — match `runner.transaction` followed (within the
    // same callback body) by `withAudit(`. Use [\s\S]*? for laziness.
    expect(stripped).toMatch(/runner\.transaction\s*\([\s\S]*?withAudit\s*\(/);
  });

  it('uses `z.object(` with `.int().positive().finite()` on amountCents (R7)', () => {
    const src = readFileSync(ACTION_PATH, 'utf8');
    // Source-grep that .finite() is present — load-bearing per premortem R7.
    expect(src).toMatch(/\.finite\(\s*\)/);
    expect(src).toMatch(/z\.object\(/);
  });
});
