'use server';

/**
 * `'use server'` re-export shim for the `/admin/flags` page (ADR-0035
 * AC22, WC.T16).
 *
 * Why this file exists:
 *   - The flags page renders kill-switch toggles inside a client
 *     component (the typed-confirmation dialog needs stateful React).
 *   - The underlying `updateFlag` server action imports `'server-only'`
 *     and `createAdminClient` and cannot be bundled to the client
 *     directly.
 *   - This file is the bridge: it carries the `'use server'` directive
 *     and re-exports a thin async wrapper that the client component can
 *     reference. Next bundles the wrapper as a server action (fetch-based
 *     RSC action), keeping the underlying implementation server-only.
 *
 * AC5 defense-in-depth (load-bearing): the wrapper's FIRST `await` MUST
 * be `await requireRole('manager')` — a SECOND gate on top of the
 * underlying action's own first-await gate. The walker in
 * `tests/auth/admin-routes-defense-in-depth.test.ts` treats every file in
 * an `_actions/` directory as a gated action surface; the "two gates"
 * posture means a future refactor that loses the inner gate is still
 * caught by the outer one.
 *
 * Mirrors the pattern in
 * `app/(admin)/admin/members/[id]/_actions/index.ts` (member-detail).
 */

import { requireRole } from '@/lib/auth/requireRole';

import { updateFlag as _updateFlag, type UpdateFlagParams } from './updateFlag';

export async function updateFlagAction(params: UpdateFlagParams): Promise<{ ok: true }> {
  // Outer defense-in-depth gate. The underlying `_updateFlag` does its
  // own `await requireRole('manager')`; this outer gate ensures the
  // wrapper itself never executes for a sub-manager session.
  await requireRole('manager');
  return _updateFlag(params);
}
