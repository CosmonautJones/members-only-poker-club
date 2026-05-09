/**
 * Pure flag evaluator — ADR-0020.
 *
 * Decision precedence:
 *
 *   1. `enabled === false` → false (kill-switch short-circuit; nothing else
 *      matters when the flag is hard-off).
 *   2. allowlist hit (profileId in `allowlist`) → true (staff dogfooding
 *      always wins over percent).
 *   3. roleGate set: profile's role rank >= gate rank → continue to percent;
 *      otherwise → false.
 *   4. percent rollout: deterministic hash of `profileId + key` mod 100;
 *      enable if hash < percent. Anonymous (no profileId) cannot be
 *      bucketed; anonymous + percent < 100 → false.
 *   5. default → false.
 */
import type { FlagContext, FlagDefinition } from './types';
import { ROLE_RANK } from './types';

/**
 * djb2 string hash — small, deterministic, no crypto needed. Good enough
 * for percent-bucket allocation; the cryptographic strength is irrelevant
 * because the input keyspace is profile IDs (UUIDs) and the salt is the
 * flag key. We just need uniform-ish distribution and stability.
 */
function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  // Convert to unsigned 32-bit.
  return hash >>> 0;
}

/**
 * Returns the deterministic 0–99 bucket for a (profileId, key) pair.
 * Exported for test inspection; not part of the consumer API.
 */
export function bucketFor(profileId: string, key: string): number {
  return djb2(`${key}:${profileId}`) % 100;
}

export function evaluateFlag(def: FlagDefinition, ctx: FlagContext = {}): boolean {
  // 1. Kill-switch short-circuit.
  if (!def.enabled) return false;

  const { profileId, role } = ctx;

  // 2. Allowlist always wins (over percent and role gate).
  if (profileId && def.allowlist.includes(profileId)) return true;

  // 3. Role gate: must meet or exceed the gate's rank.
  if (def.roleGate !== undefined) {
    if (role === undefined) return false;
    if (ROLE_RANK[role] < ROLE_RANK[def.roleGate]) return false;
    // Falls through to percent — a role-gated flag can still be a partial
    // rollout *within* the gated population.
  }

  // 4. Percent rollout.
  if (def.percent >= 100) return true;
  if (def.percent <= 0) return false;
  if (!profileId) {
    // Anonymous traffic can't be deterministically bucketed.
    return false;
  }
  return bucketFor(profileId, def.key) < def.percent;
}
