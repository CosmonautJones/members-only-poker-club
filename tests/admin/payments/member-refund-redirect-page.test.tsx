/**
 * Unit tests for `app/(admin)/admin/payments/[id]/refund/page.tsx` — the
 * thin manager+-gated redirect page that resolves the Slice-1 critic-
 * non-blocking-#1 404 (per
 * `docs/journal/2026-05-16-02-conductor-run-adr-0036-payment-management-slice-1.md`
 * §Next).
 *
 * Run locally:    pnpm test tests/admin/payments/member-refund-redirect-page.test.tsx
 * Prerequisites:  none — pure module mocks.
 *
 * Contract:
 *   - FIRST awaited statement is `await requireRole('manager');` (the
 *     cross-cutting walker `tests/auth/admin-routes-defense-in-depth.test.ts`
 *     enforces this structurally; the case here is a behavioral spot-check).
 *   - On success, calls `redirect('/admin/payments/refunds/new?targetMemberId=<encoded>')`.
 *   - The id segment is URL-encoded before insertion into the query
 *     string (defense against caller-controlled ids that contain `?`,
 *     `&`, or `#`).
 *   - Returns `Promise<never>` — `redirect()` throws `NEXT_REDIRECT`
 *     before any later code runs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Hoisted mock primitives ----------------------------------------------

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn<
    (required: string) => Promise<{
      profile: { id: string; role: string; full_name: string; email: string };
    }>
  >(),
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

// ---- Suite ----------------------------------------------------------------

describe('/admin/payments/[id]/refund redirect page', () => {
  beforeEach(async () => {
    mocks.requireRole.mockReset();
    mocks.requireRole.mockResolvedValue({
      profile: { id: 'actor-1', role: 'manager', full_name: 'Mgr', email: 'm@x' },
    });
    const { redirect } = await import('next/navigation');
    (redirect as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('invokes requireRole("manager") before redirecting', async () => {
    const { default: Page } = await import('@/app/(admin)/admin/payments/[id]/refund/page');

    await expect(Page({ params: { id: '11111111-1111-1111-1111-111111111111' } })).rejects.toThrow(
      /NEXT_REDIRECT/,
    );

    expect(mocks.requireRole).toHaveBeenCalledTimes(1);
    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
  });

  it('redirects to /admin/payments/refunds/new with targetMemberId query param', async () => {
    const { default: Page } = await import('@/app/(admin)/admin/payments/[id]/refund/page');
    const { redirect } = await import('next/navigation');

    const id = '11111111-1111-1111-1111-111111111111';
    await expect(Page({ params: { id } })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirect).toHaveBeenCalledWith(`/admin/payments/refunds/new?targetMemberId=${id}`);
  });

  it('URL-encodes the id segment to defend against query-string injection', async () => {
    const { default: Page } = await import('@/app/(admin)/admin/payments/[id]/refund/page');
    const { redirect } = await import('next/navigation');

    await expect(Page({ params: { id: 'a&b=c?d' } })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(redirect).toHaveBeenLastCalledWith(
      '/admin/payments/refunds/new?targetMemberId=a%26b%3Dc%3Fd',
    );
  });

  it('propagates requireRole failure WITHOUT calling redirect', async () => {
    const { default: Page } = await import('@/app/(admin)/admin/payments/[id]/refund/page');
    const { redirect } = await import('next/navigation');

    const role = new Error('InsufficientRole');
    mocks.requireRole.mockRejectedValueOnce(role);

    await expect(Page({ params: { id: 'any' } })).rejects.toBe(role);

    expect(redirect).not.toHaveBeenCalled();
  });
});
