/**
 * `/admin/payments/[id]/refund` — thin manager+-gated redirect to the
 * canonical refund-initiation surface at `/admin/payments/refunds/new`
 * with the target member pinned via `targetMemberId` query param.
 *
 * Why this exists:
 *   `lib/payments/console-availability.ts` flipped `PAYMENTS_CONSOLE_READY`
 *   to `true` in ADR-0036 Slice 1. That flip changed `openRefundFlow`'s
 *   redirect target from the degraded `/admin/members/[id]?refund=...`
 *   path to `/admin/payments/[id]/refund` — a route that did not exist
 *   in Slice 1. This page is the Slice-1-followup resolution per
 *   `docs/journal/2026-05-16-02-conductor-run-adr-0036-payment-management-slice-1.md`
 *   §Next critic-non-blocking-#1 option (b): the per-member URL is a
 *   thin redirect to the canonical form. Audit breadcrumbs already fired
 *   in `openRefundFlow` before the redirect — the breadcrumb is preserved
 *   regardless of which target the redirect lands on.
 *
 * ## Defense-in-depth posture (ADR-0035 AC5)
 *
 * The first body statement is `await requireRole('manager');`. The
 * `redirect()` call follows after — `redirect()` throws a
 * `NEXT_REDIRECT` sentinel internally, so any code below it is
 * unreachable but TypeScript needs the function signature to declare a
 * `Promise<never>` return.
 *
 * @see app/(admin)/admin/members/[id]/_actions/openRefundFlow.ts §redirectTo
 * @see lib/payments/console-availability.ts §PAYMENTS_CONSOLE_READY
 */

import { redirect } from 'next/navigation';

import { requireRole } from '@/lib/auth/requireRole';

export const dynamic = 'force-dynamic';

export default async function PaymentsMemberRefundRedirectPage({
  params,
}: {
  params: { id: string };
}): Promise<never> {
  await requireRole('manager');

  redirect(`/admin/payments/refunds/new?targetMemberId=${encodeURIComponent(params.id)}`);
}
