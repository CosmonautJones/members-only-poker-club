/**
 * axe-core a11y sweep for `app/(admin)/admin/payments/refunds/new/page.tsx`
 * — ADR-0035 AC33 / Slice 4D followup for the ADR-0036 Slice 1 refund-
 * initiation form.
 *
 * Run locally:    pnpm test tests/admin/a11y/payments-refund-new.a11y.test.tsx
 * Prerequisites:  none — pure module mocks (no DB, no network).
 *
 * Contract per AC33:
 *   - Render the refund-new form via RTL.
 *   - Run axe-core (vitest-axe) over the rendered container.
 *   - Assert NO `serious` or `critical` violations.
 *   - The form has FIVE controls (per AC28): targetPaymentId text input,
 *     amountCents number input, reason select, refundType radio group,
 *     and a hidden idempotencyKey populated by a client sub-tree. Every
 *     control must have an associated label or accessible name.
 *
 * Mocking mirrors `tests/admin/payments/refund-new-page.test.tsx`.
 */

import { describe, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

import { expectNoSeriousAxeViolations, BASE_MANAGER_PROFILE } from './_helpers';

// ---- Hoisted mock primitives ----------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn<
    (required: string) => Promise<{
      profile: { id: string; role: string; full_name: string; email: string };
    }>
  >(),
  initiateRefund: vi.fn(),
}));

// ---- Mocks ----------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((p: string) => {
    const e = new Error(`NEXT_REDIRECT: ${p}`);
    (e as Error & { digest?: string }).digest = `NEXT_REDIRECT;${p}`;
    throw e;
  }),
}));

vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: mocks.requireRole,
}));

// The action body is exercised by tests/payments/server-actions-stubs.test.ts;
// here we only care that the form references the action prop (a stable
// function reference satisfies axe's form-handler requirements).
vi.mock('@/app/(admin)/admin/payments/refunds/new/_actions/initiateRefund', () => ({
  initiateRefund: mocks.initiateRefund,
}));

// ---- Import AFTER mocks ---------------------------------------------------

// eslint-disable-next-line import/first
import RefundNewPage from '@/app/(admin)/admin/payments/refunds/new/page';

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({ profile: BASE_MANAGER_PROFILE });
  mocks.initiateRefund.mockReset();
  // The IdempotencyKeyField client sub-tree reads sessionStorage on mount;
  // reset so each test starts from a known empty source. happy-dom
  // provides a real window.sessionStorage.
  window.sessionStorage.clear();
});

// ---- Tests ----------------------------------------------------------------

describe('admin payments refund-new — axe-core a11y (AC33)', () => {
  it('has no serious or critical axe violations on the Slice 1 fail-loud form', async () => {
    const tree = await RefundNewPage();
    const { container } = render(tree as React.ReactElement);
    await expectNoSeriousAxeViolations(container);
  });
});
