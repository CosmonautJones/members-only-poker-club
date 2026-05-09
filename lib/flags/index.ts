/**
 * Public feature-flag API — ADR-0020 slice 1.
 *
 * Consumer call sites:
 *
 *   import { isEnabled } from '@/lib/flags';
 *
 *   if (isEnabled('kill-stripe-webhook')) return earlyReturn();
 *   if (isEnabled('tournament-waitlist-v2', { profileId: ctx.user.id })) ...
 *
 * The registry is in-code for slice 1; a future slice swaps the read source
 * to the `feature_flags` Postgres table without changing this signature.
 */
import { evaluateFlag } from './evaluate';
import { FLAGS } from './registry';
import type { FlagContext, FlagKey } from './types';

export function isEnabled(key: FlagKey, ctx: FlagContext = {}): boolean {
  const def = FLAGS[key];
  return evaluateFlag(def, ctx);
}

export type { FlagKey, FlagContext, FlagDefinition, FlagRole } from './types';
export { FLAGS } from './registry';
export { evaluateFlag, bucketFor } from './evaluate';
