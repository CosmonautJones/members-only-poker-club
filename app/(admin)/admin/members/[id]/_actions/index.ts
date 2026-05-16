'use server';

/**
 * `'use server'` re-export shim for the member-detail Actions panel
 * (ADR-0035 AC18, WC.T15).
 *
 * Why this file exists:
 *   - The page's typed-confirmation dialogs live in a client component
 *     (`./_components/actions-panel.client.tsx`) — they need stateful
 *     React for the typed-phrase gating.
 *   - The underlying server actions (`changeRole`, `requestReverification`,
 *     `openRefundFlow`) are written WITHOUT `'use server'` directives
 *     because they were originally designed for direct call from server
 *     components / RSC `<form action={...}>` paths. They import
 *     `'server-only'` and `createAdminClient` which would fault if
 *     bundled to the client.
 *   - This file is the bridge: it carries the `'use server'` directive
 *     and re-exports thin async wrappers that the client component can
 *     reference. Next bundles the wrappers as server actions
 *     (fetch-based RSC actions), keeping the underlying implementation
 *     server-only.
 *
 * AC5 defense-in-depth (load-bearing): each wrapper's FIRST `await`
 * MUST be `await requireRole('manager')` — this is a SECOND gate on
 * top of the underlying action's own first-await gate. The walker in
 * `tests/auth/admin-routes-defense-in-depth.test.ts` treats every file
 * in an `_actions/` directory as a gated action surface, and the
 * "two gates" posture means a future refactor that loses the inner
 * gate is still caught by the outer one. Cheap insurance.
 *
 * Each wrapper preserves the original action's contract — same params,
 * same return shape, same thrown errors. Tests against the underlying
 * actions (e.g. `tests/admin/change-role-action.test.ts`) continue to
 * call the underlying functions directly with a pglite-injected `db`.
 */

import { requireRole } from '@/lib/auth/requireRole';

import { changeRole as _changeRole } from './changeRole';
import { requestReverification as _requestReverification } from './requestReverification';
import { openRefundFlow as _openRefundFlow } from './openRefundFlow';
import type { Role } from '@/lib/auth/types';

export async function changeRoleAction(params: {
  profileId: string;
  newRole: Role;
}): Promise<{ ok: true; changed: boolean }> {
  // Outer defense-in-depth gate. The underlying `_changeRole` does its
  // own `await requireRole('manager')` (and refines to `'owner'` for
  // promotions); this outer gate ensures the wrapper itself never
  // executes for a sub-manager session.
  await requireRole('manager');
  return _changeRole(params);
}

export async function requestReverificationAction(params: {
  profileId: string;
  reason: string;
}): Promise<{ ok: true }> {
  await requireRole('manager');
  return _requestReverification(params);
}

export async function openRefundFlowAction(params: {
  profileId: string;
  scope: 'membership' | 'time_bank' | 'tournament_entry';
}): Promise<{ redirectTo: string }> {
  await requireRole('manager');
  return _openRefundFlow(params);
}
